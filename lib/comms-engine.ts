import { createHash } from 'crypto'
import { getDriver, getRide, nowIso } from '@/lib/dispatch-store'
import { getChatRoom, getSafeCall, publishRide, saveChatRoom, saveSafeCall } from '@/lib/comms-store'
import type { ChatMessage, CommsRole, PublicChatRoom, PublicSafeCall, SafeCallSession } from '@/lib/comms-types'

function hashSecret(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function virtualNumber(seed: string, prefix: '7' | '8') {
  let n = 0
  for (let i = 0; i < seed.length; i += 1) n = (n * 33 + seed.charCodeAt(i)) >>> 0
  const mid = String(1000 + (n % 9000))
  const last = String(1000 + ((n >> 7) % 9000))
  return `050-${prefix}${mid.slice(1)}-${last}`
}

function publicRoom(room: NonNullable<ReturnType<typeof getChatRoom>>): PublicChatRoom {
  return {
    rideId: room.rideId,
    status: room.status,
    closeReason: room.closeReason,
    closedAt: room.closedAt,
    messages: room.messages,
  }
}

export function openRideComms(rideId: string) {
  const ride = getRide(rideId)
  if (!ride?.assignedDriverId) return null
  const createdAt = nowIso()
  const existingRoom = getChatRoom(rideId)
  const room = existingRoom ?? saveChatRoom({
    rideId,
    passengerId: ride.passengerId,
    driverId: ride.assignedDriverId,
    status: 'open',
    closeReason: null,
    closedAt: null,
    createdAt,
    messages: [
      {
        id: crypto.randomUUID(),
        rideId,
        senderRole: 'driver',
        senderId: ride.assignedDriverId,
        text: '안녕하세요. 배차된 기사입니다. 곧 도착할게요.',
        at: createdAt,
      },
    ],
  })
  const existingCall = getSafeCall(rideId)
  const call = existingCall ?? saveSafeCall({
    rideId,
    status: 'idle',
    passengerVirtual: virtualNumber(rideId, '8'),
    driverVirtual: virtualNumber(`${rideId}:driver`, '7'),
    passengerPhoneHash: hashSecret(`passenger:${ride.passengerId}`),
    driverPhoneHash: hashSecret(`driver:${ride.assignedDriverId}`),
    startedAt: null,
    endedAt: null,
    releasedAt: null,
  })
  return { room, call }
}

export function archiveRideComms(rideId: string, reason: 'completed' | 'cancelled') {
  const room = getChatRoom(rideId)
  if (room && room.status === 'open') {
    room.status = 'archived'
    room.closeReason = reason
    room.closedAt = nowIso()
    saveChatRoom(room)
    publishRide(rideId, { type: 'archived', reason, at: room.closedAt })
  }
  const call = getSafeCall(rideId)
  if (call && call.status !== 'released') {
    call.status = 'released'
    call.endedAt = call.endedAt || nowIso()
    call.releasedAt = nowIso()
    saveSafeCall(call)
  }
}

function assertMember(rideId: string, actorId: string, role: CommsRole) {
  const ride = getRide(rideId)
  if (!ride) return { ok: false as const, error: 'not_found' }
  if (role === 'passenger' && ride.passengerId !== actorId) return { ok: false as const, error: 'forbidden' }
  if (role === 'driver' && ride.assignedDriverId !== actorId) return { ok: false as const, error: 'forbidden' }
  return { ok: true as const, ride }
}

export function listChatMessages(rideId: string, actorId: string, role: CommsRole, after?: string) {
  const gate = assertMember(rideId, actorId, role)
  if (!gate.ok) return gate
  const room = getChatRoom(rideId) ?? openRideComms(rideId)?.room
  if (!room) return { ok: false as const, error: 'not_found' }
  const messages = after ? room.messages.filter((item) => item.at > after || item.id > after) : room.messages
  return { ok: true as const, room: { ...publicRoom(room), messages } }
}

export function postChatMessage(input: { rideId: string; actorId: string; role: CommsRole; text: string }) {
  const gate = assertMember(input.rideId, input.actorId, input.role)
  if (!gate.ok) return { ok: false as const, error: gate.error, message: null as ChatMessage | null }
  const opened = openRideComms(input.rideId)
  const room = opened?.room ?? getChatRoom(input.rideId)
  if (!room) return { ok: false as const, error: 'not_found', message: null }
  if (room.status !== 'open') return { ok: false as const, error: 'archived', message: null }
  const text = input.text.trim().slice(0, 500)
  if (!text) return { ok: false as const, error: 'empty', message: null }
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    rideId: input.rideId,
    senderRole: input.role,
    senderId: input.actorId,
    text,
    at: nowIso(),
  }
  room.messages = [...room.messages, message].slice(-200)
  saveChatRoom(room)
  publishRide(input.rideId, { type: 'message', message })

  const driver = getDriver(room.driverId)
  if (input.role === 'passenger' && driver?.virtual && room.status === 'open') {
    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      rideId: input.rideId,
      senderRole: 'driver',
      senderId: room.driverId,
      text: autoReply(text),
      at: nowIso(),
    }
    room.messages = [...room.messages, reply].slice(-200)
    saveChatRoom(room)
    publishRide(input.rideId, { type: 'message', message: reply })
  }
  return { ok: true as const, message, room: publicRoom(room) }
}

