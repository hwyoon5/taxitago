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
  dest: string
  amount: number
  estimatedFare: number
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
