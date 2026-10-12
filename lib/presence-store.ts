import { kvCommand, kvConfigured } from '@/lib/kv'

export type PresenceRole = 'passenger' | 'driver' | 'partner'
export const PRESENCE_ROLES: PresenceRole[] = ['passenger', 'driver', 'partner']

/** 이 시간(ms) 안에 하트비트가 들어온 이용자만 '온라인'으로 집계한다.
 *  클라이언트는 25초 주기로 비트를 보내므로 창을 닫거나 백그라운드로
 *  내려간 앱은 최대 90초 뒤에 접속자 수에서 빠진다. */
const ONLINE_WINDOW_MS = 90_000
const KEY_PREFIX = 'taxitago:presence:'
/** 관제 대시보드용 상세 — ZSET 카운트와 별개로 역할별 해시에 마지막 위치를 남긴다. */
const DETAIL_PREFIX = 'taxitago:presence:detail:'

type MemoryEntry = { at: number; lat?: number; lng?: number }
type MemoryBucket = { users: Map<string, MemoryEntry> }
const globalStore = globalThis as typeof globalThis & { __taxitagoPresence?: Record<PresenceRole, MemoryBucket> }

function memStore(): Record<PresenceRole, MemoryBucket> {
  if (!globalStore.__taxitagoPresence) {
    globalStore.__taxitagoPresence = {
      passenger: { users: new Map() },
      driver: { users: new Map() },
      partner: { users: new Map() },
    }
  }
  return globalStore.__taxitagoPresence
}

function prune(bucket: MemoryBucket, now: number) {
  for (const [id, entry] of bucket.users) {
    if (now - entry.at > ONLINE_WINDOW_MS) bucket.users.delete(id)
  }
}

function beatMemory(id: string, role: PresenceRole, now: number, loc?: { lat?: number; lng?: number }) {
  const bucket = memStore()[role]
  bucket.users.set(id, { at: now, lat: loc?.lat, lng: loc?.lng })
  prune(bucket, now)
}

export type PresenceDetail = { id: string; lastSeen: number; lat?: number; lng?: number }

/** 앱 하트비트 1건 기록 — KV(ZSET+HASH) 우선, 장애·미설정 시 인스턴스 메모리로 집계. */
export async function beatPresence(id: string, role: PresenceRole, loc?: { lat?: number; lng?: number }): Promise<void> {
  const now = Date.now()
  if (kvConfigured) {
    try {
      const key = `${KEY_PREFIX}${role}`
      await kvCommand(['ZADD', key, now, id])
      await kvCommand(['ZREMRANGEBYSCORE', key, '-inf', now - ONLINE_WINDOW_MS])
      await kvCommand(['HSET', `${DETAIL_PREFIX}${role}`, id, JSON.stringify({ lastSeen: now, lat: loc?.lat, lng: loc?.lng })])
      return
    } catch {
      // KV 장애 시에도 하트비트를 버리지 않고 메모리 집계로 폴백한다.
    }
  }
  beatMemory(id, role, now, loc)
}

/** 역할별 현재 접속자 수 — 만료 멤버를 정리한 뒤 ZCARD로 집계한다. */
export async function presenceCounts(): Promise<Record<PresenceRole, number>> {
  const now = Date.now()
  const counts: Record<PresenceRole, number> = { passenger: 0, driver: 0, partner: 0 }
  for (const role of PRESENCE_ROLES) {
    if (kvConfigured) {
      try {
        const key = `${KEY_PREFIX}${role}`
        await kvCommand(['ZREMRANGEBYSCORE', key, '-inf', now - ONLINE_WINDOW_MS])
        const card = await kvCommand<number>(['ZCARD', key])
        counts[role] = typeof card === 'number' && card >= 0 ? card : 0
        continue
      } catch {
        // KV 실패 시 이 인스턴스 메모리 값으로라도 응답한다.
      }
    }
    const bucket = memStore()[role]
    prune(bucket, now)
    counts[role] = bucket.users.size
  }
  return counts
}

/** 역할별 접속자 상세(마지막 위치·비트 시각) — 관리자 관제 대시보드 전용. */
export async function presenceDetails(role: PresenceRole): Promise<PresenceDetail[]> {
  const now = Date.now()
  if (kvConfigured) {
    try {
      const raw = await kvCommand<Record<string, string> | string[] | null>(['HGETALL', `${DETAIL_PREFIX}${role}`])
      const values = Array.isArray(raw)
        ? Array.from({ length: Math.floor(raw.length / 2) }, (_, i) => [raw[i * 2], raw[i * 2 + 1]] as const)
        : raw && typeof raw === 'object'
          ? Object.entries(raw)
          : []
      const online: PresenceDetail[] = []
      const stale: string[] = []
      for (const [id, value] of values) {
        try {
          const entry = JSON.parse(value) as { lastSeen?: number; lat?: number; lng?: number }
          if (typeof entry.lastSeen === 'number' && now - entry.lastSeen <= ONLINE_WINDOW_MS) {
            online.push({ id, lastSeen: entry.lastSeen, lat: entry.lat, lng: entry.lng })
          } else {
            stale.push(id)
          }
        } catch {
          stale.push(id)
        }
      }
      if (stale.length) await kvCommand(['HDEL', `${DETAIL_PREFIX}${role}`, ...stale]).catch(() => undefined)
      return online
    } catch {
      // KV 실패 시 이 인스턴스 메모리 값으로라도 응답한다.
    }
  }
  const bucket = memStore()[role]
  prune(bucket, now)
  return [...bucket.users.entries()].map(([id, entry]) => ({ id, lastSeen: entry.at, lat: entry.lat, lng: entry.lng }))
}
