import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { kvCommand, kvConfigured } from '@/lib/kv'

/**
 * 외부 파트너 기기 피드 소스 레지스트리 — 각 파트너 업체가 운영하는
 * 기기 위치/상태 API 엔드포인트를 등록·관리한다.
 * 스토어 패턴은 device-store와 동일(KV 단일 키 → 파일 → 메모리 폴백).
 */

export type PartnerFeedSource = {
  /** 내부 식별자 'src-XXXXXXXX' — 외부 기기 ID 네임스페이스에도 쓰인다 */
  id: string
  /** 파트너 상호명 — 지도 브랜드 표시와 정산 partnerName으로 사용된다 */
  name: string
  /** 파트너 서버의 피드 엔드포인트 (GET, https 권장) */
  endpointUrl: string
  /** 파트너가 요구하는 Bearer 인증 키 (선택, 미설정 시 무인증 요청) */
  apiKey: string
  /** 동기화 활성 여부 */
  enabled: boolean
  /** 등록한 파트너의 Pi uid — 정산 귀속(partnerId)과 삭제 권한 기준 */
  ownerUid: string
  createdAt: string
  /** 마지막 동기화 시각 (''이면 아직 동기화 안 됨) */
  lastSyncAt: string
  lastSyncStatus: '' | 'ok' | 'error'
  lastError: string
  /** 마지막 동기화가 반영한 기기 수 */
  deviceCount: number
}

