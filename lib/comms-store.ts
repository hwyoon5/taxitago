import type { ChatRoom, SafeCallSession } from '@/lib/comms-types'

type Listener = (payload: string) => void

type CommsDb = {
  rooms: Map<string, ChatRoom>
  calls: Map<string, SafeCallSession>
  listeners: Map<string, Set<Listener>>
}

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

export function commsStorageBackend() {
  return useKv ? ('kv' as const) : ('memory' as const)
}

let warnedEphemeral = false
function warnEphemeral() {
  if (warnedEphemeral || !process.env.VERCEL) return
  warnedEphemeral = true
  console.error('[comms-store] no KV configured on Vercel — ride chat is NOT shared across instances (set KV_REST_API_URL/KV_REST_API_TOKEN)')
}

const roomKey = (rideId: string) => `taxitago:comms:room:${rideId}`
const callKey = (rideId: string) => `taxitago:comms:call:${rideId}`

async function kvCommand<T>(command: (string | number)[]): Promise<T | null> {
  const res = await fetch(kvUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`kv request failed: ${res.status}`)
  const data = (await res.json()) as { result?: T | null }
  return data.result ?? null
}

async function kvGet<T>(key: string): Promise<T | null> {
  const raw = await kvCommand<string | null>(['GET', key])
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function db(): CommsDb {
  const globalStore = globalThis as typeof globalThis & { __taxitagoComms?: CommsDb }
  if (!globalStore.__taxitagoComms) {
    globalStore.__taxitagoComms = {
      rooms: new Map(),
      calls: new Map(),
      listeners: new Map(),
    }
  }
  return globalStore.__taxitagoComms
}

export async function getChatRoom(rideId: string): Promise<ChatRoom | null> {
  if (useKv) return kvGet<ChatRoom>(roomKey(rideId))
  warnEphemeral()
  return db().rooms.get(rideId) ?? null
}

export async function saveChatRoom(room: ChatRoom): Promise<ChatRoom> {
  db().rooms.set(room.rideId, room)
  if (useKv) await kvCommand(['SET', roomKey(room.rideId), JSON.stringify(room)])
  else warnEphemeral()
  return room
}

export async function getSafeCall(rideId: string): Promise<SafeCallSession | null> {
  if (useKv) return kvGet<SafeCallSession>(callKey(rideId))
  warnEphemeral()
  return db().calls.get(rideId) ?? null
}

export async function saveSafeCall(session: SafeCallSession): Promise<SafeCallSession> {
  db().calls.set(session.rideId, session)
  if (useKv) await kvCommand(['SET', callKey(session.rideId), JSON.stringify(session)])
  else warnEphemeral()
  return session
}

export function subscribeRide(rideId: string, listener: Listener) {
  const store = db()
  const set = store.listeners.get(rideId) ?? new Set<Listener>()
  set.add(listener)
  store.listeners.set(rideId, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) store.listeners.delete(rideId)
  }
}

export function publishRide(rideId: string, payload: unknown) {
  const encoded = `data: ${JSON.stringify(payload)}\n\n`
  const listeners = db().listeners.get(rideId)
  if (!listeners) return
  for (const listener of listeners) listener(encoded)
}
