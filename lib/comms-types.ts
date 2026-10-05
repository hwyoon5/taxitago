export type CommsRole = 'passenger' | 'driver'

export type ChatRoomStatus = 'open' | 'archived'

export type ChatMessage = {
  id: string
  rideId: string
  senderRole: CommsRole
  senderId: string
  text: string
  at: string
}

export type ChatRoom = {
  rideId: string
  passengerId: string
  driverId: string
  status: ChatRoomStatus
  closeReason: 'completed' | 'cancelled' | null
  closedAt: string | null
  createdAt: string
  messages: ChatMessage[]
}

export type SafeCallStatus = 'idle' | 'ringing' | 'active' | 'ended' | 'released'

// WebRTC 시그널링 메시지 — SDP offer/answer와 ICE candidate를 서버 경유로 중계한다.
// payload에는 SDP 또는 RTCIceCandidateInit JSON이 들어가며 전화번호는 절대 담지 않는다.
export type CallSignalKind = 'offer' | 'answer' | 'ice'

export type CallSignal = {
  id: string
  from: CommsRole
  kind: CallSignalKind
  payload: string
  at: string
}

export type SafeCallSession = {
  rideId: string
  status: SafeCallStatus
  passengerVirtual: string
  driverVirtual: string
  passengerPhoneHash: string
  driverPhoneHash: string
  callerRole?: CommsRole | null
  signals?: CallSignal[]
  startedAt: string | null
  endedAt: string | null
  releasedAt: string | null
}

export type PublicSafeCall = {
  rideId: string
  status: SafeCallStatus
  myVirtualNumber: string
  peerVirtualNumber: string
  peerLabel: string
  realNumberExposed: false
  callerRole: CommsRole | null
  signals: CallSignal[]
  startedAt: string | null
}

export type PublicChatRoom = {
  rideId: string
  status: ChatRoomStatus
  closeReason: ChatRoom['closeReason']
  closedAt: string | null
  messages: ChatMessage[]
}