function autoReply(text: string) {
  if (text.includes('문 앞')) return '네, 곧 내리겠습니다.'
  if (text.includes('안전')) return '네, 안전 운전하겠습니다.'
  if (text.includes('빨리')) return '최대한 빠르게 갈게요.'
  if (text.includes('짐')) return '트렁크 열어둘게요.'
  return '네, 확인했습니다. 안심번호로도 연락할 수 있어요.'
}

export function publicSafeCall(session: SafeCallSession, role: CommsRole): PublicSafeCall {
  return {
    rideId: session.rideId,
    status: session.status,
    myVirtualNumber: role === 'passenger' ? session.passengerVirtual : session.driverVirtual,
    peerVirtualNumber: role === 'passenger' ? session.driverVirtual : session.passengerVirtual,
    peerLabel: role === 'passenger' ? '기사 안심번호' : '승객 안심번호',
    realNumberExposed: false,
    startedAt: session.startedAt,
  }
}

export function startSafeCall(input: { rideId: string; actorId: string; role: CommsRole; realPhone?: string }) {
  const gate = assertMember(input.rideId, input.actorId, input.role)
  if (!gate.ok) return { ok: false as const, error: gate.error, call: null as PublicSafeCall | null }
  const opened = openRideComms(input.rideId)
  const session = opened?.call ?? getSafeCall(input.rideId)
  if (!session) return { ok: false as const, error: 'not_found', call: null }
  if (session.status === 'released') return { ok: false as const, error: 'released', call: publicSafeCall(session, input.role) }
  if (input.realPhone?.trim()) {
    const hashed = hashSecret(input.realPhone.replace(/\D/g, ''))
    if (input.role === 'passenger') session.passengerPhoneHash = hashed
    else session.driverPhoneHash = hashed
  }
  session.status = 'ringing'
  session.startedAt = session.startedAt || nowIso()
  saveSafeCall(session)
  publishRide(input.rideId, { type: 'call', status: session.status })
  return { ok: true as const, call: publicSafeCall(session, input.role) }
}

export function answerSafeCall(rideId: string, actorId: string, role: CommsRole) {
  const gate = assertMember(rideId, actorId, role)
  if (!gate.ok) return { ok: false as const, error: gate.error, call: null as PublicSafeCall | null }
  const session = getSafeCall(rideId)
  if (!session) return { ok: false as const, error: 'not_found', call: null }
  if (session.status === 'released') return { ok: false as const, error: 'released', call: publicSafeCall(session, role) }
  session.status = 'active'
  saveSafeCall(session)
  publishRide(rideId, { type: 'call', status: session.status })
  return { ok: true as const, call: publicSafeCall(session, role) }
}

export function hangupSafeCall(rideId: string, actorId: string, role: CommsRole) {
  const gate = assertMember(rideId, actorId, role)
  if (!gate.ok) return { ok: false as const, error: gate.error, call: null as PublicSafeCall | null }
  const session = getSafeCall(rideId)
  if (!session) return { ok: false as const, error: 'not_found', call: null }
  if (session.status !== 'released') {
    session.status = 'ended'
    session.endedAt = nowIso()
    saveSafeCall(session)
    publishRide(rideId, { type: 'call', status: session.status })
  }
  return { ok: true as const, call: publicSafeCall(session, role) }
}

export function getPublicSafeCall(rideId: string, actorId: string, role: CommsRole) {
  const gate = assertMember(rideId, actorId, role)
  if (!gate.ok) return { ok: false as const, error: gate.error, call: null as PublicSafeCall | null }
  const session = getSafeCall(rideId) ?? openRideComms(rideId)?.call
  if (!session) return { ok: false as const, error: 'not_found', call: null }
  return { ok: true as const, call: publicSafeCall(session, role) }
}
