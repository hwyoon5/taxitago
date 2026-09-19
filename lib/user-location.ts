import { loadNaverMaps } from '@/lib/naver-maps'
import { centerForRegion, regionFromAccessText, resolveRegion } from '@/lib/region-destinations'

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

function coordFallbackAddress(lat: number, lng: number) {
  const region = resolveRegion('', lat, lng)
  const label = REGION_FALLBACK_LABEL[region] || '부산광역시'
  return `${label} 현재 접속 지역`
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

async function reverseGeocodeNaver(lat: number, lng: number) {
  const sdk = await loadNaverMaps()
  const service = sdk?.Service
  if (!sdk || !service?.reverseGeocode) return null
  return new Promise<string | null>((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 4000)
    try {
      service.reverseGeocode(
        {
          coords: new sdk.LatLng(lat, lng),
          orders: [service.OrderType?.ROAD_ADDR, service.OrderType?.ADDR].filter(Boolean).join(','),
        },
        (status, response) => {
          window.clearTimeout(timer)
          if (status !== service.Status.OK) {
            resolve(null)
            return
          }
          resolve(formatNaverReverse(response) || null)
        },
      )
    } catch {
      window.clearTimeout(timer)
      resolve(null)
    }
  })
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
  const naver = await reverseGeocodeNaver(lat, lng)
  if (naver) return naver
  const osm = await reverseGeocodeNominatim(lat, lng)
  if (osm) return osm
  return coordFallbackAddress(lat, lng)
}
