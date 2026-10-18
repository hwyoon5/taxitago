import { createHash } from 'crypto'
import { getDriver, getRide, nowIso } from '@/lib/dispatch-store'
import { getChatRoom, getSafeCall, publishRide, saveChatRoom, saveSafeCall } from '@/lib/comms-store'
import { detectChatLang, translateChatAll, translateChatText } from '@/lib/chat-translate'
import { getRegistryUser } from '@/lib/user-registry'
import { complianceGate } from '@/lib/compliance-store'
import type { CallSignal, CallSignalKind, ChatLang, ChatMessage, ChatRoom, CommsRole, PublicChatRoom, PublicSafeCall, SafeCallSession } from '@/lib/comms-types'

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

function publicRoom(room: ChatRoom): PublicChatRoom {
  return {
    rideId: room.rideId,
    status: room.status,
    closeReason: room.closeReason,
    closedAt: room.closedAt,
    messages: room.messages,
  }
}

export async function openRideComms(rideId: string) {
  const existingRoom = await getChatRoom(rideId)
  if (existingRoom) {
    const call = await getSafeCall(rideId)
    return { room: existingRoom, call }
  }
  const ride = getRide(rideId)
  // 활성 배차('assigned')에서만 방을 연다 — 취소·완료·미매칭 건에 방을 새로
  // 만들거나 아카이브된 세션을 부활시키지 않는다.
  if (!ride?.assignedDriverId || ride.status !== 'assigned') return null
  const createdAt = nowIso()
  const intro = await translateChatAll('안녕하세요. 배차된 기사입니다. 곧 도착할게요.')
  const room = await saveChatRoom({
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
        sourceLang: intro.sourceLang,
        translations: intro.translations,
        at: createdAt,
      },
    ],
  })
  const call = await saveSafeCall({
    rideId,
    status: 'idle',
    passengerVirtual: virtualNumber(rideId, '8'),
    driverVirtual: virtualNumber(`${rideId}:driver`, '7'),
    passengerPhoneHash: hashSecret(`passenger:${ride.passengerId}`),
    driverPhoneHash: hashSecret(`driver:${ride.assignedDriverId}`),
    callerRole: null,
    signals: [],
    startedAt: null,
    endedAt: null,
    releasedAt: null,
  })
  return { room, call }
}

export async function archiveRideComms(rideId: string, reason: 'completed' | 'cancelled') {
  const room = await getChatRoom(rideId)
  if (room && room.status === 'open') {
    room.status = 'archived'
    room.closeReason = reason
    room.closedAt = nowIso()
    await saveChatRoom(room)
    publishRide(rideId, { type: 'archived', reason, at: room.closedAt })
  }
  const call = await getSafeCall(rideId)
  if (call && call.status !== 'released') {
    call.status = 'released'
    call.endedAt = call.endedAt || nowIso()
    call.releasedAt = nowIso()
    // 만료된 세션의 WebRTC 시그널도 함께 비운다.
    call.signals = []
    await saveSafeCall(call)
  }
}

/**
 * 라이드가 이미 종료 상태인데 통신 세션(방·통화)이 열린 채 남았으면 즉시
 * 아카이브/해제한다 — 아카이브 호출 누락이나 서버리스 스냅샷 복원으로 생긴
 * 좀비 세션을 접근 경로에서 지연 보정한다. 'unmatched'는 취소와 동일하게 정리.
 */
async function settleTerminalComms(rideId: string) {
  const ride = getRide(rideId)
  if (!ride) return
  if (ride.status === 'completed') await archiveRideComms(rideId, 'completed')
  else if (ride.status === 'cancelled' || ride.status === 'unmatched') await archiveRideComms(rideId, 'cancelled')
}

/**
 * 기사 측 통신 권한 — 자격 인증 미승인·반려 계정은 채팅·안심번호를 차단한다.
 * 레지스트리에 없는 단말(테스트넷 개발 기기)은 presence 게이트와 같이 허용.
 */
async function assertDriverCompliant(driverId: string) {
  const user = await getRegistryUser(driverId).catch(() => null)
  if (!user || user.withdrawnAt) return { ok: true as const }
  const gate = await complianceGate(user).catch(() => null)
  if (gate && !gate.ok) return { ok: false as const, error: 'compliance' }
  return { ok: true as const }
}

