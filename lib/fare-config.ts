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

/** 시간대별 할증 — startHour(포함)~endHour(미포함) 구간 요금에 rate%를 얹는다. 자정을 넘기는 구간(start>end)도 지원. rate 0이면 미적용. */
export type SurchargeWindow = {
  rate: number
  startHour: number
  endHour: number
}

export type FareConfig = {
  taxi: FareRule
  daeri: FareRule
  flatBase: Record<FlatServiceId, number>
  cancel: CancelFeePolicy
  night: SurchargeWindow
}

export const DEFAULT_FARE_CONFIG: FareConfig = {
  taxi: { base: 2.1, perKm: 0.28, perMin: 0, congestionPerMin: 0.02 },
  daeri: { base: 2.1, perKm: 0.28, perMin: 0, congestionPerMin: 0.02 },
  flatBase: { delivery: 1.2, bicycle: 0.3, kickboard: 0.3, ev: 0.4, parking: 2 },
  cancel: { rate: 40, min: 0.5 },
  // 공지된 정책과 동일 — 심야 0시~4시 기본 요금 1.2배.
  night: { rate: 20, startHour: 0, endHour: 4 },
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
    night: {
      rate: Math.min(100, Math.max(0, num(input?.night?.rate, DEFAULT_FARE_CONFIG.night.rate))),
      startHour: Math.min(23, Math.max(0, Math.floor(num(input?.night?.startHour, DEFAULT_FARE_CONFIG.night.startHour)))),
      endHour: Math.min(24, Math.max(0, Math.floor(num(input?.night?.endHour, DEFAULT_FARE_CONFIG.night.endHour)))),
    },
  }
}

/**
 * 기준 시각의 시간대 할증률(소수 — 0.2 = 20%). 구간 밖이면 0.
 * startHour <= endHour이면 같은 날 구간, startHour > endHour이면 자정을 넘기는 구간.
 */
export function timeSurchargeRate(config: FareConfig, at: Date = new Date()): number {
  const { rate, startHour, endHour } = config.night
  if (!(rate > 0) || startHour === endHour) return 0
  const hour = at.getHours()
  const inside = startHour < endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour
  return inside ? rate / 100 : 0
}

/** Client-side fetch of the live fare config (public endpoint). */
export async function fetchFareConfig(): Promise<FareConfig> {
  const res = await fetch('/api/fare-config', { cache: 'no-store' })
  const data = (await res.json().catch(() => null)) as { fare?: FareConfig } | null
  if (!res.ok || !data?.fare) return DEFAULT_FARE_CONFIG
  return normalizeFareConfig(data.fare)
}

/** 플랫폼 공식 Pi 입금 수신지 — 등록 전이면 빈 문자열. */
export async function fetchDepositWallet(): Promise<string> {
  try {
    const res = await fetch('/api/fare-config', { cache: 'no-store' })
    const data = (await res.json().catch(() => null)) as { depositWallet?: string } | null
    return typeof data?.depositWallet === 'string' ? data.depositWallet.trim() : ''
  } catch {
    return ''
  }
}
