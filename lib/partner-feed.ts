import {
  listPartnerFeeds,
  markPartnerFeedResult,
  type PartnerFeedSource,
} from '@/lib/partner-source-store'
import { upsertExternalDevices, type ExternalDeviceRow } from '@/lib/device-store'

/* ═══════════════════════════════════════════════════════════════════════════
 * TaxiTago 외부 파트너 기기 피드 규격 (Partner Device Feed API Spec v1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 파트너 업체는 자체 서버에 아래 규격의 JSON 엔드포인트를 열고, TaxiTago
 * 관리자/파트너 화면에 엔드포인트 URL을 등록한다. 중앙 서버가 주기적으로
 * 폴링해 모든 파트너의 기기 위치·배터리·대여 상태를 단일 device-store에
 * 취합한다(최대 5개 이상 소스 병렬 처리).
 *
 * ── 요청 ─────────────────────────────────────────────────────────────────
 *   GET {endpointUrl}
 *   Headers:
 *     Accept: application/json
 *     Authorization: Bearer {apiKey}        — 소스에 apiKey가 등록된 경우만
 *     X-TaxiTago-Feed: 1                    — 폴링 요청 식별자
 *
 * ── 응답 (200 OK, application/json) ────────────────────────────────────────
 *   {
 *     "partner": { "name": "상호명" },          // 선택 — 없으면 등록 상호명 사용
 *     "generatedAt": "2025-01-01T00:00:00Z",   // 선택 — ISO 8601
 *     "devices": [                              // 필수 — 최대 300건까지 반영
 *       {
 *         "deviceId": "BK-2048",                // 필수, 파트너 내 고유 ID (≤48자)
 *         "type": "bicycle",                    // 필수: bicycle|kickboard|ev|parking
 *         "latitude": 35.1990,                  // 필수
 *         "longitude": 128.9980,                // 필수
 *         "batteryLevel": 82,                   // 선택, 0-100 (모빌리티)
 *         "status": "idle",                     // 선택: idle|available|active
 *                                               //        |rented|in_use
 *                                               //        |maintenance|offline
 *         "rentable": true,                     // 선택 — 생략 시 status에서 유도
 *         "model": "전동킥보드 A",               // 선택
 *         "address": "부산역 앞 거치대"           // 선택
 *       }
 *     ]
 *   }
 *   ※ 최상위가 기기 배열 그 자체(["devices" 없이 [...]])인 형태도 허용한다.
 *
 * ── 에러 ───────────────────────────────────────────────────────────────────
 *   비-2xx, 타임아웃(8s), JSON 파싱 실패 모두 해당 소스만 'error'로 기록된다.
 *   한 소스의 장애가 다른 파트너 기기나 앱 전체에 영향을 주지 않는다
 *   (Promise.allSettled 격리 + 소스별 네임스페이스 upsert).
 *
 * ── 상태 의미 ──────────────────────────────────────────────────────────────
 *   idle|available|active → 대여 가능 후보 / rented|in_use → 대여 중
 *   maintenance|offline    → 대여 불가(점검 중)
 *   앱 내 대여가 진행 중인 기기는 파트너 피드가 비대여 상태를 보내더라도
 *   rentedAt 기준 최대 6시간까지 'rented'를 유지한다(파트너가 인앱 대여를
 *   인식하지 못하는 동안의 이중 대여 방지).
 * ═══════════════════════════════════════════════════════════════════════════ */

const FEED_TIMEOUT_MS = 8_000
const MAX_FEED_DEVICES = 300

/** 파트너 응답의 status 문자열 → 내부 status('active'|'idle'|'rented') */
function normalizeStatus(raw: unknown): 'active' | 'idle' | 'rented' {
  const value = (typeof raw === 'string' ? raw : '').trim().toLowerCase()
  if (value === 'rented' || value === 'in_use' || value === 'inuse') return 'rented'
  if (value === 'maintenance' || value === 'offline' || value === 'disabled' || value === 'locked') return 'idle'
  return 'active'
}

const FEED_TYPES = new Set(['bicycle', 'kickboard', 'ev', 'parking'])

