export type SupportActor = 'passenger' | 'driver' | 'admin'

export type SosStatus = 'open' | 'acked' | 'resolved'

export type SosAlert = {
  id: string
  rideId: string
  fromId: string
  fromRole: Exclude<SupportActor, 'admin'>
  lat: number
  lng: number
  accuracyM: number | null
  vehicle: string
  plate: string
  driverName: string
  driverId: string | null
  passengerId: string
  route: string
  note: string
  status: SosStatus
  createdAt: string
  updatedAt: string
}

export type LostKind = 'lost' | 'found'
export type LostItemType = '휴대폰' | '지갑' | '가방' | '우산' | '의류' | '기타'
export type LostStatus = 'open' | 'matched' | 'talking' | 'returned' | 'closed'

export type LostMessage = {
  id: string
  itemId: string
  fromId: string
  fromRole: SupportActor
  text: string
  at: string
}

export type ReporterInfo = {
  label: string
  name: string
  phone: string
}

export type LostItem = {
  id: string
  kind: LostKind
  itemType: LostItemType
  description: string
  occurredAt: string
  rideId: string | null
  route: string
  reporterId: string
  reporterRole: Exclude<SupportActor, 'admin'>
  reporter?: ReporterInfo
  driverId: string | null
  driverName: string
  passengerId: string | null
  plate: string
  vehicle: string
  status: LostStatus
  messages: LostMessage[]
  /** 첨부 사진 수 — 실제 이미지는 taxitago:attach:{id} 에 따로 저장된다. */
  photoCount?: number
  createdAt: string
  updatedAt: string
}

export type TicketCategory = 'fare_dispute' | 'general' | 'payment' | 'safety' | 'lost'
export type TicketStatus = 'received' | 'assigned' | 'in_progress' | 'waiting' | 'resolved' | 'closed'

/** 관리자 내부 메모 — 고객에게 노출되지 않는 직원 간 기록. */
export type TicketNote = {
  id: string
  staffId: string
  staffName: string
  text: string
  at: string
}

export type TicketMessage = {
  id: string
  ticketId: string
  fromId: string
  fromRole: SupportActor
  text: string
  at: string
  editedAt?: string
  auto?: boolean
}

export type SupportTicket = {
  id: string
  userId: string
  userRole: Exclude<SupportActor, 'admin'>
  category: TicketCategory
  subject: string
  body: string
  rideId: string | null
  status: TicketStatus
  /** 배정된 담당 직원 — 미배정이면 undefined. */
  assigneeId?: string
  assigneeName?: string
  reporter?: ReporterInfo
  messages: TicketMessage[]
  /** 직원 전용 내부 메모 — 고객 화면·API에는 노출되지 않는다. */
  notes?: TicketNote[]
  /** 첨부 사진 수 — 실제 이미지는 taxitago:attach:{id} 에 따로 저장된다. */
  photoCount?: number
  autoResolved?: boolean
  needsReview?: boolean
  createdAt: string
  updatedAt: string
}

export const TICKET_CATEGORY_LABEL: Record<TicketCategory, string> = {
  fare_dispute: '요금 분쟁',
  general: '일반 문의',
  payment: '결제·정산',
  safety: '안전·신고',
  lost: '분실물',
}

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  received: '신규 접수',
  assigned: '담당자 배정됨',
  in_progress: '처리 중',
  waiting: '답변 대기',
  resolved: '답변 완료',
  closed: '종료',
}

export const SOS_STATUS_LABEL: Record<SosStatus, string> = {
  open: '긴급 접수',
  acked: '확인됨',
  resolved: '해제',
}

export const LOST_STATUS_LABEL: Record<LostStatus, string> = {
  open: '접수',
  matched: '기사 매칭',
  talking: '소통 중',
  returned: '반환됨',
  closed: '종료',
}

export const LOST_ITEM_TYPES: LostItemType[] = ['휴대폰', '지갑', '가방', '우산', '의류', '기타']
