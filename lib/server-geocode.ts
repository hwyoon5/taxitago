import { parseNaverReverseAddress, resolveNaverMapClientId } from '@/lib/naver-maps'

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

async function reverseGeocodeNaverRest(lat: number, lng: number) {
  const keyId = resolveNaverMapClientId()
  const secret = resolveNaverMapSecret()
  if (!keyId) return ''
  const query = `coords=${encodeURIComponent(`${lng},${lat}`)}&sourcecrs=epsg:4326&orders=${encodeURIComponent('roadaddr,addr')}&output=json`
  const urls = [
    `https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc?${query}`,
    `https://naveropenapi.apigw.ntruss.com/map-reversegeocode/v2/gc?${query}`,
  ]
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-NCP-APIGW-API-KEY-ID': keyId,
  }
  if (secret) headers['X-NCP-APIGW-API-KEY'] = secret
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers, cache: 'no-store' })
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
