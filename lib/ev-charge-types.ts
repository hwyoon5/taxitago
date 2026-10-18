export type EvChargeStatus =
  | 'pending'   // 세션 생성됨 — 예치금 결제 대기
  | 'charging'  // 예치금 잠금(결제 검증) 완료 — 충전 중
  | 'settled'   // 실측 kWh 기준 정산 완료 (차액 환불 포함)
  | 'refunded'  // 충전 없이 종료 — 예치금 전액 환불
  | 'cancelled' // 잠금 전 취소 — 자금 이동 없음

/** 실측 충전량의 출처 — CPO 서버 보고 > 이용자/사업자 수동 입력 > 경과시간 추정 순으로 신뢰한다. */
export type EvMeterSource = 'cpo' | 'manual' | 'estimate'

export type EvChargeSession = {
  id: string
  /** 이용자 식별 — passengerId 로컬 규칙과 동일(Pi uid 우선). */
  userId: string
  /** Pi uid — 차액 환불 A2U 수신 대상. */
  userUid?: string
  userWallet?: string
  userPhone?: string
  chargerId: string
  chargerName: string
  /** 충전기 출력(kW) — CPO 실측이 없을 때 경과시간 추정의 근거. */
  powerKw?: number
  /** 제공자(CPO/파트너) — 파트너 충전기면 uid, 시드 충전기면 비어 플랫폼 정산. */
  providerId?: string
  providerName?: string
  /** 세션 생성 시점에 고정된 kWh 단가(Pi) — 이후 요금 설정이 바뀌어도 이 세션은 이 단가로 정산. */
  perKwhPi: number
  /** 선결제 예치금(Pi) — 플랫폼 에스크로 역할의 플랫폼 지갑에 잠긴다. */
  depositPi: number
  status: EvChargeStatus
  lockPaymentId: string | null
  lockTxid: string | null
  /** CPO 서버 보고 실측치 — 수동 입력보다 우선한다. */
  meteredKwh?: number
  meterSource?: EvMeterSource
  finalKwh?: number
  finalPi?: number
  /** 예치금 - 확정 요금 차액 환불. */
  refundPi?: number
  refundTxid?: string | null
  /** 제공자 정산 송금 근거. */
  payoutTxid?: string | null
  payoutWallet?: string | null
  /** 확정 요금이 예치금을 넘은 부족분 — 미수금 장부로 이관. */
  deficitPi?: number
  heldAt: string | null
  startedAt: string | null
  endedAt: string | null
  settledAt: string | null
  createdAt: string
  updatedAt: string
}

/** 클라이언트에 노출되는 세션 투영 — 지갑·uid는 이용자 본인 조회이므로 그대로 둔다. */
export type PublicEvSession = Omit<EvChargeSession, never>