async function assertMember(rideId: string, actorId: string, role: CommsRole, opts: { skipCompliance?: boolean } = {}) {
  const ride = getRide(rideId)
  if (ride) {
    if (role === 'passenger' && ride.passengerId !== actorId) return { ok: false as const, error: 'forbidden' }
    if (role === 'driver' && ride.assignedDriverId !== actorId) return { ok: false as const, error: 'forbidden' }
  } else {
    const room = await getChatRoom(rideId)
    if (!room) return { ok: false as const, error: 'not_found' }
    if (role === 'passenger' && room.passengerId !== actorId) return { ok: false as const, error: 'forbidden' }
    if (role === 'driver' && room.driverId !== actorId) return { ok: false as const, error: 'forbidden' }
  }
  // 기사 자격 인증 게이트 — 멤버십 확인 후 적용한다(승객 읽기·쓰기는 영향 없음).
  if (role === 'driver' && !opts.skipCompliance) {
    const compliant = await assertDriverCompliant(actorId)
    if (!compliant.ok) return compliant
  }
  return { ok: true as const }
}

/**
 * 이전에 번역이 없던 메시지(기능 도입 전 데이터 등)를 읽는 시점 언어로 지연 번역해 채운다.
 * 번역 결과는 방에 저장되므로 같은 언어 조회는 한 번만 번역기를 호출한다.
 */
async function backfillTranslations(room: ChatRoom, lang: ChatLang) {
  let changed = false
  for (const message of room.messages) {
    const source = message.sourceLang ?? detectChatLang(message.text)
    if (!message.sourceLang) {
      message.sourceLang = source
      changed = true
    }
    if (source === lang || message.translations?.[lang]) continue
    const translated = await translateChatText(message.text, source, lang)
    if (translated) {
      message.translations = { ...message.translations, [lang]: translated }
      changed = true
    }
  }
  if (changed) await saveChatRoom(room)
}

export async function listChatMessages(rideId: string, actorId: string, role: CommsRole, after?: string, lang?: ChatLang) {
  const gate = await assertMember(rideId, actorId, role)
  if (!gate.ok) return gate
  await settleTerminalComms(rideId)
  const room = (await getChatRoom(rideId)) ?? (await openRideComms(rideId))?.room
  if (!room) return { ok: false as const, error: 'not_found' }
  if (lang) await backfillTranslations(room, lang)
  const messages = after ? room.messages.filter((item) => item.at > after || item.id > after) : room.messages
  return { ok: true as const, room: { ...publicRoom(room), messages } }
}

export async function postChatMessage(input: { rideId: string; actorId: string; role: CommsRole; text: string }) {
  const gate = await assertMember(input.rideId, input.actorId, input.role)
  if (!gate.ok) return { ok: false as const, error: gate.error, message: null as ChatMessage | null }
  await settleTerminalComms(input.rideId)
  const room = (await getChatRoom(input.rideId)) ?? (await openRideComms(input.rideId))?.room
  if (!room) return { ok: false as const, error: 'not_found', message: null }
  if (room.status !== 'open') return { ok: false as const, error: 'archived', message: null }
  const text = input.text.trim().slice(0, 500)
  if (!text) return { ok: false as const, error: 'empty', message: null }
  const { sourceLang, translations } = await translateChatAll(text)
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    rideId: input.rideId,
    senderRole: input.role,
    senderId: input.actorId,
    text,
    sourceLang,
    translations,
    at: nowIso(),
  }
  room.messages = [...room.messages, message].slice(-200)
  await saveChatRoom(room)
  publishRide(input.rideId, { type: 'message', message })

  const driver = getDriver(room.driverId)
  if (input.role === 'passenger' && driver?.virtual && room.status === 'open') {
    const replyText = autoReply(text)
    const replyLang = await translateChatAll(replyText)
    const reply: ChatMessage = {
      id: crypto.randomUUID(),
      rideId: input.rideId,
      senderRole: 'driver',
      senderId: room.driverId,
      text: replyText,
      sourceLang: replyLang.sourceLang,
      translations: replyLang.translations,
      at: nowIso(),
    }
    const latest = (await getChatRoom(input.rideId)) ?? room
    latest.messages = [...latest.messages, reply].slice(-200)
    await saveChatRoom(latest)
    publishRide(input.rideId, { type: 'message', message: reply })
    return { ok: true as const, message, room: publicRoom(latest) }
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
    peerLabel: role === 'passenger' ? '기사' : '승객',
    realNumberExposed: false,
    callerRole: session.callerRole ?? null,
    signals: session.signals ?? [],
    startedAt: session.startedAt,
  }
}

