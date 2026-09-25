import { env as nodeEnv } from 'node:process'

export type KakaoSearchPlace = {
  name: string
  address: string
  jibun: string
  category: string
  lat: number
  lng: number
}

function cleanEnv(value?: string | null) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

function runtimeEnv(name: string) {
  return cleanEnv(nodeEnv[name] || process.env[name])
}

function kakaoRestKey() {
  const names = ['KAKAO_REST_API_KEY', 'KAKAO_LOCAL_REST_API_KEY', 'KAKAO_API_KEY'] as const
  for (const name of names) {
    const value = runtimeEnv(name)
    if (value) return value
  }
  return ''
}

export function sanitizeDestinationQuery(value: string) {
  return value
    .replace(/\u00a0|\u3000/g, ' ')
    .replace(/[，、]/g, ' ')
    .replace(/[()[\]{}<>「」『』"'`~!@#$%^&*_=+\\|/;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function wgsPoint(lngRaw: unknown, latRaw: unknown) {
  const lng = Number(lngRaw)
  const lat = Number(latRaw)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

function categoryLabel(value: string) {
  const parts = value
    .split('>')
    .map((part) => part.trim())
    .filter(Boolean)
  return parts[parts.length - 1] || ''
}

type KakaoLot = {
  address_name?: string
  region_1depth_name?: string
  region_2depth_name?: string
  region_3depth_name?: string
  mountain_yn?: string
  main_address_no?: string
  sub_address_no?: string
}

type KakaoRoad = {
  address_name?: string
  region_1depth_name?: string
  region_2depth_name?: string
  region_3depth_name?: string
  road_name?: string
  main_building_no?: string
  sub_building_no?: string
  building_name?: string
}

type KakaoKeywordDoc = {
  place_name?: string
  address_name?: string
  road_address_name?: string
  category_name?: string
  category_group_name?: string
  x?: string
  y?: string
  address?: KakaoLot
  road_address?: KakaoRoad
}

type KakaoAddressDoc = {
  address_name?: string
  x?: string
  y?: string
  address?: KakaoLot
  road_address?: KakaoRoad
}

function lotNumber(main?: string, sub?: string) {
  const head = text(main)
  const tail = text(sub)
  if (!head || head === '0') return ''
  if (!tail || tail === '0') return head
  return `${head}-${tail}`
}

function joinAddress(parts: Array<string | undefined>) {
  return parts.map((part) => text(part)).filter(Boolean).join(' ')
}

function withLot(base: string, lot: string) {
  const address = text(base)
  if (!lot) return address
  if (address.includes(lot)) return address
  return address ? `${address} ${lot}` : lot
}

function fullJibun(addressName: string, lot?: KakaoLot) {
  const number = lotNumber(lot?.main_address_no, lot?.sub_address_no)
  const mountain = lot?.mountain_yn === 'Y' ? '산' : ''
  const composed = joinAddress([lot?.region_1depth_name, lot?.region_2depth_name, lot?.region_3depth_name, `${mountain}${number}`.trim()])
  const named = withLot(addressName, number ? `${mountain}${number}`.trim() : '')
  return named.length >= composed.length ? named : composed
}

function fullRoad(addressName: string, road?: KakaoRoad) {
  const number = lotNumber(road?.main_building_no, road?.sub_building_no)
  const composed = joinAddress([road?.region_1depth_name, road?.region_2depth_name, road?.road_name, number])
  const named = withLot(addressName, number)
  return named.length >= composed.length ? named : composed
}

async function kakaoGet(path: string, query: string) {
  const key = kakaoRestKey()
  if (!key || !query) return [] as unknown[]
  const params = new URLSearchParams({ query, size: '15' })
  try {
    const response = await fetch(`https://dapi.kakao.com${path}?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `KakaoAK ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return []
    const payload = (await response.json()) as { documents?: unknown[] }
    return Array.isArray(payload.documents) ? payload.documents : []
  } catch {
    return []
  }
}

function fromKeyword(item: KakaoKeywordDoc): KakaoSearchPlace | null {
  const point = wgsPoint(item.x, item.y)
  const road = fullRoad(text(item.road_address_name) || text(item.road_address?.address_name), item.road_address)
  const jibun = fullJibun(text(item.address_name) || text(item.address?.address_name), item.address)
  const address = road || jibun
  const name = text(item.place_name) || address
  if (!point || !name || !address) return null
  return {
    name,
    address,
    jibun: jibun && jibun !== address ? jibun : '',
    category: categoryLabel(text(item.category_group_name) || text(item.category_name)),
    lat: point.lat,
    lng: point.lng,
  }
}

function fromAddress(item: KakaoAddressDoc): KakaoSearchPlace | null {
  const point = wgsPoint(item.x, item.y)
  const road = fullRoad(text(item.road_address?.address_name), item.road_address)
  const jibun = fullJibun(text(item.address?.address_name) || text(item.address_name), item.address)
  const address = road || jibun
  const name = text(item.road_address?.building_name) || address
  if (!point || !name || !address) return null
  return {
    name,
    address,
    jibun: jibun && jibun !== address ? jibun : '',
    category: '',
    lat: point.lat,
    lng: point.lng,
  }
}

function samePlace(a: KakaoSearchPlace, b: KakaoSearchPlace) {
  const sameAddress = a.address.replace(/\s+/g, '') !== '' && a.address.replace(/\s+/g, '') === b.address.replace(/\s+/g, '')
  const near = Math.abs(a.lat - b.lat) < 0.0004 && Math.abs(a.lng - b.lng) < 0.0004
  return sameAddress || (a.name === b.name && near)
}

export async function searchKakaoPlaces(query: string) {
  const q = sanitizeDestinationQuery(query)
  if (!q) return [] as KakaoSearchPlace[]
  const [keywords, addresses] = await Promise.all([
    kakaoGet('/v2/local/search/keyword.json', q),
    kakaoGet('/v2/local/search/address.json', q),
  ])
  const places = [
    ...keywords.map((item) => fromKeyword(item as KakaoKeywordDoc)),
    ...addresses.map((item) => fromAddress(item as KakaoAddressDoc)),
  ].filter((item): item is KakaoSearchPlace => Boolean(item))
  const kept: KakaoSearchPlace[] = []
  for (const place of places) {
    if (kept.some((item) => samePlace(item, place))) continue
    kept.push(place)
  }
  return kept
}
