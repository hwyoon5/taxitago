import { naverGatewayHeaderSets, ncpGetJson, resolveNaverRestCredentials, resolveNaverSearchCredentials } from '@/lib/naver-apigw'

function coordLabel(lat: number, lng: number) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

function cleanAddress(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text && !/^(undefined|null)$/i.test(text) ? text : ''
}

function parseNaverReverseAddress(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''
  const root = payload as {
    address?: { roadAddress?: string; jibunAddress?: string; address?: string; roadaddr?: string; jibunaddr?: string }
    result?: { items?: Array<{ address?: string; roadAddress?: string; jibunAddress?: string }>; address?: { roadAddress?: string; jibunAddress?: string; address?: string; roadaddr?: string; jibunaddr?: string } }
    v2?: {
      address?: { roadAddress?: string; jibunAddress?: string; address?: string; jibunaddr?: string; roadaddr?: string }
      results?: Array<{
        name?: string
        region?: { area1?: { name?: string }; area2?: { name?: string }; area3?: { name?: string }; area4?: { name?: string } }
        land?: { name?: string; number1?: string; addition0?: { value?: string } }
      }>
    }
    results?: Array<{
      name?: string
      region?: { area1?: { name?: string }; area2?: { name?: string }; area3?: { name?: string }; area4?: { name?: string } }
      land?: { name?: string; number1?: string; addition0?: { value?: string } }
    }>
  }
  const v2 = root.v2 || root
  const address = (v2.address || root.address || root.result?.address) as
    | { roadAddress?: string; jibunAddress?: string; address?: string; roadaddr?: string; jibunaddr?: string }
    | undefined
  const road = cleanAddress(address?.roadAddress) || cleanAddress(address?.roadaddr)
  const jibun = cleanAddress(address?.jibunAddress) || cleanAddress(address?.jibunaddr) || cleanAddress(address?.address)
  if (road) return road
  if (jibun) return jibun
  const item = root.result?.items?.[0]
  const itemAddress = cleanAddress(item?.roadAddress) || cleanAddress(item?.jibunAddress) || cleanAddress(item?.address)
  if (itemAddress) return itemAddress
  const rows = Array.isArray(v2.results) ? v2.results : Array.isArray(root.results) ? root.results : []
  const result = rows.find((row) => row?.name === 'roadaddr') || rows.find((row) => row?.name === 'addr') || rows[0]
  if (!result) return ''
  return [
    result.region?.area1?.name,
    result.region?.area2?.name,
    result.region?.area3?.name,
    result.region?.area4?.name,
    result.land?.name,
    result.land?.number1,
    result.land?.addition0?.value,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function ncpJson(url: string) {
  for (const headers of naverGatewayHeaderSets()) {
    try {
      const { status, json } = await ncpGetJson(url, headers, 5000)
      if (status >= 200 && status < 300 && json) return json
    } catch {
      continue
    }
  }
  return null
}

async function reverseGeocodeNaverRest(lat: number, lng: number) {
  const { keyId, secret } = resolveNaverRestCredentials()
  if (!keyId || !secret) return ''
  const query = new URLSearchParams({
    coords: `${lng},${lat}`,
    sourcecrs: 'epsg:4326',
    orders: 'legalcode,admcode,addr,roadaddr',
    output: 'json',
  })
  const hosts = ['https://maps.apigw.ntruss.com', 'https://naveropenapi.apigw.ntruss.com']
  for (const host of hosts) {
    const payload = await ncpJson(`${host}/map-reversegeocode/v2/gc?${query.toString()}`)
    const address = parseNaverReverseAddress(payload)
    if (address) return address
  }
  return ''
}

async function reverseGeocodeNominatim(lat: number, lng: number) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&accept-language=ko`,
      {
        headers: { Accept: 'application/json', 'User-Agent': 'TaxiTago/1.0 (geocode)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      },
    )
    if (!response.ok) return ''
    const data = (await response.json()) as {
      display_name?: string
      address?: {
        state?: string
        city?: string
        province?: string
        county?: string
        borough?: string
        suburb?: string
        town?: string
        village?: string
        road?: string
        house_number?: string
        neighbourhood?: string
        quarter?: string
        city_district?: string
      }
    }
    const detail = data.address
    if (detail) {
      const road = [detail.road, detail.house_number].filter(Boolean).join(' ')
      const parts = [
        detail.state || detail.province || detail.city,
        detail.borough || detail.city_district || detail.county || detail.town,
        detail.suburb || detail.neighbourhood || detail.quarter || detail.village,
        road,
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
  const naver = await reverseGeocodeNaverRest(lat, lng)
  if (naver && !/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(naver)) return naver
  const osm = await reverseGeocodeNominatim(lat, lng)
  if (osm && !/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(osm)) return osm
  return ''
}

export type ForwardPlace = {
  name: string
  address: string
  jibun?: string
  category?: string
  lat: number
  lng: number
  trustName?: boolean
}

type NaverAddressRow = {
  roadAddress?: string
  jibunAddress?: string
  englishAddress?: string
  x?: string | number
  y?: string | number
  addressElements?: Array<{ types?: string[]; longName?: string; shortName?: string }>
}

function wgs84Point(latRaw: unknown, lngRaw: unknown): { lat: number; lng: number } | null {
  const lat = Number(latRaw)
  const lng = Number(lngRaw)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

function buildingNameOf(item: NaverAddressRow) {
  const building = item.addressElements?.find((row) => row.types?.includes('BUILDING_NAME'))
  return cleanAddress(building?.longName) || cleanAddress(building?.shortName)
}

function parseNaverGeocodePlaces(payload: unknown, query: string): ForwardPlace[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as { addresses?: NaverAddressRow[]; v2?: { addresses?: NaverAddressRow[] } }
  const rows = root.v2?.addresses || root.addresses || []
  return rows
    .map((item): ForwardPlace | null => {
      const road = cleanAddress(item.roadAddress)
      const jibun = cleanAddress(item.jibunAddress)
      const address = road || jibun
      const point = wgs84Point(item.y, item.x)
      if (!address || !point) return null
      const buildingName = buildingNameOf(item)
      return {
        name: buildingName || query,
        address,
        jibun: road && jibun && jibun !== road ? jibun : '',
        lat: point.lat,
        lng: point.lng,
        trustName: Boolean(buildingName),
      }
    })
    .filter((item): item is ForwardPlace => Boolean(item))
}

function parseNaverPlaceSearch(payload: unknown, query: string): ForwardPlace[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as {
    places?: unknown
    results?: unknown
    items?: unknown
    v1?: { places?: unknown }
  }
  const rows = [root.places, root.results, root.items, root.v1?.places].find((value) => Array.isArray(value) && value.length) as
    | Array<Record<string, unknown>>
    | undefined
  if (!rows) return []
  return rows
    .map((item): ForwardPlace | null => {
      const name = stripMarkup(cleanAddress(item.name) || cleanAddress(item.title) || cleanAddress(item.placeName) || query)
      const road = cleanAddress(item.roadAddress) || cleanAddress(item.road_address)
      const jibun = cleanAddress(item.jibunAddress) || cleanAddress(item.jibun_address)
      const address = road || jibun || cleanAddress(item.address)
      const point =
        wgs84Point(item.y, item.x) ||
        wgs84Point(item.lat, item.lng) ||
        wgs84Point(item.latitude, item.longitude)
      if (!name || !address || !point) return null
      return {
        name,
        address,
        jibun: road && jibun && jibun !== road ? jibun : '',
        category: categoryLabel(item.category || item.categoryName || item.bizCategory || item.ctg),
        lat: point.lat,
        lng: point.lng,
        trustName: true,
      }
    })
    .filter((item): item is ForwardPlace => Boolean(item))
}

function naverLocalPoint(mapy: unknown, mapx: unknown) {
  const y = Number(mapy)
  const x = Number(mapx)
  if (!Number.isFinite(y) || !Number.isFinite(x)) return null
  const lat = Math.abs(y) > 90 ? y / 1e7 : y
  const lng = Math.abs(x) > 180 ? x / 1e7 : x
  return wgs84Point(lat, lng)
}

function stripMarkup(value: string) {
  return value.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim()
}

function categoryLabel(value: unknown) {
  const text = cleanAddress(value)
  if (!text) return ''
  const parts = text
    .split(/[>,]/)
    .map((part) => part.trim())
    .filter(Boolean)
  return parts[parts.length - 1] || ''
}

let localSearchAuthFailed = false

async function forwardNaverLocalSearch(query: string, sort: 'comment' | 'random' = 'comment'): Promise<ForwardPlace[]> {
  if (localSearchAuthFailed) return []
  const { keyId, secret } = resolveNaverSearchCredentials()
  if (!keyId || !secret) return []
  const params = new URLSearchParams({ query, display: '5', start: '1', sort })
  const url = `https://openapi.naver.com/v1/search/local.json?${params.toString()}`
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Naver-Client-Id': keyId,
        'X-Naver-Client-Secret': secret,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (response.status === 401 || response.status === 403) {
      localSearchAuthFailed = true
      return []
    }
    if (!response.ok) return []
    const payload = (await response.json()) as {
      items?: Array<{ title?: string; category?: string; roadAddress?: string; address?: string; mapx?: string; mapy?: string }>
    }
    return (payload.items || [])
      .map((item): ForwardPlace | null => {
        const name = stripMarkup(cleanAddress(item.title) || query)
        const road = cleanAddress(item.roadAddress)
        const jibun = cleanAddress(item.address)
        const address = road || jibun
        const point = naverLocalPoint(item.mapy, item.mapx)
        if (!name || !address || !point) return null
        return {
          name,
          address,
          jibun: road && jibun && jibun !== road ? jibun : '',
          category: categoryLabel(item.category),
          lat: point.lat,
          lng: point.lng,
          trustName: true,
        }
      })
      .filter((item): item is ForwardPlace => Boolean(item))
  } catch {
    return []
  }
}

