export type EscrowStatus = 'pending' | 'held' | 'released' | 'refunded'

export type PublicEscrow = {
  status: EscrowStatus
  amount: number
  lockTxid: string | null
  payoutTxid: string | null
  payoutWallet: string | null
}

export type EscrowRecord = {
  id: string
  rideId: string
  passengerId: string
  driverId: string
  amount: number
  status: EscrowStatus
  lockPaymentId: string | null
  lockTxid: string | null
  payoutTxid: string | null
  payoutWallet: string | null
  payoutUid: string | null
  refundTxid?: string | null
  refundAmount?: number | null
  heldAt: string | null
  releasedAt: string | null
  refundedAt: string | null
  createdAt: string
  updatedAt: string
}

export type SettlementReceipt = {
  rideId: string
  passengerId: string
  driverId: string
  driverName: string
  route: string
  origin: string
  waypoints?: string[]
  dest: string
  amount: number
  estimatedFare: number
  /** 정체 추가 요금(Pi) — 실제 운행 시간이 예상보다 기준치 이상 늦을 때만 산정. */
  trafficSurcharge?: number
  /** 예상 대비 지연 시간(분, 0 이상). */
  trafficDelayMinutes?: number
  /** 길찾기 API 기준 예상 소요 시간(분). */
  expectedMinutes?: number
  /** GPS 실측 주행 거리(km) — 실측 기반으로 최종 요금이 재산정된 경우에만 세팅. */
  actualKm?: number
  lockTxid: string
  payoutTxid: string
  payoutWallet: string
  vehicle: string
  plate: string
  settledAt: string
}

export type DriverEarning = {
  id: string
  driverId: string
  rideId: string
  amount: number
  route: string
  status: 'completed' | 'cancelled'
  at: string
}

export type EarningsPeriodRow = {
  period: string
  count: number
  amount: number
  trips: number
  done: number
  cancel: number
  note: string
}

export type DriverEarningsStats = {
  todayAmount: number
  todayTrips: number
  rating: string
  daily: EarningsPeriodRow[]
  monthly: EarningsPeriodRow[]
  yearly: EarningsPeriodRow[]
  total: EarningsPeriodRow[]
  recent: DriverEarning[]
}
