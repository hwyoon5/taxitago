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
  /** 승객이 호출 시 고른 차량 등급('일반'·'모범'·'대형'·'펫동반') —
   *  없음이면 '일반'. 해당 등급을 제공하는 기사만 매칭 후보가 된다. */
  tier?: string
  passengerId: string
  /** 호출한 이용자의 Pi uid — 등록 기사/파트너가 승객으로 호출했을 때
   *  자기 기사 단말기로 콜이 가지 않도록 매칭 후보에서 제외하는 키. */
  passengerUid?: string
  /** 승객이 인증한 연락처 — 기사 '전화하기'(tel:) 직통 연결에 사용. */
  passengerPhone?: string
  pickup: GeoPoint
  waypoints?: GeoPoint[]
  dest: GeoPoint
  estimatedFare: number
  /** 기피 지역 판정 시 예상 요금에 포함된 할증액(Pi) — 0이면 미적용. */
  avoidSurchargePi?: number
  /** 경로의 유료도로 예상 통행료(Pi) — estimatedFare에 이미 포함된 값. 0이면 무료 구간. */
  tollPi?: number
  /** 길찾기 API가 돌려준 원화 통행료(표시·감사용). null/없음이면 미산출. */
  tollKrw?: number | null
  /** 길찾기 API 기준 예상 소요 시간(분) — 정체 추가 요금의 지연 판별 기준. */
  expectedMinutes?: number | null
  status: RideStatus
  assignedDriverId: string | null
  currentOffer: RideOfferRecord | null
  declinedDriverIds: string[]
  timedOutDriverIds: string[]
  /** 승객이 고른 기사 응답 대기 시간(분) — 0/없음이면 후보 소진 즉시 unmatched. */
  waitMinutes?: number | null
  /** 대기 마감 시각(ISO) — 이 시각까지 searching을 유지해 기사 목록에 노출된다. */
  waitUntil?: string | null
  boardedAt?: string | null
  readyToSettleAt?: string | null
  /** 탑승 이후 실제 주행 거리(km) — 기사 presence/앱 오도미터 누적값, 정산 시 실측 요금 기준. */
  actualKm?: number | null
  /** 탑승 인증 경로 — 'auto'는 승객·기사 GPS 동행 감지로 서버가 스탬프,
   *  'driver'는 기사 수동 확인, 'passenger'는 승객 수동 확인(레거시). */
  boardedVia?: 'auto' | 'driver' | 'passenger' | null
  /** 승객이 '탑승 여부 확인' 팝업에서 직접 '예'를 눌러 확정한 시각(ISO). */
  boardConfirmedAt?: string | null
  /** 승객이 탑승을 부인해 취소·분쟁 처리된 누적 횟수 — 기사 임의 탑승 처리 감시 지표. */
  boardDisputes?: number
  /** 마지막 탑승 부인 시각(ISO). */
  lastBoardDisputeAt?: string | null
  /** 자동 탑승 감지가 조건(승객·기사 근접+차량 이동)을 처음 만족한 시각 —
   *  AUTO_BOARD_DEBOUNCE_MS 이상 조건이 유지되면 boardedAt을 스탬프한다. */
  autoBoardSince?: string | null
  /** 안심귀가 공유 링크 토큰 — `/track/<token>` 공개 페이지가 이 값으로 라이드를 읽는다.
   *  승객 요청으로만 생성되며 PublicRide에는 노출하지 않는다. */
  shareToken?: string | null
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
  /** 등록된 연락처 — 승객 '전화하기'(tel:) 직통 연결에 사용. */
  phone?: string
  /** 등록 서비스 자격('택시'·'대리운전'·'택배'·시설형) — 콜 kind와 비교해
   *  자격 없는 기사에게는 오퍼를 보내지 않는다. 미설정(레거시)은 택시로 간주. */
  serviceType?: string
  /** 겸직(Multi-role) 수행 서비스 — 택시 기사의 택배 병행 등. 택배 푸시·수락 자격의 근거. */
  serviceRoles?: string[]
  /** 택배 수행 시 허용 차량 체급(오토바이·다마스·1톤 트럭). */
  deliveryVehicles?: string[]
  /** 기사가 추가로 제공 가능한 차량 등급('모범'·'대형'·'펫동반') —
   *  '일반'은 모든 택시 기사가 기본 제공. 미설정(레거시)은 일반 콜만 매칭. */
  vehicleTiers?: string[]
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
  phone?: string
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
  /** 호출 시 선택한 차량 등급 — 없음이면 '일반'. */
  tier?: string
  passengerId: string
  passengerPhone?: string
  pickup: GeoPoint
  waypoints?: GeoPoint[]
  dest: GeoPoint
  estimatedFare: number
  /** 기피 지역 판정으로 부과된 할증액(Pi) — estimatedFare에 이미 포함된 값. */
  avoidSurchargePi?: number
  /** 유료도로 예상 통행료(Pi) — estimatedFare에 이미 포함된 값. */
  tollPi?: number
  /** 길찾기 API 원화 통행료(표시용) — 미산출이면 null. */
  tollKrw?: number | null
  expectedMinutes?: number | null
  status: RideStatus
  offerExpiresAt: string | null
  pendingOffer: { driverId: string; driverName: string } | null
  assignedDriver: PublicDriver | null
  escrow: PublicEscrow | null
  /** 승객이 고른 기사 응답 대기 시간(분)과 마감 시각 — 매칭 화면 카운트다운용. */
  waitMinutes?: number | null
  waitUntil?: string | null
  boardedAt: string | null
  readyToSettleAt: string | null
  /** 탑승 이후 실제 주행 거리(km) — 정산 시 실측 요금 산출에 사용. */
  actualKm?: number | null
  /** 탑승 인증 경로 — 'auto'는 승객·기사 GPS 동행 감지, 'driver'는 기사 수동 확인. */
  boardedVia?: 'auto' | 'driver' | 'passenger' | null
  /** 승객이 탑승 확인 팝업에서 '예'를 눌러 확정한 시각(ISO). */
  boardConfirmedAt?: string | null
  /** 승객 탑승 부인(분쟁 취소) 누적 횟수 — 기사 임의 탑승 처리 감시 지표. */
  boardDisputes?: number
  createdAt: string
  updatedAt: string
}

