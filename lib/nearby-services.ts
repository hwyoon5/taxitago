import { haversineKm } from '@/lib/dispatch-geo'
import { isUsableCoord } from '@/lib/ride-session'
import { BUSAN_CITY_HALL } from '@/lib/user-location'

export type NearbyServiceKind = 'parking' | 'ev' | 'bike' | 'scooter'

export type NearbyListing = 'partner' | 'demo'

export type NearbyServiceSpot = {
  id: string
  name: string
  extra: string
  rate: string
  lat: number
  lng: number
  distanceKm: number
  distanceLabel: string
  /** 실등록 파트너는 데모 목록보다 위에 둔다. */
  listing: NearbyListing
}

export type RegisteredNearbyPartner = {
  id: string
  name: string
  lat: number
  lng: number
  extra?: string
  rate?: string
}

type SpotSeed = {
  id: string
  name: string
  extra: string
  rate: string
  eastM: number
  northM: number
}

const PARKING_SEEDS: SpotSeed[] = [
  { id: 'parking-1', name: '가까운 공영주차장', extra: '잔여 24자리', rate: '2 Pi / 시간', eastM: 70, northM: 45 },
  { id: 'parking-2', name: '노상 공영주차장', extra: '잔여 8자리', rate: '1.5 Pi / 시간', eastM: -95, northM: 110 },
  { id: 'parking-3', name: '주차타워', extra: '잔여 3자리', rate: '2.4 Pi / 시간', eastM: 160, northM: -55 },
  { id: 'parking-4', name: '민간주차장', extra: '잔여 12자리', rate: '3 Pi / 시간', eastM: -40, northM: 210 },
  { id: 'parking-5', name: '환승 주차장', extra: '잔여 18자리', rate: '1.8 Pi / 시간', eastM: 230, northM: 90 },
  { id: 'parking-6', name: '지하 주차장', extra: '잔여 31자리', rate: '2.2 Pi / 시간', eastM: -180, northM: -120 },
]

const EV_SEEDS: SpotSeed[] = [
  { id: 'ev-1', name: '가까운 EV 스테이션', extra: '잔여 전력 78%', rate: '0.4 Pi / kWh', eastM: 55, northM: 80 },
  { id: 'ev-2', name: '급속 충전소', extra: '잔여 전력 62%', rate: '0.45 Pi / kWh', eastM: -130, northM: 40 },
  { id: 'ev-3', name: '충전 허브', extra: '잔여 전력 91%', rate: '0.38 Pi / kWh', eastM: 190, northM: -70 },
  { id: 'ev-4', name: '공영 EV 충전소', extra: '잔여 전력 44%', rate: '0.5 Pi / kWh', eastM: 20, northM: 240 },
  { id: 'ev-5', name: '마트 충전존', extra: '잔여 전력 83%', rate: '0.42 Pi / kWh', eastM: -210, northM: -90 },
  { id: 'ev-6', name: '초급속 충전소', extra: '잔여 전력 57%', rate: '0.48 Pi / kWh', eastM: 140, northM: 160 },
]

const BIKE_SEEDS: SpotSeed[] = [
  { id: 'bike-1', name: 'BIKE-2048', extra: '배터리 85%', rate: '0.2 Pi', eastM: 40, northM: 65 },
  { id: 'bike-2', name: 'BIKE-1176', extra: '배터리 72%', rate: '0.2 Pi', eastM: -85, northM: 30 },
  { id: 'bike-3', name: 'BIKE-3901', extra: '배터리 94%', rate: '0.2 Pi', eastM: 120, northM: -50 },
  { id: 'bike-4', name: 'BIKE-5520', extra: '배터리 61%', rate: '0.2 Pi', eastM: -30, northM: 170 },
  { id: 'bike-5', name: 'BIKE-8831', extra: '배터리 88%', rate: '0.2 Pi', eastM: 200, northM: 95 },
  { id: 'bike-6', name: 'BIKE-4410', extra: '배터리 77%', rate: '0.2 Pi', eastM: -160, northM: -80 },
  { id: 'bike-7', name: 'BIKE-6722', extra: '배터리 90%', rate: '0.2 Pi', eastM: 75, northM: -190 },
]

