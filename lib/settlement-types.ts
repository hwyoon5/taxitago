export type SettlementService = 'taxi' | 'daeri' | 'delivery' | 'bicycle' | 'kickboard' | 'ev' | 'parking'
export type CommissionRates = Record<SettlementService, number>

export type SettlementEntry = {
  id: string
  refId: string
  service: SettlementService
  driverId: string
  driverName: string
  passengerId?: string
  memo: string
  /** Pi address the platform commission is distributed to. */
  adminWallet?: string
  /** Pi address the driver share (net) is distributed to. */
  driverWallet?: string
  gross: number
  rate: number
  commission: number
  net: number
  status: 'pending' | 'settled'
  /**
   * inapp — 승객이 플랫폼 지갑으로 Pi 결제 → 플랫폼이 기사에게 net을 송금해야 함.
   * manual — 기사가 현장에서 직접 수령 → 수수료는 플랫폼의 기사에 대한 미수금.
   */
  channel?: 'inapp' | 'manual'
  /** 기사에게 실제 송금된 A2U 트랜잭션 txid — 수수료 공제 후 net 송금의 증거. */
  payoutTxid?: string
  settledAt: string
  createdAt: string
}

export const DEFAULT_RATES: CommissionRates = {
  taxi: 10,
  daeri: 10,
  delivery: 10,
  bicycle: 10,
  kickboard: 10,
  ev: 10,
  parking: 10,
}