export const OFFER_TIMEOUT_MS = 45_000
export const MATCH_RADIUS_KM = 25
export const DRIVER_STALE_MS = 45_000
/** 운행 중인 기사가 현재 목적지에 이 거리(km) 이내로 들어오면 다음 콜을 사전 배차받을 수 있다. */
export const PREMATCH_RADIUS_KM = 1.5

/** 자동 탑승 감지 — 기사 GPS 비트에서 승객·차량이 이 거리(km) 안에 있어야 한다. */
export const AUTO_BOARD_PROXIMITY_KM = 0.15
/** 자동 탑승 감지 — 차량이 이 속도(km/h) 이상으로 움직이기 시작해야 한다(도착 대기·주차 오탐 방지). */
export const AUTO_BOARD_MIN_SPEED_KMH = 8
/** 자동 탑승 감지 — 근접+주행 조건이 이 시간(ms) 이상 지속되면 탑승을 확정한다(단발 GPS 튐 방지). */
export const AUTO_BOARD_DEBOUNCE_MS = 20_000
/** 자동 탑승 감지 — 승객 위치 신선도 상한(ms). 이 시간 이상 오래된 승객 좌표는 증거로 쓰지 않는다. */
export const AUTO_BOARD_PAX_MAX_AGE_MS = 75_000
/** 자동 탑승 감지 — 속도 계산에 쓸 수 있는 최소/최대 샘플 간격(ms). 너무 짧으면 GPS 잡음, 너무 길면 평균 왜곡. */
export const AUTO_BOARD_MIN_DT_MS = 3_000
export const AUTO_BOARD_MAX_DT_MS = 120_000
