import { callNaverReverseGeocode, ensureNaverGeocoder } from '@/lib/naver-maps'
import { centerForRegion, lookupSuggestedPlace, regionDisplayName, regionFromAccessText, regionFromQuery, resolveRegion } from '@/lib/region-destinations'

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

  return (async () => {
    const accurate = await read({ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 })
    if (accurate) return accurate
    return read({ enableHighAccuracy: false, timeout: 8000, maximumAge: 120_000 })
  })()
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

async function reverseGeocodeNaver(lat: number, lng: number) {
  try {
    if (typeof window === 'undefined') return null
    const sdk = await ensureNaverGeocoder(4000)
    const maps = window.naver?.maps
    const serviceReady = typeof maps?.Service?.reverseGeocode === 'function' || typeof sdk?.Service?.reverseGeocode === 'function'
    if (!serviceReady) return null
    return await callNaverReverseGeocode(lat, lng, 4000)
  } catch {
    return null
  }
}

async function reverseGeocodeNominatim(lat: number, lng: number) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ko`,
      { headers: { Accept: 'application/json' } },
    )
    if (!response.ok) return null
    const data = (await response.json()) as {
      display_name?: string
      address?: {
        city?: string
        province?: string
        county?: string
        borough?: string
        suburb?: string
        town?: string
        village?: string
        road?: string
        neighbourhood?: string
        quarter?: string
        city_district?: string
      }
    }
    const detail = data.address
    if (detail) {
      const region = detail.province || detail.city || detail.county || ''
      const district = detail.borough || detail.city_district || detail.suburb || detail.town || detail.village || ''
      const road = detail.road || detail.neighbourhood || detail.quarter || ''
      const parts = [region, district, road].filter(Boolean)
      if (parts.length) return parts.join(' ')
    }
    return data.display_name?.split(',').slice(0, 3).join(' ').replace(/\s+/g, ' ').trim() || null
  } catch {
    return null
  }
}

export async function reverseGeocode(lat: number, lng: number) {
  try {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return failedReverseAddress(lat, lng)
    if (typeof window !== 'undefined') {
      const { lookupAddressFromApi } = await import('@/lib/geocode-client')
      const address = (await lookupAddressFromApi(lat, lng)).trim()
      if (address) return address
    }
    return failedReverseAddress(lat, lng)
  } catch {
    return failedReverseAddress(lat, lng)
  }
}

export async function geocodeAddress(query: string): Promise<GeoPoint | null> {
  const q = query.trim()
  if (!q) return null
  if (typeof window !== 'undefined') {
    try {
      const { searchPlacesFromApi } = await import('@/lib/geocode-client')
      const places = await searchPlacesFromApi(q)
      const first = places[0]
      if (first && Number.isFinite(first.lat) && Number.isFinite(first.lng)) {
        return { lat: first.lat, lng: first.lng }
      }
    } catch {
      undefined
    }
  }
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=kr&q=${encodeURIComponent(q)}&accept-language=ko`,
      { headers: { Accept: 'application/json' } },
    )
    if (!response.ok) return null
    const data = (await response.json()) as Array<{ lat?: string; lon?: string }>
    const lat = Number(data[0]?.lat)
    const lng = Number(data[0]?.lon)
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
  } catch {
    return null
  }
}

export async function resolveRidePlace(query: string, contextAddress = ''): Promise<RidePlace | null> {
  const q = query.trim()
  if (!q || NICKNAME_DESTS.has(q)) return null
  const known = lookupSuggestedPlace(q)
  if (known && Number.isFinite(known.lat) && Number.isFinite(known.lng)) {
    return { label: known.name, address: known.address || q, lat: known.lat, lng: known.lng }
  }
  const namedRegion = regionFromQuery(q)
  const geo = await geocodeAddress(q)
  if (geo) {
    if (typeof window !== 'undefined') {
      try {
        const { searchPlacesFromApi } = await import('@/lib/geocode-client')
        const places = await searchPlacesFromApi(q)
        const preferred =
          (namedRegion ? places.find((place) => regionFromQuery(place.address) === namedRegion) : null) || places[0]
        if (preferred) return { label: q, address: preferred.address, lat: preferred.lat, lng: preferred.lng }
      } catch {
        undefined
      }
    }
    return { label: q, address: q, lat: geo.lat, lng: geo.lng }
  }
  if (!namedRegion) {
    const contextRegion = regionFromQuery(contextAddress)
    if (contextRegion) {
      const nearby = await geocodeAddress(`${regionDisplayName(contextRegion)} ${q}`)
      if (nearby) return { label: q, address: q, lat: nearby.lat, lng: nearby.lng }
    }
  }
  return null
}
