/**
 * 차량 등급/서비스 티어 — 승객 호출 시 고르는 티어와 기사가 등록하는
 * 제공 가능 티어를 맞춰 매칭 풀을 걸러낸다.
 *
 * '일반'은 모든 택시 기사가 기본 제공으로 간주되므로 기사 레코드에는
 * 추가 티어(모범·대형·펫동반)만 저장한다.
 */
export const BASE_RIDE_TIER = '일반'

export const RIDE_TIERS = [BASE_RIDE_TIER, '모범', '대형', '펫동반'] as const

export type RideTier = (typeof RIDE_TIERS)[number]

/** 기사 등록/프로필에서 고를 수 있는 추가 등급(일반 제외). */
export const EXTRA_VEHICLE_TIERS: readonly RideTier[] = RIDE_TIERS.filter((tier) => tier !== BASE_RIDE_TIER)

export function normalizeRideTier(value: unknown): RideTier | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return (RIDE_TIERS as readonly string[]).includes(text) ? (text as RideTier) : undefined
}

/** 기사 레코드용 — 추가 티어만 남기고 중복·비정상 값은 버린다. */
export function normalizeVehicleTiers(value: unknown): RideTier[] {
  const list = Array.isArray(value) ? value : []
  const out: RideTier[] = []
  for (const item of list) {
    const tier = normalizeRideTier(item)
    if (tier && tier !== BASE_RIDE_TIER && !out.includes(tier)) out.push(tier)
  }
  return out
}

/**
 * 매칭 자격 — 콜이 요구한 티어를 기사가 소화할 수 있는지.
 * 티어 미지정 콜(레거시)과 '일반' 콜은 모두에게 열리고,
 * 그 외 티어는 기사 등록 정보에 해당 티어가 있어야 매칭된다.
 */
export function driverServesTier(tiers: readonly string[] | null | undefined, tier?: string | null): boolean {
  const want = normalizeRideTier(tier) ?? BASE_RIDE_TIER
  if (want === BASE_RIDE_TIER) return true
  return normalizeVehicleTiers(tiers).includes(want)
}
