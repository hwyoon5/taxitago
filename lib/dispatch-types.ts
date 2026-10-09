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
  /** 기피 지역 판정 시 예상 요금에 포함된 할증액(Pi) — 0이면 미적용. */
  avoidSurchargePi?: number
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

/**
 * 기사 콜 응답 누적 평판 — 거절/타임아웃 +1점, 수락 −2점(0 미만 하한).
 * score가 REJECT_PENALTY_SCORE 이상이면 매칭 우선순위가 낮아진다.
 */
export type DriverReputation = {
  score: number
  rejected: number
  timedOut: number
  accepted: number
  updatedAt: string
}

export type DriverPenaltyLevel = 'ok' | 'warn' | 'penalty'

export type DriverPenaltyInfo = {
  driverId: string
  score: number
  rejected: number
  timedOut: number
  accepted: number
  level: DriverPenaltyLevel
}

/** 점수 2부터 경고 문구, 3부터 저우선 배차. */
export const REJECT_WARN_SCORE = 2
export const REJECT_PENALTY_SCORE = 3

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
  /** 기피 지역 판정으로 부과된 할증액(Pi) — estimatedFare에 이미 포함된 값. */
  avoidSurchargePi?: number
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
/** 운행 중인 기사가 현재 목적지에 이 거리(km) 이내로 들어오면 다음 콜을 사전 배차받을 수 있다. */
export const PREMATCH_RADIUS_KM = 1.5
