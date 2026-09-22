import { parseNaverReverseAddress, resolveNaverMapClientId } from '@/lib/naver-maps'
import { regionDisplayName, regionFromQuery } from '@/lib/region-destinations'

function coordLabel(lat: number, lng: number) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

function resolveNaverMapSecret() {
  return (
    process.env.NAVER_MAP_CLIENT_SECRET ||
    process.env.NAVER_CLIENT_SECRET ||
    process.env.NCP_API_KEY ||
    process.env.NCP_APIGW_API_KEY ||
    process.env.NAVER_MAP_API_KEY ||
    process.env.NAVER_API_KEY ||
    ''
  ).trim()
}

function formatGcResults(payload: unknown) {
  const parsed = parseNaverReverseAddress(payload)
  if (parsed) return parsed
  if (!payload || typeof payload !== 'object') return ''
  const results = (payload as { results?: Array<{ name?: string; region?: Record<string, { name?: string }>; land?: { name?: string; number1?: string; addition0?: { value?: string } } }> }).results
  if (!Array.isArray(results) || !results.length) return ''
  const preferred = results.find((item) => item.name === 'roadaddr') || results.find((item) => item.name === 'addr') || results[0]
  const parts = [
    preferred.region?.area1?.name,
    preferred.region?.area2?.name,
    preferred.region?.area3?.name,
    preferred.region?.area4?.name,
    preferred.land?.name,
    preferred.land?.number1,
    preferred.land?.addition0?.value,
  ].filter(Boolean)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export function naverGatewayHeaders() {
  const keyId = resolveNaverMapClientId()
  const secret = resolveNaverMapSecret()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (keyId) headers['X-NCP-APIGW-API-KEY-ID'] = keyId
  if (secret) headers['X-NCP-APIGW-API-KEY'] = secret
  return { keyId, headers }
}

async function reverseGeocodeNaverRest(lat: number, lng: number) {
  const { keyId, headers } = naverGatewayHeaders()
  if (!keyId) return ''
  const query = `coords=${encodeURIComponent(`${lng},${lat}`)}&sourcecrs=epsg:4326&orders=${encodeURIComponent('roadaddr,addr')}&output=json`
  const urls = [
    `https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?${query}`,
    `https://naveropenapi.apigw.ntruss.com/map-reversegeocode/v2/gc?${query}`,
  ]
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(4000) })
      if (!response.ok) continue
      const payload = (await response.json()) as unknown
      const address = formatGcResults(payload)
      if (address) return address
    } catch {
      continue
    }
  }
  return ''
}

async function reverseGeocodeNominatim(lat: number, lng: number) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&accept-language=ko`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'TaxiTago/1.0 (geocode)',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      },
    )
    if (!response.ok) return ''
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
      const parts = [
        detail.province || detail.city || detail.county,
        detail.borough || detail.city_district || detail.suburb || detail.town || detail.village,
        detail.road || detail.neighbourhood || detail.quarter,
      ].filter(Boolean)
      if (parts.length) return parts.join(' ')
    }
    return data.display_name?.split(',').slice(0, 3).join(' ').replace(/\s+/g, ' ').trim() || ''
  } catch {
    return ''
  }
}

export async function reverseGeocodeOnServer(lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return coordLabel(lat, lng)
  }
  try {
    const naver = await reverseGeocodeNaverRest(lat, lng)
    if (naver) return naver
  } catch {
    undefined
  }
  try {
    const osm = await reverseGeocodeNominatim(lat, lng)
    if (osm) return osm
  } catch {
    undefined
  }
  return coordLabel(lat, lng)
}

export type ForwardPlace = { name: string; address: string; lat: number; lng: number }

async function forwardGeocodeNaver(query: string): Promise<ForwardPlace[]> {
  const { keyId, headers } = naverGatewayHeaders()
  if (!keyId) return []
  const encoded = encodeURIComponent(query)
  const urls = [
    `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encoded}`,
    `https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode?query=${encoded}`,
  ]
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(4000) })
      if (!response.ok) continue
      const payload = (await response.json()) as {
        addresses?: Array<{ roadAddress?: string; jibunAddress?: string; x?: string; y?: string }>
        v2?: { addresses?: Array<{ roadAddress?: string; jibunAddress?: string; x?: string; y?: string }> }
      }
      const rows = payload.v2?.addresses || payload.addresses || []
      const places = rows
        .map((item) => {
          const address = (item.roadAddress || item.jibunAddress || '').trim()
          const lat = Number(item.y)
          const lng = Number(item.x)
          if (!address || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
          return { name: query, address, lat, lng }
        })
        .filter((item): item is ForwardPlace => Boolean(item))
      if (places.length) return places
    } catch {
      continue
    }
  }
  return []
}

async function forwardGeocodeNominatim(query: string): Promise<ForwardPlace[]> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&countrycodes=kr&accept-language=ko&q=${encodeURIComponent(query)}`,
      {
        headers: { Accept: 'application/json', 'User-Agent': 'TaxiTago/1.0 (geocode)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      },
    )
    if (!response.ok) return []
    const data = (await response.json()) as Array<{ display_name?: string; lat?: string; lon?: string; name?: string }>
    return data
      .map((item) => {
        const lat = Number(item.lat)
        const lng = Number(item.lon)
        const address = (item.display_name || '').split(',').slice(0, 4).join(' ').replace(/\s+/g, ' ').trim()
        if (!address || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
        return { name: item.name || query, address, lat, lng }
      })
      .filter((item): item is ForwardPlace => Boolean(item))
  } catch {
    return []
  }
}

function preferNamedRegion(places: ForwardPlace[], query: string) {
  const named = regionFromQuery(query)
  if (!named || !places.length) return places
  const matched = places.filter((place) => regionFromQuery(`${place.name} ${place.address}`) === named)
  return matched.length ? matched : places
}

function uniqueForwardPlaces(places: ForwardPlace[]) {
  const seen = new Set<string>()
  return places.filter((place) => {
    const key = `${place.address}|${place.lat.toFixed(5)}|${place.lng.toFixed(5)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function forwardGeocodeOnServer(query: string) {
  const q = query.trim()
  if (!q) return [] as ForwardPlace[]
  const named = regionFromQuery(q)
  const queries = named ? [q, `${regionDisplayName(named)} ${q}`] : [q]
  const collected: ForwardPlace[] = []
  for (const item of queries) {
    try {
      collected.push(...(await forwardGeocodeNaver(item)))
    } catch {
      undefined
    }
    if (!named && collected.length) break
    if (named && collected.some((place) => regionFromQuery(place.address) === named)) break
  }
  if (!collected.length || (named && !collected.some((place) => regionFromQuery(place.address) === named))) {
    for (const item of queries) {
      try {
        collected.push(...(await forwardGeocodeNominatim(item)))
      } catch {
        undefined
      }
    }
  }
  return preferNamedRegion(uniqueForwardPlaces(collected), q).slice(0, 10)
}
