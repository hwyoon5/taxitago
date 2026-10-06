export type KakaoSearchPlace = {
  name: string
  address: string
  jibun: string
  category: string
  lat: number
  lng: number
  kind?: 'parking'
}

function cleanEnv(value?: string | null) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
}

function staticEnv(name: string) {
  switch (name) {
    case 'KAKAO_REST_API_KEY':
      return process.env.KAKAO_REST_API_KEY
    case 'KAKAO_LOCAL_REST_API_KEY':
      return process.env.KAKAO_LOCAL_REST_API_KEY
    case 'KAKAO_API_KEY':
      return process.env.KAKAO_API_KEY
    default:
      return ''
  }
}

function runtimeEnv(name: string) {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })['process']
  return cleanEnv(proc?.['env']?.[name] || staticEnv(name))
}

function addressQueryVariants(query: string) {
  const spaced = query
    .replace(/([가-힣]+)(\d+번길)/g, '$1 $2')
    .replace(/(\d+번길)(\d)/g, '$1 $2')
    .replace(/([가-힣]+(?:로|길|대로))(\d)/g, '$1 $2')
    .replace(/([가-힣]+(?:동|읍|면|리|가))(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  const tight = query.replace(/\s+/g, '')
  return [...new Set([spaced, query.trim(), tight])].filter(Boolean).slice(0, 3)
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

async function kakaoGet(path: string, params: URLSearchParams, notices: string[]) {
  const key = kakaoRestKey()
  if (!params.toString()) return [] as unknown[]
  if (!key) {
    notices.push('kakao skipped: KAKAO_REST_API_KEY is missing')
    return [] as unknown[]
  }
  try {
    const response = await fetch(`https://dapi.kakao.com${path}?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `KakaoAK ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      notices.push(`kakao ${path} HTTP ${response.status}`)
      return [] as unknown[]
    }
    const payload = (await response.json()) as { documents?: unknown[] }
    return Array.isArray(payload.documents) ? payload.documents : []
  } catch (error) {
    notices.push(`kakao ${path} failed: ${error instanceof Error ? error.message : 'request error'}`)
    return [] as unknown[]
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
  const notices: string[] = []
  const q = sanitizeDestinationQuery(query)
  if (!q) return { places: [] as KakaoSearchPlace[], notices }
  const variants = addressQueryVariants(q)
  const batches = await Promise.all(
    variants.flatMap((variant) => [
      kakaoGet('/v2/local/search/keyword.json', new URLSearchParams({ query: variant, size: '15' }), notices),
      kakaoGet('/v2/local/search/address.json', new URLSearchParams({ query: variant, size: '15' }), notices),
    ]),
  )
  const keywords = batches.filter((_, index) => index % 2 === 0).flat()
  const addresses = batches.filter((_, index) => index % 2 === 1).flat()
  const places = [
    ...keywords.map((item) => fromKeyword(item as KakaoKeywordDoc)),
    ...addresses.map((item) => fromAddress(item as KakaoAddressDoc)),
  ].filter((item): item is KakaoSearchPlace => Boolean(item))
  const kept: KakaoSearchPlace[] = []
  for (const place of places) {
    if (kept.some((item) => samePlace(item, place))) continue
    kept.push(place)
  }
  return { places: kept, notices: [...new Set(notices)] }
}

// 장소 검색 결과 좌표를 기준으로 반경 내 주차장(PK6 카테고리)을 함께 조회한다.
// 이름에 '공영'이 들어간 시설은 공영주차장 배지로 구분한다.
export async function searchKakaoParkingLots(lat: number, lng: number) {
  const notices: string[] = []
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { places: [] as KakaoSearchPlace[], notices }
  const params = new URLSearchParams({
    category_group_code: 'PK6',
    x: String(lng),
    y: String(lat),
    radius: '2000',
    sort: 'distance',
    size: '8',
  })
  const docs = await kakaoGet('/v2/local/search/category.json', params, notices)
  const kept: KakaoSearchPlace[] = []
  for (const doc of docs) {
    const place = fromKeyword(doc as KakaoKeywordDoc)
    if (!place) continue
    const tagged: KakaoSearchPlace = {
      ...place,
      kind: 'parking',
      category: /공영/.test(place.name) || /공영/.test(place.category) ? '공영주차장' : '주차장',
    }
    if (kept.some((item) => samePlace(item, tagged))) continue
    kept.push(tagged)
    if (kept.length >= 5) break
  }
  return { places: kept, notices: [...new Set(notices)] }
}
