import { piRound } from '@/lib/pi-format'

export type FareRule = {
  base: number
  perKm: number
  perMin: number
  /** 정체 지연 초과분(10분 기준 초과)에 적용하는 분당 추가 요금율(Pi/분). */
  congestionPerMin: number
}

export type FlatServiceId = 'delivery' | 'bicycle' | 'kickboard' | 'ev' | 'parking'

export type CancelFeePolicy = {
  rate: number
  min: number
}

export type FareConfig = {
  taxi: FareRule
  daeri: FareRule
  flatBase: Record<FlatServiceId, number>
  cancel: CancelFeePolicy
}

export const DEFAULT_FARE_CONFIG: FareConfig = {
  taxi: { base: 2.1, perKm: 0.28, perMin: 0, congestionPerMin: 0.02 },
  daeri: { base: 2.1, perKm: 0.28, perMin: 0, congestionPerMin: 0.02 },
  flatBase: { delivery: 1.2, bicycle: 0.3, kickboard: 0.3, ev: 0.4, parking: 2 },
  cancel: { rate: 40, min: 0.5 },
}

export const FLAT_SERVICE_LABEL: Record<FlatServiceId, string> = {
  delivery: '택배',
  bicycle: '자전거',
  kickboard: '킥보드',
  ev: 'EV충전',
  parking: '주차',
}

export function normalizeFareConfig(input: Partial<FareConfig> | null | undefined): FareConfig {
  const num = (value: unknown, fallback: number) => (Number.isFinite(Number(value)) ? piRound(Number(value)) : fallback)
  const rule = (value: Partial<FareRule> | undefined, fallback: FareRule): FareRule => ({
    base: Math.max(0, num(value?.base, fallback.base)),
    perKm: Math.max(0, num(value?.perKm, fallback.perKm)),
    perMin: Math.max(0, num(value?.perMin, fallback.perMin)),
    congestionPerMin: Math.max(0, num(value?.congestionPerMin, fallback.congestionPerMin)),
  })
  const flat = {} as Record<FlatServiceId, number>
  for (const key of Object.keys(DEFAULT_FARE_CONFIG.flatBase) as FlatServiceId[]) {
    flat[key] = Math.max(0, num(input?.flatBase?.[key], DEFAULT_FARE_CONFIG.flatBase[key]))
  }
  return {
    taxi: rule(input?.taxi, DEFAULT_FARE_CONFIG.taxi),
    daeri: rule(input?.daeri, DEFAULT_FARE_CONFIG.daeri),
    flatBase: flat,
    cancel: {
      rate: Math.min(100, Math.max(0, num(input?.cancel?.rate, DEFAULT_FARE_CONFIG.cancel.rate))),
      min: Math.max(0, num(input?.cancel?.min, DEFAULT_FARE_CONFIG.cancel.min)),
    },
  }
}

/** Client-side fetch of the live fare config (public endpoint). */
export async function fetchFareConfig(): Promise<FareConfig> {
  const res = await fetch('/api/fare-config', { cache: 'no-store' })
  const data = (await res.json().catch(() => null)) as { fare?: FareConfig } | null
  if (!res.ok || !data?.fare) return DEFAULT_FARE_CONFIG
  return normalizeFareConfig(data.fare)
}
