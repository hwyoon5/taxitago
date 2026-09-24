import { lookupAddressFromApi, searchPlacesFromApi } from '@/lib/geocode-client'
import { centerForRegion, lookupSuggestedPlace, regionFromAccessText, resolveRegion } from '@/lib/region-destinations'

export const BUSAN_CITY_HALL = { lat: 35.179554, lng: 129.075641 }

export const REGION_FALLBACK_LABEL: Record<string, string> = {
  seoul: '서울특별시',
  busan: '부산광역시',
  incheon: '인천광역시',
  daegu: '대구광역시',
  daejeon: '대전광역시',
  gwangju: '광주광역시',
  ulsan: '울산광역시',
  sejong: '세종특별자치시',
  gyeonggi: '경기도',
  gangwon: '강원특별자치도',
  chungbuk: '충청북도',
  chungnam: '충청남도',
  jeonbuk: '전북특별자치도',
  jeonnam: '전라남도',
  gyeongbuk: '경상북도',
  gyeongnam: '경상남도',
  jeju: '제주특별자치도',
}

export type GeoPoint = { lat: number; lng: number }
export type RidePlace = { label: string; address: string; lat: number; lng: number }

const NICKNAME_DESTS = new Set(['집', '회사'])

function coordFallbackAddress(lat: number, lng: number) {
  const region = resolveRegion('', lat, lng)
  const label = REGION_FALLBACK_LABEL[region] || '선택한 위치'
  return `${label} (${lat.toFixed(5)}, ${lng.toFixed(5)})`
}

export function failedReverseAddress(lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '주소를 찾을 수 없습니다'
  return `주소를 찾을 수 없습니다 (${lat.toFixed(5)}, ${lng.toFixed(5)})`
}

export function requestBrowserPosition(): Promise<GeoPoint | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)

  const read = (options: PositionOptions) =>
    new Promise<GeoPoint | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => resolve(null),
        options,
      )
    })

  return new Promise((resolve) => {
    let settled = false
    const finish = (point: GeoPoint | null) => {
      if (settled) return
      settled = true
      resolve(point)
    }
    const coarse = read({ enableHighAccuracy: false, timeout: 4000, maximumAge: 300_000 })
    const accurate = read({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60_000 })
    void coarse.then((point) => {
      if (point) finish(point)
    })
    void accurate.then((point) => {
      if (point) finish(point)
    })
    void Promise.all([coarse, accurate]).then(([cached, precise]) => finish(precise || cached))
  })
}

export async function lookupAccessRegion(): Promise<{ lat: number; lng: number; city?: string; region?: string; country?: string } | null> {
  try {
    const response = await fetch('https://ipwho.is/', { headers: { Accept: 'application/json' } })
    if (!response.ok) return null
    const data = (await response.json()) as {
      success?: boolean
      latitude?: number
      longitude?: number
      city?: string
      region?: string
      country?: string
      country_code?: string
    }
    if (!data.success) return null
    return {
      lat: Number(data.latitude),
      lng: Number(data.longitude),
      city: data.city,
      region: data.region,
      country: data.country || data.country_code,
    }
  } catch {
    return null
  }
}

export async function resolveFlexibleFallback() {
  const access = await lookupAccessRegion()
  const regionId = regionFromAccessText(access?.city, access?.region, access?.country)
  const center = centerForRegion(regionId)
  const label = REGION_FALLBACK_LABEL[regionId] || '부산광역시'
  return {
    lat: center.lat,
    lng: center.lng,
    address: `${label} 접속 지역`,
  }
}

function looksLikeCoordLabel(value: string) {
  return /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(value.trim())
}

function koreanAreaFallback(lat: number, lng: number) {
  const region = resolveRegion('', lat, lng)
  return REGION_FALLBACK_LABEL[region] || '부산광역시'
}

function usableReverseLabel(value: string) {
  const label = value.trim()
  if (!label || looksLikeCoordLabel(label)) return ''
  if (/확인하는 중|수신하는 중|불러오는 중|갱신하는 중|주소를 찾을 수 없습니다/.test(label)) return ''
  return label
}

export async function reverseGeocode(lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return '부산광역시'
  }
  const fallback = koreanAreaFallback(lat, lng)
  try {
    const address = await Promise.race([
      lookupAddressFromApi(lat, lng),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve(''), 6500)
      }),
    ])
    const label = usableReverseLabel(address || '')
    if (label) return label
  } catch {
    undefined
  }
  return fallback
}

export async function geocodeAddress(query: string): Promise<GeoPoint | null> {
  const q = query.trim()
  if (!q) return null
  try {
    const places = await searchPlacesFromApi(q)
    const first = places[0]
    if (first && Number.isFinite(first.lat) && Number.isFinite(first.lng)) {
      return { lat: first.lat, lng: first.lng }
    }
  } catch {
    undefined
  }
  return null
}

export async function resolveRidePlace(query: string, _contextAddress = ''): Promise<RidePlace | null> {
  const q = query.trim()
  if (!q || NICKNAME_DESTS.has(q)) return null
  try {
    const places = await searchPlacesFromApi(q)
    const preferred = places[0]
    if (preferred) {
      return { label: preferred.name || q, address: preferred.address, lat: preferred.lat, lng: preferred.lng }
    }
  } catch {
    undefined
  }
  const known = lookupSuggestedPlace(q)
  if (known && known.name.replace(/\s+/g, '') === q.replace(/\s+/g, '') && Number.isFinite(known.lat) && Number.isFinite(known.lng)) {
    return { label: known.name, address: known.address, lat: known.lat, lng: known.lng }
  }
  return null
}
