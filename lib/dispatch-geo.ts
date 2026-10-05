import { DEFAULT_FARE_CONFIG, type FareConfig } from '@/lib/fare-config'
import { piRound } from '@/lib/pi-format'
import { inferRegion, regionDisplayName } from '@/lib/region-destinations'

const EARTH_KM = 6371

function toRad(value: number) {
  return (value * Math.PI) / 180
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function estimateTaxiFarePi(distanceKm: number, config: FareConfig = DEFAULT_FARE_CONFIG, kind: 'taxi' | 'daeri' = 'taxi') {
  const rule = kind === 'daeri' ? config.daeri : config.taxi
  const quoted = rule.base + Math.max(0, distanceKm) * rule.perKm + (Math.max(0, distanceKm) / 0.35) * rule.perMin
  return piRound(Math.max(rule.base, quoted))
}

// 경유지가 직행 경로 위에 놓여 있어도 지오코딩·도로 스냅 오차로 수십~수백 m의
// 거리 차이가 생긴다. 이 값 이하의 우회는 "경로 위"로 보고 추가 요금을 붙이지 않는다.
export const WAYPOINT_ON_ROUTE_EPSILON_KM = 0.3

export type GeoCoord = { lat: number; lng: number }

// 통상 권역 기준 — 출발지→목적지 직선거리가 이 값 이상이거나 시/도 단위
// 권역(광역시·도)이 다르면 장거리 콜로 판별해 이용자 확인을 요청한다.
export const LONG_DISTANCE_CALL_KM = 25

export function longDistanceCheck(
  origin: GeoCoord & { address?: string },
  dest: GeoCoord & { address?: string },
): { far: boolean; km: number; regionExit: boolean; destRegion: string } {
  const km = haversineKm(origin, dest)
  const originRegion = inferRegion(origin.address ?? '', origin.lat, origin.lng)
  const destRegion = inferRegion(dest.address ?? '', dest.lat, dest.lng)
  const regionExit = !!originRegion && !!destRegion && originRegion !== destRegion
  return {
    far: km >= LONG_DISTANCE_CALL_KM || regionExit,
    km,
    regionExit,
    destRegion: destRegion ? regionDisplayName(destRegion) : '',
  }
}

export function routeChainKm(points: GeoCoord[]) {
  return points.slice(1).reduce((sum, point, index) => sum + haversineKm(points[index], point), 0)
}

export type WaypointDetour = {
  waypoint: GeoCoord
  detourKm: number
  onDirectRoute: boolean
}

export type WaypointRouteQuote = {
  directKm: number
  routeKm: number
  detourKm: number
  chargeableDetourKm: number
  chargeableKm: number
  detours: WaypointDetour[]
}

// 각 경유지의 우회량을 이웃 지점 간 직선(이전 지점→다음 지점) 대비로 판별한다.
// 순서가 있는 경유지 체인이라 앞 경유지가 반영된 기준 구간으로 뒤 경유지를 잰다.
export function waypointRouteQuote(
  origin: GeoCoord,
  dest: GeoCoord,
  waypoints: GeoCoord[],
  epsilonKm = WAYPOINT_ON_ROUTE_EPSILON_KM,
): WaypointRouteQuote {
  const chain = [origin, ...waypoints, dest]
  const directKm = haversineKm(origin, dest)
  const routeKm = routeChainKm(chain)
  const detourKm = Math.max(0, routeKm - directKm)
  const detours: WaypointDetour[] = waypoints.map((waypoint, index) => {
    const prev = chain[index]
    const next = chain[index + 2]
    const delta = Math.max(0, haversineKm(prev, waypoint) + haversineKm(waypoint, next) - haversineKm(prev, next))
    return { waypoint, detourKm: delta, onDirectRoute: delta <= epsilonKm }
  })
  const chargeableDetourKm = Math.min(
    detourKm,
    detours.reduce((sum, detour) => sum + (detour.onDirectRoute ? 0 : detour.detourKm), 0),
  )
  return {
    directKm,
    routeKm,
    detourKm,
    chargeableDetourKm,
    chargeableKm: directKm + chargeableDetourKm,
    detours,
  }
}

// 우회 거리에 비례하는 추가 요금(기본요금 제외, 거리 + 시간 요금만).
// estimateTaxiFarePi와 동일한 요율을 쓰되 base는 빼서 "우회분만" 과금한다.
export function waypointSurchargePi(detourKm: number, config: FareConfig = DEFAULT_FARE_CONFIG, kind: 'taxi' | 'daeri' = 'taxi') {
  const rule = kind === 'daeri' ? config.daeri : config.taxi
  const extra = Math.max(0, detourKm) * rule.perKm + (Math.max(0, detourKm) / 0.35) * rule.perMin
  return piRound(Math.max(0, extra))
}

// 정체 추가 요금: 길찾기 API의 기본 예상 소요 시간 대비 실제 운행이 이 값(분) 이상
// 늦어졌을 때만, 초과분에 대해 분당 시간 요금율(perMin)을 적용한다.
export const TRAFFIC_DELAY_FREE_MINUTES = 10

export function trafficDelayMinutes(actualMinutes: number, expectedMinutes: number) {
  return Math.max(0, Math.max(0, actualMinutes) - Math.max(0, expectedMinutes))
}

export function trafficDelaySurchargePi(delayMinutes: number, config: FareConfig = DEFAULT_FARE_CONFIG, kind: 'taxi' | 'daeri' = 'taxi') {
  const rule = kind === 'daeri' ? config.daeri : config.taxi
  const billable = Math.max(0, delayMinutes - TRAFFIC_DELAY_FREE_MINUTES)
  return piRound(billable * rule.congestionPerMin)
}

export function etaMinutesFromKm(distanceKm: number) {
  return Math.max(2, Math.round(distanceKm / 0.35))
}

export function headingDegrees(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
) {
  const y = to.lng - from.lng
  const x = to.lat - from.lat
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export function stepToward(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  stepKm: number,
) {
  const remaining = haversineKm(from, to)
  if (remaining <= stepKm || remaining <= 0.02) return { lat: to.lat, lng: to.lng, arrived: true }
  const ratio = stepKm / remaining
  return {
    lat: from.lat + (to.lat - from.lat) * ratio,
    lng: from.lng + (to.lng - from.lng) * ratio,
    arrived: false,
  }
}
