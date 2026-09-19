import type { ChatRoom, SafeCallSession } from '@/lib/comms-types'

type Listener = (payload: string) => void

type CommsDb = {
  rooms: Map<string, ChatRoom>
  calls: Map<string, SafeCallSession>
  listeners: Map<string, Set<Listener>>
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

export function getChatRoom(rideId: string) {
  return db().rooms.get(rideId) ?? null
}

export function saveChatRoom(room: ChatRoom) {
  db().rooms.set(room.rideId, room)
  return room
}

export function getSafeCall(rideId: string) {
  return db().calls.get(rideId) ?? null
}

export function saveSafeCall(session: SafeCallSession) {
  db().calls.set(session.rideId, session)
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