async function forwardNaverPlaceSearch(query: string): Promise<ForwardPlace[]> {
  const { keyId, secret } = resolveNaverRestCredentials()
  if (!keyId || !secret) return []
  const params = new URLSearchParams({ query, language: 'ko' })
  const hosts = ['https://maps.apigw.ntruss.com', 'https://naveropenapi.apigw.ntruss.com']
  const paths = [`/map-place/v1/search?${params}`, `/map-places/v1/search?${params}`]
  for (const host of hosts) {
    for (const path of paths) {
      const payload = await ncpJson(`${host}${path}`)
      const places = parseNaverPlaceSearch(payload, query)
      if (places.length) return places
    }
  }
  return []
}

async function forwardGeocodeNaver(query: string): Promise<ForwardPlace[]> {
  const { keyId, secret } = resolveNaverRestCredentials()
  if (!keyId || !secret) return []
  const params = new URLSearchParams({ query, output: 'json', count: '20', language: 'kor' })
  const hosts = ['https://maps.apigw.ntruss.com', 'https://naveropenapi.apigw.ntruss.com']
  for (const host of hosts) {
    const payload = await ncpJson(`${host}/map-geocode/v2/geocode?${params.toString()}`)
    const places = parseNaverGeocodePlaces(payload, query)
    if (places.length) return places
  }
  return []
}