const SCOOTER_SEEDS: SpotSeed[] = [
  { id: 'scoot-1', name: 'SCOOT-7312', extra: '배터리 85%', rate: '0.3 Pi', eastM: 35, northM: 50 },
  { id: 'scoot-2', name: 'SCOOT-2104', extra: '배터리 68%', rate: '0.3 Pi', eastM: -70, northM: 95 },
  { id: 'scoot-3', name: 'SCOOT-8870', extra: '배터리 91%', rate: '0.3 Pi', eastM: 150, northM: -40 },
  { id: 'scoot-4', name: 'SCOOT-6402', extra: '배터리 77%', rate: '0.3 Pi', eastM: -110, northM: 160 },
  { id: 'scoot-5', name: 'SCOOT-1198', extra: '배터리 64%', rate: '0.3 Pi', eastM: 210, northM: 70 },
  { id: 'scoot-6', name: 'SCOOT-3055', extra: '배터리 82%', rate: '0.3 Pi', eastM: -175, northM: -100 },
  { id: 'scoot-7', name: 'SCOOT-9240', extra: '배터리 73%', rate: '0.3 Pi', eastM: 90, northM: -210 },
]

const SEEDS: Record<NearbyServiceKind, SpotSeed[]> = {
  parking: PARKING_SEEDS,
  ev: EV_SEEDS,
  bike: BIKE_SEEDS,
  scooter: SCOOTER_SEEDS,
}

function offsetFromMeters(origin: { lat: number; lng: number }, eastM: number, northM: number) {
  const dLat = northM / 111_320
  const denom = 111_320 * Math.cos((origin.lat * Math.PI) / 180)
  const dLng = denom === 0 ? 0 : eastM / denom
  return { lat: origin.lat + dLat, lng: origin.lng + dLng }
}

export function formatNearbyDistance(distanceKm: number) {
  const meters = Math.max(1, Math.round(distanceKm * 1000))
  if (meters < 1000) return `${meters}m`
  return `${(meters / 1000).toFixed(1)}km`
}

export function nearbyKindFromService(service: string): NearbyServiceKind | null {
  if (service === '주차') return 'parking'
  if (service === 'EV 충전') return 'ev'
  if (service === '자전거') return 'bike'
  if (service === '킥보드') return 'scooter'
  return null
}

function byDistance(a: NearbyServiceSpot, b: NearbyServiceSpot) {
  return a.distanceKm - b.distanceKm || a.id.localeCompare(b.id)
}

function toSpot(
  origin: { lat: number; lng: number },
  spot: { id: string; name: string; extra: string; rate: string; lat: number; lng: number },
  listing: NearbyListing,
): NearbyServiceSpot {
  const distanceKm = haversineKm(origin, spot)
  return {
    ...spot,
    distanceKm,
    distanceLabel: formatNearbyDistance(distanceKm),
    listing,
  }
}

/** 가맹점 파트너 프로필이 이 서비스에 해당하면 목록 최상단 후보로 만든다. */
export function partnerListingFromProfile(
  profile: { uid: string; role: string; name: string; detail: string; region?: string; serviceType?: string } | null,
  service: string,
  lat: number,
  lng: number,
): RegisteredNearbyPartner | null {
  if (!profile || profile.role !== '파트너' || profile.serviceType !== service) return null
  if (!isUsableCoord(lat, lng)) return null
  const name = profile.detail.trim() || profile.name.trim()
  if (!name) return null
  return {
    id: `partner-${profile.uid}`,
    name,
    extra: profile.region?.trim() ? `${profile.region.trim()} · 등록 파트너` : '등록 파트너',
    lat,
    lng,
  }
}

export function listNearbyServiceSpots(
  kind: NearbyServiceKind,
  lat: number,
  lng: number,
  limit = 6,
  partners: RegisteredNearbyPartner[] = [],
): NearbyServiceSpot[] {
  const origin = isUsableCoord(lat, lng) ? { lat, lng } : BUSAN_CITY_HALL
  const count = Math.min(7, Math.max(5, limit))
  const fallback = SEEDS[kind][0]
  const live = partners
    .filter((partner) => partner.name.trim() && isUsableCoord(partner.lat, partner.lng))
    .map((partner) =>
      toSpot(
        origin,
        {
          id: partner.id,
          name: partner.name.trim(),
          extra: partner.extra?.trim() || '등록 파트너',
          rate: partner.rate?.trim() || fallback.rate,
          lat: partner.lat,
          lng: partner.lng,
        },
        'partner',
      ),
    )
    .sort(byDistance)
  const demos = SEEDS[kind]
    .map((seed) => {
      const point = offsetFromMeters(origin, seed.eastM, seed.northM)
      return toSpot(
        origin,
        {
          id: seed.id,
          name: seed.name,
          extra: seed.extra,
          rate: seed.rate,
          lat: point.lat,
          lng: point.lng,
        },
        'demo',
      )
    })
    .sort(byDistance)
    .slice(0, count)
  return [...live, ...demos]
}