export async function startSafeCall(input: { rideId: string; actorId: string; role: CommsRole; realPhone?: string }) {
  const gate = await assertMember(input.rideId, input.actorId, input.role)
  if (!gate.ok) return { ok: false as const, error: gate.error, call: null as PublicSafeCall | null }
  await settleTerminalComms(input.rideId)
  const session = (await getSafeCall(input.rideId)) ?? (await openRideComms(input.rideId))?.call
  if (!session) return { ok: false as const, error: 'not_found', call: null }
  if (session.status === 'released') return { ok: false as const, error: 'released', call: publicSafeCall(session, input.role) }
  // 인앱 음성 통화는 실제 전화번호를 서버에 저장하지 않는다(realPhone 무시).
  // 이미 ringing/active면 기존 시그널을 유지하고, idle/ended일 때만 새 통화로 리셋한다.
  if (session.status === 'idle' || session.status === 'ended') {
    session.status = 'ringing'
    session.callerRole = input.role
    session.signals = []
    session.startedAt = nowIso()
    session.endedAt = null
    await saveSafeCall(session)
    publishRide(input.rideId, { type: 'call', status: session.status })
  }
  return { ok: true as const, call: publicSafeCall(session, input.role) }
}

// WebRTC 시그널 중계 — offer/answer/ICE candidate를 세션 메일박스에 추가해
// 상대방이 폴링으로 가져가게 한다. ringing/active 상태에서만 유효하다.
export async function appendCallSignal(input: { rideId: string; actorId: string; role: CommsRole; kind: CallSignalKind; payload: string }) {
  const gate = await assertMember(input.rideId, input.actorId, input.role)
  if (!gate.ok) return { ok: false as const, error: gate.error, call: null as PublicSafeCall | null }
  await settleTerminalComms(input.rideId)
  const session = await getSafeCall(input.rideId)
  if (!session) return { ok: false as const, error: 'not_found', call: null }
  if (session.status === 'released') return { ok: false as const, error: 'released', call: publicSafeCall(session, input.role) }
  if (session.status !== 'ringing' && session.status !== 'active') {
    return { ok: false as const, error: 'not_calling', call: publicSafeCall(session, input.role) }
  }
  const signal: CallSignal = {
    id: crypto.randomUUID(),
    from: input.role,
    kind: input.kind,
    payload: input.payload.slice(0, 20000),
    at: nowIso(),
  }
  session.signals = [...(session.signals ?? []), signal].slice(-120)
  await saveSafeCall(session)
  publishRide(input.rideId, { type: 'call-signal' })
  return { ok: true as const, call: publicSafeCall(session, input.role) }
}

export async function answerSafeCall(rideId: string, actorId: string, role: CommsRole) {
  const gate = await assertMember(rideId, actorId, role)
  if (!gate.ok) return { ok: false as const, error: gate.error, call: null as PublicSafeCall | null }
  await settleTerminalComms(rideId)
  const session = await getSafeCall(rideId)
  if (!session) return { ok: false as const, error: 'not_found', call: null }
  if (session.status === 'released') return { ok: false as const, error: 'released', call: publicSafeCall(session, role) }
  if (session.status === 'ringing') session.startedAt = nowIso()
  session.status = 'active'
  await saveSafeCall(session)
  publishRide(rideId, { type: 'call', status: session.status })
  return { ok: true as const, call: publicSafeCall(session, role) }
}

export async function hangupSafeCall(rideId: string, actorId: string, role: CommsRole) {
  // 종료 동작은 자격 인증 상태와 무관하게 허용 — 세션을 닫지 못하게 막지 않는다.
  const gate = await assertMember(rideId, actorId, role, { skipCompliance: true })
  if (!gate.ok) return { ok: false as const, error: gate.error, call: null as PublicSafeCall | null }
  const session = await getSafeCall(rideId)
  if (!session) return { ok: false as const, error: 'not_found', call: null }
  if (session.status !== 'released') {
    session.status = 'ended'
    session.endedAt = nowIso()
    await saveSafeCall(session)
    publishRide(rideId, { type: 'call', status: session.status })
  }
  return { ok: true as const, call: publicSafeCall(session, role) }
}

export async function getPublicSafeCall(rideId: string, actorId: string, role: CommsRole) {
  const gate = await assertMember(rideId, actorId, role)
  if (!gate.ok) return { ok: false as const, error: gate.error, call: null as PublicSafeCall | null }
  await settleTerminalComms(rideId)
  const session = (await getSafeCall(rideId)) ?? (await openRideComms(rideId))?.call
  if (!session) return { ok: false as const, error: 'not_found', call: null }
  return { ok: true as const, call: publicSafeCall(session, role) }
}
