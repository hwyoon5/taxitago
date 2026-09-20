import { ensureNaverGeocoder, loadNaverMaps, type NaverMapsSdk, type NaverReverseGeocodeResponse } from '@/lib/naver-maps'
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

function formatNaverReverse(response: {
  v2?: {
    address?: { roadAddress?: string; jibunAddress?: string }
    results?: Array<{
      region?: { area1?: { name?: string }; area2?: { name?: string }; area3?: { name?: string }; area4?: { name?: string } }
      land?: { name?: string; number1?: string; addition0?: { value?: string } }
    }>
  }
}) {
  const road = response.v2?.address?.roadAddress?.trim()
  const jibun = response.v2?.address?.jibunAddress?.trim()
  if (road) return road
  if (jibun) return jibun
  const result = response.v2?.results?.[0]
  if (!result) return ''
  const parts = [
    result.region?.area1?.name,
    result.region?.area2?.name,
    result.region?.area3?.name,
    result.region?.area4?.name,
    result.land?.name,
    result.land?.number1,
    result.land?.addition0?.value,
  ].filter(Boolean)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function isNaverReverseOk(status: unknown, service: NonNullable<NaverMapsSdk['Service']>) {
  const ok = service.Status?.OK as unknown
  const error = service.Status?.ERROR as unknown
  if (status === error && error !== undefined) return false
  if (ok !== undefined && status === ok) return true
  if (status === 0 || status === 'OK' || status === 'ok') return true
  return status !== error
}

async function reverseGeocodeNaver(lat: number, lng: number) {
  try {
    const sdk = await ensureNaverGeocoder(400)
    const service = sdk?.Service
    if (!sdk || typeof service?.reverseGeocode !== 'function') return null
    const coords = new sdk.LatLng(lat, lng)
    const orders = [service.OrderType?.ROAD_ADDR, service.OrderType?.ADDR].filter(Boolean).join(',') || 'roadaddr,addr'
    return await new Promise<string | null>((resolve) => {
      let settled = false
      const finish = (value: string | null) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        resolve(value)
      }
      const timer = window.setTimeout(() => finish(null), 900)
      const handle = (status: unknown, response: NaverReverseGeocodeResponse) => {
        try {
          const payload =
            response && typeof response === 'object' && (response.v2 || (response as { result?: unknown }).result)
              ? response
              : ((status as NaverReverseGeocodeResponse) || response)
          const formatted = formatNaverReverse(payload)
          if (formatted && isNaverReverseOk(status, service)) {
            finish(formatted)
            return
          }
          if (formatted) {
            finish(formatted)
            return
          }
          finish(null)
        } catch {
          finish(null)
        }
      }
      try {
        service.reverseGeocode({ coords, orders }, handle)
      } catch {
        try {
          service.reverseGeocode({ coords }, handle)
        } catch {
          finish(null)
        }
      }
    })
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
    const naverPromise = reverseGeocodeNaver(lat, lng)
    const osmPromise = reverseGeocodeNominatim(lat, lng)
    const naverQuick = await Promise.race([
      naverPromise,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 650)),
    ])
    if (naverQuick) return naverQuick
    const [naver, osm] = await Promise.all([naverPromise, osmPromise])
    return naver || osm || failedReverseAddress(lat, lng)
  } catch {
    return failedReverseAddress(lat, lng)
  }
}

export async function geocodeAddress(query: string): Promise<GeoPoint | null> {
  const q = query.trim()
  if (!q) return null
  const sdk = await loadNaverMaps()
  const geocode = sdk?.Service?.geocode
  if (sdk && geocode) {
    const naver = await new Promise<GeoPoint | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 4000)
      try {
        geocode({ query: q }, (status, response) => {
          window.clearTimeout(timer)
          if (status !== sdk.Service?.Status.OK) {
            resolve(null)
            return
          }
          const item = response.v2?.addresses?.[0]
          const lat = Number(item?.y)
          const lng = Number(item?.x)
          resolve(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null)
        })
      } catch {
        window.clearTimeout(timer)
        resolve(null)
      }
    })
    if (naver) return naver
  }
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}&accept-language=ko`,
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
  const regionHint = contextAddress.trim()
  const queries = regionHint && !q.includes(regionHint.slice(0, 2)) ? [q, `${q} ${regionHint}`] : [q]
  for (const item of queries) {
    const geo = await geocodeAddress(item)
    if (geo) return { label: q, address: q, lat: geo.lat, lng: geo.lng }
  }
  return null
}
