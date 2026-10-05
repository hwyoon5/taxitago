export type RideStatus =
  | 'searching'
  | 'offered'
  | 'assigned'
  | 'unmatched'
  | 'cancelled'
  | 'completed'

export type RideKind = 'taxi' | 'daeri'

export type DriverDutyStatus = 'online' | 'offline' | 'busy'

export type OfferDecision = 'pending' | 'accepted' | 'rejected' | 'timeout'

export type GeoPoint = {
  lat: number
  lng: number
  address?: string
  label?: string
}

/** Ride request row: pickup/dest + quoted fare. */
export type RideRequestRecord = {
  id: string
  kind: RideKind
  passengerId: string
  pickup: GeoPoint
  waypoints?: GeoPoint[]
  dest: GeoPoint
  estimatedFare: number
  /** 길찾기 API 기준 예상 소요 시간(분) — 정체 추가 요금의 지연 판별 기준. */
  expectedMinutes?: number | null
  status: RideStatus
  assignedDriverId: string | null
  currentOffer: RideOfferRecord | null
  declinedDriverIds: string[]
  timedOutDriverIds: string[]
  boardedAt?: string | null
  readyToSettleAt?: string | null
  /** 탑승 이후 실제 주행 거리(km) — 기사 presence/앱 오도미터 누적값, 정산 시 실측 요금 기준. */
  actualKm?: number | null
  createdAt: string
  updatedAt: string
}

export type RideOfferRecord = {
  rideId: string
  driverId: string
  rank: number
  pickupDistanceKm: number
  offeredAt: string
  expiresAt: string
  decision: OfferDecision
}

export type DriverRecord = {
  id: string
  name: string
  vehicle: string
  plate: string
  rating: string
  lat: number
  lng: number
  heading: number
  status: DriverDutyStatus
  lastSeenAt: string
  virtual: boolean
  wallet?: string
  piUid?: string
}

export type PublicDriver = {
  id: string
  name: string
  vehicle: string
  plate: string
  rating: string
  etaMinutes: number
  pickupDistanceKm: number
  lat: number
  lng: number
  heading: number
  updatedAt: string
}

export type EscrowStatus = 'pending' | 'held' | 'released' | 'refunded'

export type PublicEscrow = {
  status: EscrowStatus
  amount: number
  lockTxid: string | null
  payoutTxid: string | null
  payoutWallet: string | null
}

export type PublicRide = {
  id: string
  kind: RideKind
  passengerId: string
  pickup: GeoPoint
  waypoints?: GeoPoint[]
  dest: GeoPoint
  estimatedFare: number
  expectedMinutes?: number | null
  status: RideStatus
  offerExpiresAt: string | null
  pendingOffer: { driverId: string; driverName: string } | null
  assignedDriver: PublicDriver | null
  escrow: PublicEscrow | null
  boardedAt: string | null
  readyToSettleAt: string | null
  /** 탑승 이후 실제 주행 거리(km) — 정산 시 실측 요금 산출에 사용. */
  actualKm?: number | null
  createdAt: string
  updatedAt: string
}

export const OFFER_TIMEOUT_MS = 45_000
export const MATCH_RADIUS_KM = 25
export const DRIVER_STALE_MS = 45_000
