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
  gross: number
  rate: number
  commission: number
  net: number
  status: 'pending' | 'settled'
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
