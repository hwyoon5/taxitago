import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

/**
 * 푸시 구독 레지스트리 + 발송 로그 영속 스토어.
 *
 * - 계정 단위 데이터이므로 네트워크 스코프(netKey)를 쓰지 않고 전역 키
 *   'taxitago:pushsubs' / 'taxitago:pushlog'에 저장한다 — broadcast-store와
 *   같은 공용 KV 엔드포인트를 쓴다(전용 KV 분리 시에도 공용 env 우선).
 * - KV 미설정 환경은 data/*.json 파일 + 프로세스 메모리로 폴백한다.
 */

export type PushSubRole = 'driver' | 'user'

export type PushSubRecord = {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
  role?: PushSubRole
  savedAt?: string
}

export type PushLogEntry = {
  id: string
  at: string
  /** 수신자 계정 id (Pi uid 또는 driver id). */
  ownerId: string
  /** 이벤트 종류 — ride-matched | delivery-matched | delivery-progress | payment | settlement | offer | broadcast | sms-fallback */
  kind: string
  title: string
  /** sent | no-subscription | failed | sms-sent | sms-failed */
  status: string
  detail?: string
}

const SUBS_KEY = 'taxitago:pushsubs'
const LOG_KEY = 'taxitago:pushlog'
const MAX_SUBS_PER_OWNER = 5
const MAX_LOG = 300

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const subsFile = path.join(process.cwd(), 'data', 'pushsubs.json')
const logFile = path.join(process.cwd(), 'data', 'pushlog.json')

const globalStore = globalThis as typeof globalThis & {
  __taxitagoPushSubs?: Record<string, PushSubRecord[]>
  __taxitagoPushLog?: PushLogEntry[]
}

async function kvCommand<T>(command: (string | number)[]): Promise<T | null> {
  const res = await fetch(kvUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`kv request failed: ${res.status}`)
  const data = (await res.json()) as { result?: T | null }
  return data.result ?? null
}

function readFileJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeFileJson(file: string, value: unknown) {
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readSubs(): Promise<Record<string, PushSubRecord[]>> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', SUBS_KEY])
    if (!raw) return {}
    try {
      const parsed = JSON.parse(raw) as Record<string, PushSubRecord[]>
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  if (!globalStore.__taxitagoPushSubs) globalStore.__taxitagoPushSubs = readFileJson(subsFile, {})
  return globalStore.__taxitagoPushSubs
}

async function writeSubs(map: Record<string, PushSubRecord[]>) {
  if (useKv) {
    await kvCommand(['SET', SUBS_KEY, JSON.stringify(map)])
    return
  }
  globalStore.__taxitagoPushSubs = map
  writeFileJson(subsFile, map)
}

export async function savePushSubscription(ownerId: string, subscription: PushSubRecord, role: PushSubRole = 'driver') {
  const id = ownerId.trim()
  if (!id || !subscription?.endpoint) return false
  const map = await readSubs()
  const current = map[id] ?? []
  const record: PushSubRecord = { ...subscription, role, savedAt: new Date().toISOString() }
  map[id] = [record, ...current.filter((item) => item.endpoint !== record.endpoint)].slice(0, MAX_SUBS_PER_OWNER)
  await writeSubs(map)
  return true
}

export async function removePushSubscription(ownerId: string, endpoint?: string) {
  const id = ownerId.trim()
  const map = await readSubs()
  if (!endpoint) {
    if (map[id]) {
      delete map[id]
      await writeSubs(map)
    }
    return
  }
  const next = (map[id] ?? []).filter((item) => item.endpoint !== endpoint)
  if (next.length) map[id] = next
  else delete map[id]
  await writeSubs(map)
}

export async function listPushSubscriptions(ownerId: string): Promise<PushSubRecord[]> {
  const map = await readSubs()
  return map[ownerId.trim()] ?? []
}

/** 푸시 구독이 등록된 계정 id 목록 — role 필터로 기사만 좁힐 수 있다. */
export async function subscribedOwnerIds(role?: PushSubRole): Promise<string[]> {
  const map = await readSubs()
  return Object.entries(map)
    .filter(([, subs]) => subs.length > 0 && (!role || subs.some((sub) => (sub.role ?? 'driver') === role)))
    .map(([id]) => id)
}

// ── 발송 로그 ──────────────────────────────────────────────────────────

async function readLog(): Promise<PushLogEntry[]> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', LOG_KEY])
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as PushLogEntry[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  if (!globalStore.__taxitagoPushLog) globalStore.__taxitagoPushLog = readFileJson(logFile, [])
  return globalStore.__taxitagoPushLog
}

/** 발송 로그 적재 — 실패해도 호출 흐름을 막지 않는다(베스트 에포트). */
export async function recordPushLog(entry: Omit<PushLogEntry, 'id' | 'at'>) {
  try {
    const log = await readLog()
    log.unshift({
      id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      ...entry,
    })
    const trimmed = log.slice(0, MAX_LOG)
    if (useKv) await kvCommand(['SET', LOG_KEY, JSON.stringify(trimmed)])
    else {
      globalStore.__taxitagoPushLog = trimmed
      writeFileJson(logFile, trimmed)
    }
  } catch (error) {
    console.warn('[push] log write failed', error instanceof Error ? error.message : error)
  }
}

export async function listPushLog(limit = 100): Promise<PushLogEntry[]> {
  const log = await readLog()
  return log.slice(0, Math.max(1, Math.min(limit, MAX_LOG)))
}
