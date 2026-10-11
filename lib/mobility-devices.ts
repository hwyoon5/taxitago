import type { RegisteredNearbyPartner } from '@/lib/nearby-services'
import type { DeviceTelemetry } from '@/lib/device-types'

/**
 * 파트너 기기 위치 공유 모델 — 서버 스토어(taxitago:devices, /api/devices)가
 * 유일한 원천이다. 등록된 기기는 모든 이용자의 지도에 실시간 노출되고,
 * 대여·반납 전이도 서버가 검증한다.
 * 로컬에는 조회 결과 캐시만 둬서 지도 렌더가 동기로 읽을 수 있게 한다.
 */

export const MOBILITY_DEVICES_EVENT = 'taxitago-mobility-devices'

export type MobilityDeviceKind = '자전거' | '퀵보드'
export type MobilityDeviceStatus = 'available' | 'maintenance' | 'low_battery' | 'rented'

export type MobilityDevice = {
  /** 서버 deviceId — 등록·대여·정산의 기본 식별자 */
  serial: string
  kind: MobilityDeviceKind
  model: string
  address: string
  lat: number
  lng: number
  battery: number
  status: MobilityDeviceStatus
  /** 파트너가 대여 허용으로 둔 기기인지 — status와 별개의 소유자 스위치 */
  rentable: boolean
  ownerUid: string
  ownerName: string
  registeredAt: string
  /** 서버가 마지막으로 상태를 갱신한 시각 — 파트너 모니터링용 */
  lastSeen: string
}

export const MOBILITY_STATUS_LABEL: Record<MobilityDeviceStatus, string> = {
  available: '이용 가능',
  maintenance: '점검 중',
  low_battery: '배터리 부족',
  rented: '대여 중',
}

const LOW_BATTERY = 20

export function isDeviceRentable(device: Pick<MobilityDevice, 'status' | 'rentable'>) {
  return device.rentable && device.status === 'available'
}

export function parseCoordInput(value: string): { lat: number; lng: number } | null {
  const trimmed = value.trim()
  if (!/^-?\d+(?:\.\d+)?\s*[, ]\s*-?\d+(?:\.\d+)?$/.test(trimmed)) return null
  const [first, second] = trimmed.split(/[, ]+/).map((part) => Number(part))
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null
  if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return { lat: first, lng: second }
  if (Math.abs(second) <= 90 && Math.abs(first) <= 180) return { lat: second, lng: first }
  return null
}

export function deviceMatchesService(kind: MobilityDeviceKind, service: string) {
  if (kind === '자전거') return service === '자전거'
  return service === '킥보드' || service === '퀵보드'
}

export function deviceSpotId(device: Pick<MobilityDevice, 'serial'>) {
  return `device-${device.serial.trim()}`
}

/**
 * 스캔된 QR 문자열이 특정 기기 시리얼에 대응하는지 — 날것 시리얼,
 * `taxitago://device/{serial}`, `/device/{serial}` 같은 URL/스킴 경로,
 * 또는 시리얼을 토큰으로 포함한 임의 문자열을 모두 허용한다.
 * 시리얼 앞뒤가 영숫자로 붙어 있으면 다른 기기 접두·접미 매칭으로 보고 거절한다.
 */
export function deviceQrMatchesSerial(raw: string, serial: string): boolean {
  const want = serial.trim()
  const text = raw.trim()
  if (!want || !text) return false
  if (text.toLowerCase() === want.toLowerCase()) return true
  const escaped = want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i').test(text)
}

// ── 서버 레코드 → 화면 모델 ──────────────────────────────────────────────────

function statusOf(row: DeviceTelemetry): MobilityDeviceStatus {
  const mobility = row.spec?.kind === 'mobility' ? row.spec : null
  const battery = mobility?.batteryLevel ?? row.batteryLevel
  if (row.status === 'rented') return 'rented'
  if (mobility && mobility.rentable !== true) return 'maintenance'
  if (typeof battery === 'number' && battery < LOW_BATTERY) return 'low_battery'
  return 'available'
}

export function deviceFromTelemetry(row: DeviceTelemetry): MobilityDevice | null {
  const kind: MobilityDeviceKind | null =
    row.type === 'bicycle' ? '자전거' : row.type === 'kickboard' ? '퀵보드' : null
  const mobility = row.spec?.kind === 'mobility' ? row.spec : null
  if (!kind || !mobility || !row.registered) return null
  const lat = mobility.latitude ?? row.latitude
  const lng = mobility.longitude ?? row.longitude
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const battery = mobility.batteryLevel ?? row.batteryLevel ?? 100
  return {
    serial: row.deviceId,
    kind,
    model: mobility.model,
    address: mobility.address || `${lat}, ${lng}`,
    lat,
    lng,
    battery: Math.max(0, Math.min(100, Math.round(battery))),
    status: statusOf(row),
    rentable: mobility.rentable === true,
    ownerUid: row.ownerUid || '',
    ownerName: row.ownerName || '',
    registeredAt: row.firstSeen || row.lastSeen,
    lastSeen: row.lastSeen,
  }
}

