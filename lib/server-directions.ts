import { naverGatewayHeaders } from '@/lib/server-geocode'

export type RoutePoint = { lat: number; lng: number }

function parseLngLatPair(item: unknown): RoutePoint | null {
  if (Array.isArray(item) && item.length >= 2) {
    const first = Number(item[0])
    const second = Number(item[1])
    if (!Number.isFinite(first) || !Number.isFinite(second)) return null
    if (Math.abs(second) <= 90 && Math.abs(first) <= 180) return { lat: second, lng: first }
    if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return { lat: first, lng: second }
    return null
  }
  if (!item || typeof item !== 'object') return null
  const row = item as { lat?: unknown; lng?: unknown; y?: unknown; x?: unknown }
  const lat = Number(row.lat ?? row.y)
  const lng = Number(row.lng ?? row.x)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

function pointsFromUnknownPath(value: unknown): RoutePoint[] {
  if (!Array.isArray(value)) return []
  return value.map(parseLngLatPair).filter((item): item is RoutePoint => Boolean(item))
}

function parseNaverDrivingPath(payload: unknown): RoutePoint[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as { route?: Record<string, unknown>; result?: { route?: Record<string, unknown> } }
  const route = root.route || root.result?.route
  if (!route) return []
  for (const value of Object.values(route)) {
    const legs = Array.isArray(value) ? value : value ? [value] : []
    for (const leg of legs) {
      if (!leg || typeof leg !== 'object') continue
      const row = leg as { path?: unknown; points?: unknown }
      const points = pointsFromUnknownPath(row.path) 
      if (points.length >= 2) return points
      const alt = pointsFromUnknownPath(row.points)
      if (alt.length >= 2) return alt
    }
  }
  return []
}

async function drivingPathNaver(origin: RoutePoint, dest: RoutePoint): Promise<RoutePoint[]> {
  const { keyId, headers } = naverGatewayHeaders()
  if (!keyId) return []
  const query = `start=${encodeURIComponent(`${origin.lng},${origin.lat}`)}&goal=${encodeURIComponent(`${dest.lng},${dest.lat}`)}&option=traoptimal`
  const urls = [
    `https://maps.apigw.ntruss.com/map-direction/v1/driving?${query}`,
    `https://maps.apigw.ntruss.com/map-direction-15/v1/driving?${query}`,
    `https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving?${query}`,
    `https://naveropenapi.apigw.ntruss.com/map-direction-15/v1/driving?${query}`,
  ]
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(5000) })
      if (!response.ok) continue
      const points = parseNaverDrivingPath(await response.json())
      if (points.length >= 2) return points
    } catch {
      continue
    }
  }
  return []
}

async function drivingPathOsrm(origin: RoutePoint, dest: RoutePoint): Promise<RoutePoint[]> {
  try {
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`,
      {
        headers: { Accept: 'application/json', 'User-Agent': 'TaxiTago/1.0 (directions)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      },
    )
    if (!response.ok) return []
    const payload = (await response.json()) as { routes?: Array<{ geometry?: { coordinates?: unknown[] } }> }
    const coords = payload.routes?.[0]?.geometry?.coordinates
    if (!Array.isArray(coords)) return []
    return coords.map(parseLngLatPair).filter((item): item is RoutePoint => Boolean(item))
  } catch {
    return []
  }
}

export async function drivingPathOnServer(origin: RoutePoint, dest: RoutePoint) {
  if (
    !Number.isFinite(origin.lat) ||
    !Number.isFinite(origin.lng) ||
    !Number.isFinite(dest.lat) ||
    !Number.isFinite(dest.lng)
  ) {
    return [] as RoutePoint[]
  }
  try {
    const naver = await drivingPathNaver(origin, dest)
    if (naver.length >= 2) return naver
  } catch {
    undefined
  }
  try {
    return await drivingPathOsrm(origin, dest)
  } catch {
    return []
  }
}
