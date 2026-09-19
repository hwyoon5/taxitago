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

export type SafeCallSession = {
  rideId: string
  status: SafeCallStatus
  passengerVirtual: string
  driverVirtual: string
  passengerPhoneHash: string
  driverPhoneHash: string
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
  startedAt: string | null
}

export type PublicChatRoom = {
  rideId: string
  status: ChatRoomStatus
  closeReason: ChatRoom['closeReason']
  closedAt: string | null
  messages: ChatMessage[]
}