type OsmAddress = {
  railway?: string
  amenity?: string
  building?: string
  tourism?: string
  shop?: string
  office?: string
  road?: string
  pedestrian?: string
  house_number?: string
  quarter?: string
  suburb?: string
  neighbourhood?: string
  borough?: string
  city_district?: string
  city?: string
  town?: string
  village?: string
  county?: string
  province?: string
  state?: string
  municipality?: string
}

function osmPlaceName(item: { name?: string; address?: OsmAddress }, query: string) {
  const address = item.address
  const provided =
    cleanAddress(item.name) ||
    cleanAddress(address?.railway) ||
    cleanAddress(address?.amenity) ||
    cleanAddress(address?.building) ||
    cleanAddress(address?.tourism) ||
    cleanAddress(address?.shop) ||
    cleanAddress(address?.office)
  return { name: provided || query, trustName: Boolean(provided) }
}

function osmKoreanAddress(address: OsmAddress | undefined) {
  if (!address) return ''
  const sido = cleanAddress(address.city) || cleanAddress(address.province) || cleanAddress(address.state)
  const sigungu =
    cleanAddress(address.borough) ||
    cleanAddress(address.city_district) ||
    cleanAddress(address.county) ||
    cleanAddress(address.town) ||
    cleanAddress(address.municipality)
  const locality =
    cleanAddress(address.quarter) || cleanAddress(address.suburb) || cleanAddress(address.neighbourhood) || cleanAddress(address.village)
  const road = [cleanAddress(address.road) || cleanAddress(address.pedestrian), cleanAddress(address.house_number)].filter(Boolean).join(' ')
  return [sido, sigungu, locality, road].filter(Boolean).join(' ')
}