// ── 캐시 + fetch ────────────────────────────────────────────────────────────

let cache: MobilityDevice[] = []

function writeCache(devices: MobilityDevice[]) {
  cache = devices
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MOBILITY_DEVICES_EVENT))
  return devices
}

async function fetchDevices(query: string): Promise<MobilityDevice[]> {
  try {
    const res = await fetch(`/api/devices?${query}`, { cache: 'no-store' })
    const data = (await res.json().catch(() => null)) as { devices?: DeviceTelemetry[] } | null
    if (!res.ok || !Array.isArray(data?.devices)) return []
    return data.devices.map(deviceFromTelemetry).filter((item): item is MobilityDevice => Boolean(item))
  } catch {
    return []
  }
}

/** 공개 지도용 — 등록된 자전거·킥보드 전체를 서버에서 새로 읽어 캐시를 갱신한다. */
export async function refreshMobilityDevices(): Promise<MobilityDevice[]> {
  const [bicycles, kickboards] = await Promise.all([fetchDevices('type=bicycle'), fetchDevices('type=kickboard')])
  return writeCache([...bicycles, ...kickboards])
}

/** 소유 파트너 본인 기기 — 관리 목록용(캐시에는 넣지 않는다). */
export async function fetchMyMobilityDevices(ownerUid: string): Promise<MobilityDevice[]> {
  const uid = ownerUid.trim()
  if (!uid) return []
  return fetchDevices(`uid=${encodeURIComponent(uid)}`)
}

export function loadMobilityDevices(): MobilityDevice[] {
  return cache
}

export function findDeviceBySpotId(id: string) {
  const serial = id.startsWith('device-') ? id.slice('device-'.length) : ''
  return cache.find((device) => device.serial === serial) ?? null
}

// ── 파트너 등록·관리 (ownerUid 필수) ─────────────────────────────────────────

export async function registerMobilityDevice(input: {
  serial: string
  kind: MobilityDeviceKind
  model?: string
  speedLimitKmh?: number | null
  specNote?: string
  address: string
  lat: number
  lng: number
  battery: number
  rentable: boolean
  ownerUid?: string
  ownerName?: string
}): Promise<{ ok: true; device: MobilityDevice } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/devices/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: input.serial.trim(),
        type: input.kind === '자전거' ? 'bicycle' : 'kickboard',
        ownerUid: input.ownerUid || undefined,
        ownerName: input.ownerName || undefined,
        spec: {
          kind: 'mobility',
          model: input.model || '',
          speedLimitKmh: input.speedLimitKmh ?? null,
          specNote: input.specNote || '',
          address: input.address,
          latitude: input.lat,
          longitude: input.lng,
          batteryLevel: Math.max(0, Math.min(100, Math.round(input.battery))),
          locked: true,
          rentable: input.rentable,
        },
      }),
    })
    const data = (await res.json().catch(() => null)) as { device?: DeviceTelemetry; error?: string } | null
    const device = data?.device ? deviceFromTelemetry(data.device) : null
    if (!res.ok || !device) {
      return { ok: false, error: data?.error === 'device_owned' ? '다른 파트너가 사용 중인 기기 ID입니다.' : '기기를 등록하지 못했습니다.' }
    }
    return { ok: true, device }
  } catch {
    return { ok: false, error: '네트워크 오류로 기기를 등록하지 못했습니다.' }
  }
}

/** 소유 파트너의 spec 부분 수정 — rentable·배터리·위치 등. */
export async function updateMyMobilityDevice(
  serial: string,
  ownerUid: string,
  specPatch: Record<string, unknown>,
): Promise<MobilityDevice | null> {
  try {
    const res = await fetch('/api/devices/register', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: serial.trim(), ownerUid, spec: specPatch }),
    })
    const data = (await res.json().catch(() => null)) as { device?: DeviceTelemetry } | null
    return data?.device ? deviceFromTelemetry(data.device) : null
  } catch {
    return null
  }
}

export async function deleteMobilityDevice(serial: string, ownerUid: string): Promise<boolean> {
  try {
    const res = await fetch('/api/devices/register', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: serial.trim(), ownerUid }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ── 이용자 대여·반납 전이 ───────────────────────────────────────────────────

async function transitionRental(serial: string, rent: boolean): Promise<MobilityDevice | null> {
  try {
    const res = await fetch('/api/devices', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: serial.trim(), rent }),
    })
    const data = (await res.json().catch(() => null)) as { device?: DeviceTelemetry } | null
    const device = data?.device ? deviceFromTelemetry(data.device) : null
    if (!res.ok || !device) return null
    // 캐시에도 즉시 반영해 지도·목록이 같은 상태를 본다.
    writeCache(cache.map((item) => (item.serial === device.serial ? device : item)))
    return device
  } catch {
    return null
  }
}

