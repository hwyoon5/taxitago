import { kvCommand, kvConfigured } from '@/lib/kv'

export type PresenceRole = 'passenger' | 'driver' | 'partner'
export const PRESENCE_ROLES: PresenceRole[] = ['passenger', 'driver', 'partner']

/** 이 시간(ms) 안에 하트비트가 들어온 이용자만 '온라인'으로 집계한다.
 *  클라이언트는 25초 주기로 비트를 보내므로 창을 닫거나 백그라운드로
 *  내려간 앱은 최대 90초 뒤에 접속자 수에서 빠진다. */
const ONLINE_WINDOW_MS = 90_000
const KEY_PREFIX = 'taxitago:presence:'

type MemoryBucket = { users: Map<string, number> }
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
  for (const [id, at] of bucket.users) {
    if (now - at > ONLINE_WINDOW_MS) bucket.users.delete(id)
  }
}

function beatMemory(id: string, role: PresenceRole, now: number) {
  const bucket = memStore()[role]
  bucket.users.set(id, now)
  prune(bucket, now)
}

/** 앱 하트비트 1건 기록 — KV(ZSET) 우선, 장애·미설정 시 인스턴스 메모리로 집계. */
export async function beatPresence(id: string, role: PresenceRole): Promise<void> {
  const now = Date.now()
  if (kvConfigured) {
    try {
      const key = `${KEY_PREFIX}${role}`
      await kvCommand(['ZADD', key, now, id])
      await kvCommand(['ZREMRANGEBYSCORE', key, '-inf', now - ONLINE_WINDOW_MS])
      return
    } catch {
      // KV 장애 시에도 하트비트를 버리지 않고 메모리 집계로 폴백한다.
    }
  }
  beatMemory(id, role, now)
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