async function forwardGeocodeNominatim(query: string): Promise<ForwardPlace[]> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=kr&accept-language=ko&q=${encodeURIComponent(query)}`,
      {
        headers: { Accept: 'application/json', 'User-Agent': 'TaxiTago/1.0 (geocode)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      },
    )
    if (!response.ok) return []
    const data = (await response.json()) as Array<{ lat?: string; lon?: string; name?: string; display_name?: string; address?: OsmAddress }>
    return data
      .map((item): ForwardPlace | null => {
        const lat = Number(item.lat)
        const lng = Number(item.lon)
        const address = osmKoreanAddress(item.address) || cleanAddress(item.display_name)
        if (!address || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
        const named = osmPlaceName(item, query)
        return { name: named.name, address, category: osmCategory(item.address, named.name), lat, lng, trustName: named.trustName }
      })
      .filter((item): item is ForwardPlace => Boolean(item))
  } catch {
    return []
  }
}

function osmCategory(address: OsmAddress | undefined, name: string) {
  const raw = cleanAddress(address?.amenity) || cleanAddress(address?.railway) || cleanAddress(address?.shop) || cleanAddress(address?.tourism) || cleanAddress(address?.office)
  const known: Record<string, string> = {
    parking: '주차장',
    bus_station: '버스정류장',
    hospital: '병원',
    clinic: '병원',
    supermarket: '마트',
    mall: '쇼핑',
    school: '학교',
    university: '학교',
    townhall: '관공서',
    station: '지하철·기차역',
    subway: '지하철·기차역',
  }
  return known[raw] || inferCategory(name)
}

async function forwardNominatimBounded(query: string, viewbox: string): Promise<ForwardPlace[]> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=kr&accept-language=ko&bounded=1&viewbox=${viewbox}&q=${encodeURIComponent(query)}`,
      {
        headers: { Accept: 'application/json', 'User-Agent': 'TaxiTago/1.0 (geocode)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      },
    )
    if (!response.ok) return []
    const data = (await response.json()) as Array<{ lat?: string; lon?: string; name?: string; address?: OsmAddress }>
    return data
      .map((item): ForwardPlace | null => {
        const lat = Number(item.lat)
        const lng = Number(item.lon)
        const address = osmKoreanAddress(item.address)
        if (!address || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
        const named = osmPlaceName(item, query)
        return { name: named.name, address, category: osmCategory(item.address, named.name) || query, lat, lng, trustName: true }
      })
      .filter((item): item is ForwardPlace => Boolean(item))
  } catch {
    return []
  }
}

function compactQuery(value: string) {
  return value.replace(/\s+/g, '').toLowerCase()
}

function looseText(value: string) {
  return compactQuery(value).replace(/국제/g, '')
}

function placeRelevance(place: ForwardPlace, query: string) {
  const q = compactQuery(query)
  const name = compactQuery(place.name)
  const address = compactQuery(place.address)
  const looseQuery = looseText(query)
  const looseName = looseText(place.name)
  if (!q) return 0
  if (name === q || looseName === looseQuery) return 300
  if (q.length >= 2 && (name.startsWith(q) || looseName.startsWith(looseQuery))) return 220
  if (q.length >= 2 && (name.includes(q) || looseName.includes(looseQuery))) return 180
  if (q.length >= 2 && address.includes(q)) return 160
  return 0
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const latMeters = (a.lat - b.lat) * 111_320
  const lngMeters = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot(latMeters, lngMeters)
}

