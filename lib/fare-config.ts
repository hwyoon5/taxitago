import { piRound } from '@/lib/pi-format'
import { normalizeRideTier, RIDE_TIERS, type RideTier } from '@/lib/ride-tiers'

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

/** 유료도로 통행료 정책 — Naver Directions summary.tollFare(원)를 Pi로 환산하는 비율. */
export type TollPolicy = {
  /** 1 Pi에 대응하는 원화 금액 — 통행료(원) ÷ krwPerPi = 통행료(Pi). */
  krwPerPi: number
}

/** 차량 등급(서비스 티어)별 요금 정책 — 택시 요율에 곱하는 할증 배율 + 선택적 전용 기본요금. */
export type TierRate = {
  /** 할증 배율 % — 100이면 일반 택시 요율과 동일, 120이면 1.2배. */
  rate: number
  /** 등급 전용 기본요금(Pi) — 미설정이면 taxi.base × rate/100으로 자동 환산된다. */
  base?: number
}

export type FareConfig = {
  taxi: FareRule
  daeri: FareRule
  flatBase: Record<FlatServiceId, number>
  cancel: CancelFeePolicy
  night: SurchargeWindow
  toll: TollPolicy
  /** 택시 호출 시 승객이 고른 등급별 할증 — 대리운전·플랫 서비스에는 미적용. */
  tiers: Record<RideTier, TierRate>
}

export const DEFAULT_FARE_CONFIG: FareConfig = {
  taxi: { base: 2.1, perKm: 0.28, perMin: 0, congestionPerMin: 0.02 },
  daeri: { base: 2.1, perKm: 0.28, perMin: 0, congestionPerMin: 0.02 },
  flatBase: { delivery: 1.2, bicycle: 0.3, kickboard: 0.3, ev: 0.4, parking: 2 },
  cancel: { rate: 40, min: 0.5 },
  // 공지된 정책과 동일 — 심야 0시~4시 기본 요금 1.2배.
  night: { rate: 20, startHour: 0, endHour: 4 },
  // 기본요금 2.1 Pi ≈ 택시 기본요금 4,800원 기준으로 1 Pi ≈ 2,300원 가정.
  // 실제 환율이 달라지면 관리자 설정에서 조정한다.
  toll: { krwPerPi: 2300 },
  // 승객이 고르는 차량 등급별 할증 — 일반은 기본 요율, 특별 등급은 할증.
  tiers: {
    '일반': { rate: 100 },
    '모범': { rate: 120 },
    '대형': { rate: 130 },
    '펫동반': { rate: 110 },
  },
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
  const tiers = {} as Record<RideTier, TierRate>
  for (const key of RIDE_TIERS) {
    const raw = input?.tiers?.[key]
    const fallback = DEFAULT_FARE_CONFIG.tiers[key]
    const base = num(raw?.base, NaN)
    tiers[key] = {
      rate: Math.min(500, Math.max(0, num(raw?.rate, fallback.rate))),
      ...(Number.isFinite(base) && base > 0 ? { base } : {}),
    }
  }
  return {
    taxi: rule(input?.taxi, DEFAULT_FARE_CONFIG.taxi),
    daeri: rule(input?.daeri, DEFAULT_FARE_CONFIG.daeri),
    flatBase: flat,
    tiers,
    cancel: {
      rate: Math.min(100, Math.max(0, num(input?.cancel?.rate, DEFAULT_FARE_CONFIG.cancel.rate))),
      min: Math.max(0, num(input?.cancel?.min, DEFAULT_FARE_CONFIG.cancel.min)),
    },
    night: {
      rate: Math.min(100, Math.max(0, num(input?.night?.rate, DEFAULT_FARE_CONFIG.night.rate))),
      startHour: Math.min(23, Math.max(0, Math.floor(num(input?.night?.startHour, DEFAULT_FARE_CONFIG.night.startHour)))),
      endHour: Math.min(24, Math.max(0, Math.floor(num(input?.night?.endHour, DEFAULT_FARE_CONFIG.night.endHour)))),
    },
    toll: {
      // 0이면 나눗셈이 깨지므로 하한 1원을 둔다.
      krwPerPi: Math.max(1, num(input?.toll?.krwPerPi, DEFAULT_FARE_CONFIG.toll.krwPerPi)),
    },
  }
}

/** 등급별 할증 배율(소수 — 1.2 = 1.2배). 미인식·미설정 등급은 1(일반 요율). */
export function tierFareRate(config: FareConfig, tier?: string | null): number {
  const key = normalizeRideTier(tier)
  const rate = key ? config.tiers?.[key]?.rate : undefined
  return Number.isFinite(rate) && Number(rate) > 0 ? Number(rate) / 100 : 1
}

/** 등급별 기본요금(Pi) — 전용 base가 있으면 그 값, 없으면 taxi.base × 배율. */
export function tierBaseFarePi(config: FareConfig, tier?: string | null): number {
  const key = normalizeRideTier(tier)
  const base = key ? config.tiers?.[key]?.base : undefined
  if (Number.isFinite(base) && Number(base) > 0) return piRound(Number(base))
  return piRound(config.taxi.base * tierFareRate(config, key ?? tier))
}

/** 원화 통행료(길찾기 API tollFare)를 Pi로 환산한다. */
export function tollFareToPi(tollKrw: number, config: FareConfig): number {
  if (!Number.isFinite(tollKrw) || tollKrw <= 0) return 0
  return piRound(tollKrw / Math.max(1, config.toll.krwPerPi))
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