/** 파트너 피드의 기기 1건을 내부 upsert 형태로 정규화한다. 유효하지 않으면 null. */
function normalizeRow(raw: unknown): ExternalDeviceRow | null {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const deviceId = (typeof row.deviceId === 'string' ? row.deviceId : '').trim()
  const type = (typeof row.type === 'string' ? row.type : '').trim().toLowerCase()
  const lat = Number(row.latitude)
  const lng = Number(row.longitude)
  if (!deviceId || !FEED_TYPES.has(type)) return null
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null
  const battery = Number(row.batteryLevel)
  const status = normalizeStatus(row.status)
  const rentable =
    typeof row.rentable === 'boolean' ? row.rentable
      : status !== 'rented' && status !== 'idle'
  return {
    deviceId: deviceId.slice(0, 48),
    type,
    latitude: lat,
    longitude: lng,
    batteryLevel: Number.isFinite(battery) ? Math.max(0, Math.min(100, Math.round(battery))) : null,
    status,
    rentable,
    model: typeof row.model === 'string' ? row.model.trim().slice(0, 128) : '',
    address: typeof row.address === 'string' ? row.address.trim().slice(0, 256) : '',
  }
}

/** 단일 소스 폴링 — 모든 실패를 throw 없이 결과 객체로 돌려준다. */
async function fetchFeedDevices(source: PartnerFeedSource): Promise<{
  ok: boolean
  partnerName: string
  devices: ExternalDeviceRow[]
  error?: string
}> {
  try {
    const res = await fetch(source.endpointUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-TaxiTago-Feed': '1',
        ...(source.apiKey ? { Authorization: `Bearer ${source.apiKey}` } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    })
    if (!res.ok) {
      return { ok: false, partnerName: source.name, devices: [], error: `HTTP ${res.status}` }
    }
    const payload = (await res.json().catch(() => null)) as unknown
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { devices?: unknown[] } | null)?.devices)
        ? (payload as { devices: unknown[] }).devices
        : null
    if (!list) {
      return { ok: false, partnerName: source.name, devices: [], error: 'invalid_payload' }
    }
    const partnerBlock = (payload as { partner?: { name?: unknown } } | null)?.partner
    const partnerName =
      (typeof partnerBlock?.name === 'string' && partnerBlock.name.trim()) || source.name
    const devices = list
      .slice(0, MAX_FEED_DEVICES)
      .map(normalizeRow)
      .filter((row): row is ExternalDeviceRow => row !== null)
    return { ok: true, partnerName, devices }
  } catch (error) {
    const message = error instanceof Error ? error.name === 'TimeoutError' || error.name === 'AbortError'
      ? 'timeout'
      : error.message.slice(0, 120)
      : 'fetch_failed'
    return { ok: false, partnerName: source.name, devices: [], error: message }
  }
}

export type PartnerSyncSummary = {
  feeds: number
  ok: number
  failed: number
  devices: number
  results: { id: string; name: string; ok: boolean; deviceCount: number; error?: string }[]
}

/**
 * 등록된 모든 활성 파트너 피드를 병렬 폴링해 device-store에 취합한다.
 * 소스별 장애는 격리되며(Promise.allSettled), 실패한 소스는 마지막 성공
 * 데이터가 그대로 유지되도록 upsert를 건너뛴다.
 */
export async function syncPartnerFeeds(feedId?: string): Promise<PartnerSyncSummary> {
  const target = (feedId || '').trim()
  const sources = (await listPartnerFeeds()).filter((row) => (target ? row.id === target : row.enabled))
  const settled = await Promise.allSettled(
    sources.map(async (source) => {
      const fetched = await fetchFeedDevices(source)
      if (!fetched.ok) {
        await markPartnerFeedResult(source.id, { ok: false, error: fetched.error }).catch(() => undefined)
        return { id: source.id, name: source.name, ok: false as const, deviceCount: 0, error: fetched.error }
      }
      const applied = await upsertExternalDevices(source.id, source.name, source.ownerUid, fetched.devices)
      await markPartnerFeedResult(source.id, { ok: true, deviceCount: applied }).catch(() => undefined)
      return { id: source.id, name: fetched.partnerName, ok: true as const, deviceCount: applied }
    }),
  )
  const results = settled.map((item, index) =>
    item.status === 'fulfilled'
      ? item.value
      : { id: sources[index].id, name: sources[index].name, ok: false as const, deviceCount: 0, error: 'sync_failed' },
  )
  return {
    feeds: sources.length,
    ok: results.filter((row) => row.ok).length,
    failed: results.filter((row) => !row.ok).length,
    devices: results.reduce((sum, row) => sum + row.deviceCount, 0),
    results,
  }
}