function samePlace(a: ForwardPlace, b: ForwardPlace) {
  const sameAddress = compactQuery(a.address) !== '' && compactQuery(a.address) === compactQuery(b.address)
  const sameName = compactQuery(a.name) === compactQuery(b.name)
  if (sameAddress) return true
  if (sameName && distanceMeters(a, b) < 150) return true
  return false
}

function inferCategory(name: string, category?: string) {
  const given = (category || '').trim()
  if (given) return given
  if (/역$/.test(name)) return '지하철·기차역'
  if (/시청|구청|군청|주민센터/.test(name)) return '관공서'
  if (/공항/.test(name)) return '공항'
  if (/병원|의원|보건/.test(name)) return '병원'
  if (/마트|시장|백화점/.test(name)) return '쇼핑'
  if (/공원/.test(name)) return '공원'
  if (/터미널|정류장/.test(name)) return '교통'
  if (/대학교|학교/.test(name)) return '학교'
  if (/주차장/.test(name)) return '주차장'
  return ''
}

function looksLikeStreetAddress(query: string) {
  return /(?:로|길)\s*\d/.test(query) || /\d+\s*번길/.test(query)
}

function queryAliases(query: string) {
  const aliases = [query]
  if (query.endsWith('시청') && !query.endsWith('광역시청')) aliases.push(query.replace(/시청$/, '광역시청'))
  if (/공항$/.test(query) && !query.includes('국제')) aliases.push(query.replace(/공항$/, '국제공항'))
  return [...new Set(aliases)].slice(0, 3)
}

function publishPlaces(places: ForwardPlace[], query: string) {
  const q = compactQuery(query)
  const ranked = places
    .map((place) => ({ place, score: placeRelevance(place, query) }))
    .sort((a, b) => b.score - a.score || (compactQuery(a.place.name) === q ? -1 : 1))
  const kept: ForwardPlace[] = []
  const take = (rows: typeof ranked, limit: number) => {
    for (const row of rows) {
      if (kept.length >= limit) break
      if (kept.some((place) => samePlace(place, row.place))) continue
      kept.push(row.place)
    }
  }
  take(ranked.filter((row) => row.score >= 160), 8)
  take(ranked.filter((row) => row.score < 160), 12)
  return kept.map((place) => ({
    name: place.name,
    address: place.address,
    jibun: place.jibun || '',
    category: inferCategory(place.name, place.category),
    lat: place.lat,
    lng: place.lng,
  }))
}

const NEARBY_FACILITIES = ['주차장', '버스정류장', '마트', '병원'] as const

export async function forwardGeocodeOnServer(query: string) {
  const q = query.trim()
  if (!q) return [] as ReturnType<typeof publishPlaces>
  const aliases = queryAliases(q)
  const [localComment, localRandom, geocodeGroups, nominatimGroups] = await Promise.all([
    forwardNaverLocalSearch(q, 'comment'),
    forwardNaverLocalSearch(q, 'random'),
    Promise.all(aliases.map((alias) => forwardGeocodeNaver(alias))),
    Promise.all(aliases.map((alias) => forwardGeocodeNominatim(alias))),
  ])
  const merged = [...localComment, ...localRandom, ...geocodeGroups.flat(), ...nominatimGroups.flat()]
  const anchor = publishPlaces(merged, q)[0]
  if (!anchor || looksLikeStreetAddress(q)) return publishPlaces(merged, q)
  const span = 0.03
  const viewbox = `${anchor.lng - span},${anchor.lat + 0.02},${anchor.lng + span},${anchor.lat - 0.02}`
  const nearbyGroups = await Promise.all(NEARBY_FACILITIES.map((facility) => forwardNominatimBounded(facility, viewbox)))
  const nearby = nearbyGroups
    .flat()
    .filter((place) => distanceMeters(anchor, place) <= 2500)
    .map((place) => ({ ...place, category: place.category || inferCategory(place.name), trustName: true }))
  return publishPlaces([...merged, ...nearby], q)
}