const useKv = kvConfigured
const FEEDS_KEY = 'taxitago:partner-feeds'
const MAX_FEEDS = 100
const filePath = path.join(process.cwd(), 'data', 'partner-feeds.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoPartnerFeeds?: PartnerFeedSource[] }
if (!globalStore.__taxitagoPartnerFeeds) globalStore.__taxitagoPartnerFeeds = []

function readFileEntries(): PartnerFeedSource[] {
  try {
    if (!existsSync(filePath)) return []
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { entries?: PartnerFeedSource[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFileEntries(entries: PartnerFeedSource[]) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ entries }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readEntries(): Promise<PartnerFeedSource[]> {
  if (useKv) {
    try {
      const raw = await kvCommand<string | null>(['GET', FEEDS_KEY])
      if (!raw) return []
      const parsed = JSON.parse(raw) as PartnerFeedSource[]
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      console.error('[PartnerFeed] kv read failed; using local fallback', error)
      if (!globalStore.__taxitagoPartnerFeeds!.length) globalStore.__taxitagoPartnerFeeds = readFileEntries()
      return globalStore.__taxitagoPartnerFeeds!
    }
  }
  if (!globalStore.__taxitagoPartnerFeeds!.length) globalStore.__taxitagoPartnerFeeds = readFileEntries()
  return globalStore.__taxitagoPartnerFeeds!
}

async function writeEntries(entries: PartnerFeedSource[]) {
  const trimmed = entries.slice(-MAX_FEEDS)
  if (useKv) {
    try {
      await kvCommand(['SET', FEEDS_KEY, JSON.stringify(trimmed)])
      return
    } catch (error) {
      console.error('[PartnerFeed] kv write failed; falling back to local store', error)
    }
  }
  globalStore.__taxitagoPartnerFeeds = trimmed
  writeFileEntries(trimmed)
}

const sanitize = (value: unknown, max = 128) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

export async function listPartnerFeeds(): Promise<PartnerFeedSource[]> {
  return readEntries()
}

export async function listPartnerFeedsByOwner(ownerUid: string): Promise<PartnerFeedSource[]> {
  const uid = sanitize(ownerUid, 64)
  if (!uid) return []
  return (await readEntries()).filter((row) => row.ownerUid === uid)
}

export async function getPartnerFeed(id: string): Promise<PartnerFeedSource | null> {
  const key = sanitize(id, 40)
  if (!key) return null
  return (await readEntries()).find((row) => row.id === key) ?? null
}

const ENDPOINT_RE = /^https?:\/\/\S{1,400}$/i

/** 피드 소스 등록 — 같은 ownerUid+endpointUrl 조합은 기존 레코드를 갱신한다. */
export async function upsertPartnerFeed(input: {
  name: string
  endpointUrl: string
  apiKey?: string
  ownerUid: string
  enabled?: boolean
}): Promise<PartnerFeedSource | null> {
  const name = sanitize(input.name, 64)
  const endpointUrl = sanitize(input.endpointUrl, 400)
  const ownerUid = sanitize(input.ownerUid, 64)
  const apiKey = sanitize(input.apiKey, 128)
  if (!name || !ownerUid || !ENDPOINT_RE.test(endpointUrl)) return null

  const entries = await readEntries()
  const existing = entries.find((row) => row.ownerUid === ownerUid && row.endpointUrl === endpointUrl)
  if (existing) {
    existing.name = name
    existing.apiKey = apiKey || existing.apiKey
    if (input.enabled !== undefined) existing.enabled = input.enabled === true
    await writeEntries(entries)
    return existing
  }
  const entry: PartnerFeedSource = {
    id: `src-${Math.random().toString(36).slice(2, 10)}`,
    name,
    endpointUrl,
    apiKey,
    enabled: input.enabled !== false,
    ownerUid,
    createdAt: new Date().toISOString(),
    lastSyncAt: '',
    lastSyncStatus: '',
    lastError: '',
    deviceCount: 0,
  }
  entries.push(entry)
  await writeEntries(entries)
  return entry
}

/**
 * 소스 정보 수정 — ownerUid가 일치하거나 관리자(allowAny)여야 한다.
 * 상호명·엔드포인트·API 키·활성 여부를 부분 갱신한다.
 */
export async function updatePartnerFeed(
  id: string,
  patch: { name?: string; endpointUrl?: string; apiKey?: string; enabled?: boolean },
  ownerUid: string,
  allowAny = false,
): Promise<PartnerFeedSource | null> {
  const key = sanitize(id, 40)
  const owner = sanitize(ownerUid, 64)
  if (!key) return null
  const entries = await readEntries()
  const row = entries.find((item) => item.id === key)
  if (!row || (!allowAny && row.ownerUid !== owner)) return null
  if (patch.name !== undefined) {
    const name = sanitize(patch.name, 64)
    if (!name) return null
    row.name = name
  }
  if (patch.endpointUrl !== undefined) {
    const url = sanitize(patch.endpointUrl, 400)
    if (!ENDPOINT_RE.test(url)) return null
    row.endpointUrl = url
  }
  if (patch.apiKey !== undefined) row.apiKey = sanitize(patch.apiKey, 128)
  if (patch.enabled !== undefined) row.enabled = patch.enabled === true
  await writeEntries(entries)
  return row
}

/** 소스 삭제 — ownerUid가 일치하거나 관리자 삭제(allowAny)여야 한다. */
export async function removePartnerFeed(id: string, ownerUid: string, allowAny = false): Promise<boolean> {
  const key = sanitize(id, 40)
  const owner = sanitize(ownerUid, 64)
  if (!key) return false
  const entries = await readEntries()
  const row = entries.find((item) => item.id === key)
  if (!row || (!allowAny && row.ownerUid !== owner)) return false
  await writeEntries(entries.filter((item) => item.id !== key))
  return true
}

/** 동기화 결과를 소스 레코드에 반영한다. */
export async function markPartnerFeedResult(
  id: string,
  result: { ok: boolean; error?: string; deviceCount?: number },
): Promise<void> {
  const entries = await readEntries()
  const row = entries.find((item) => item.id === id)
  if (!row) return
  row.lastSyncAt = new Date().toISOString()
  row.lastSyncStatus = result.ok ? 'ok' : 'error'
  row.lastError = result.ok ? '' : sanitize(result.error, 200)
  if (result.ok && typeof result.deviceCount === 'number') row.deviceCount = result.deviceCount
  await writeEntries(entries)
}

/** 마지막 동기화가 staleMs보다 오래된 활성 소스가 하나라도 있으면 true. */
export async function partnerFeedsStale(staleMs: number): Promise<boolean> {
  const now = Date.now()
  return (await readEntries()).some(
    (row) => row.enabled && (!row.lastSyncAt || now - Date.parse(row.lastSyncAt) > staleMs),
  )
}