export const rentMobilityDevice = (serial: string) => transitionRental(serial, true)
export const returnMobilityDevice = (serial: string) => transitionRental(serial, false)

// ── 외부 파트너 피드 연동 (서버가 주기 폴링해 기기를 자동 취합) ────────────

export type PartnerFeedInfo = {
  id: string
  name: string
  endpointUrl: string
  enabled: boolean
  hasApiKey: boolean
  ownerUid: string
  createdAt: string
  lastSyncAt: string
  lastSyncStatus: '' | 'ok' | 'error'
  lastError: string
  deviceCount: number
}

export async function fetchMyPartnerFeeds(ownerUid: string, adminKey?: string): Promise<PartnerFeedInfo[]> {
  try {
    // 관리자 키가 있으면 전체 소스, 없으면 소유자 기준 목록을 조회한다.
    const res = await fetch(adminKey ? '/api/devices/feeds' : `/api/devices/feeds?uid=${encodeURIComponent(ownerUid.trim())}`, {
      cache: 'no-store',
      headers: adminKey ? { 'x-admin-key': adminKey } : undefined,
    })
    const data = (await res.json().catch(() => null)) as { feeds?: PartnerFeedInfo[] } | null
    return res.ok && Array.isArray(data?.feeds) ? data.feeds : []
  } catch {
    return []
  }
}

export async function registerPartnerFeed(input: {
  name: string
  endpointUrl: string
  apiKey?: string
  ownerUid: string
}): Promise<{ ok: boolean; feed?: PartnerFeedInfo; error?: string }> {
  try {
    const res = await fetch('/api/devices/feeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const data = (await res.json().catch(() => null)) as { feed?: PartnerFeedInfo; message?: string; error?: string } | null
    if (!res.ok || !data?.feed) return { ok: false, error: data?.message || data?.error || '연동 등록에 실패했습니다.' }
    return { ok: true, feed: data.feed }
  } catch {
    return { ok: false, error: '네트워크 오류로 연동 등록에 실패했습니다.' }
  }
}

export async function updatePartnerFeed(
  id: string,
  ownerUid: string,
  patch: { name?: string; endpointUrl?: string; apiKey?: string; enabled?: boolean },
  adminKey?: string,
): Promise<{ ok: boolean; feed?: PartnerFeedInfo; error?: string }> {
  try {
    const res = await fetch('/api/devices/feeds', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(adminKey ? { 'x-admin-key': adminKey } : {}) },
      body: JSON.stringify({ id, ownerUid, ...patch }),
    })
    const data = (await res.json().catch(() => null)) as { feed?: PartnerFeedInfo; error?: string } | null
    if (!res.ok || !data?.feed) return { ok: false, error: data?.error || '수정에 실패했습니다.' }
    return { ok: true, feed: data.feed }
  } catch {
    return { ok: false, error: '네트워크 오류로 수정에 실패했습니다.' }
  }
}

export async function deletePartnerFeed(id: string, ownerUid: string, adminKey?: string): Promise<boolean> {
  try {
    const res = await fetch('/api/devices/feeds', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...(adminKey ? { 'x-admin-key': adminKey } : {}) },
      body: JSON.stringify({ id, ownerUid }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** 파트너 본인 또는 관리자의 수동 동기화 트리거 — feedId 생략 시 전체(관리자만). */
export async function syncPartnerFeed(feedId: string, ownerUid: string, adminKey?: string): Promise<boolean> {
  try {
    const res = await fetch('/api/devices/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(adminKey ? { 'x-admin-key': adminKey } : {}) },
      body: JSON.stringify({ feedId: feedId || undefined, ownerUid: ownerUid || undefined }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ── 이용자 지도/목록용 파트너 변환 ──────────────────────────────────────────

export function mobilityPartnersForService(service: string): RegisteredNearbyPartner[] {
  return cache
    .filter((device) => deviceMatchesService(device.kind, service))
    .map((device) => ({
      id: deviceSpotId(device),
      name: device.model ? `${device.serial} · ${device.model}` : device.serial,
      lat: device.lat,
      lng: device.lng,
      extra: device.address,
      brand: device.ownerName || '미등록 파트너',
      rate: device.kind === '자전거' ? '0.2 Pi' : '0.3 Pi',
      rentable: isDeviceRentable(device),
      statusLabel: MOBILITY_STATUS_LABEL[device.status],
      battery: device.battery,
    }))
}
