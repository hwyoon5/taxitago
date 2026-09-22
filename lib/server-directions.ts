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

function decodePathString(raw: string): RoutePoint[] {
  const text = raw.trim()
  if (!text) return []
  const chunks = text.split(/[:;|+\s]+/).filter(Boolean)
  const fromChunks = chunks
    .map((chunk) => {
      const parts = chunk.split(',').map(Number)
      return parseLngLatPair(parts)
    })
    .filter((item): item is RoutePoint => Boolean(item))
  if (fromChunks.length >= 2) return fromChunks
  const nums = text.split(/[,\s]+/).map(Number).filter((value) => Number.isFinite(value))
  if (nums.length >= 4 && nums.length % 2 === 0) {
    const points: RoutePoint[] = []
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const point = parseLngLatPair([nums[i], nums[i + 1]])
      if (point) points.push(point)
    }
    if (points.length >= 2) return points
  }
  return []
}

function pointsFromUnknownPath(value: unknown): RoutePoint[] {
  if (typeof value === 'string') return decodePathString(value)
  if (!Array.isArray(value) || value.length < 2) return []
  if (!Array.isArray(value[0]) && typeof value[0] !== 'object') {
    const nums = value.map(Number)
    if (nums.length >= 4 && nums.every((item) => Number.isFinite(item))) {
      const points: RoutePoint[] = []
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const point = parseLngLatPair([nums[i], nums[i + 1]])
        if (point) points.push(point)
      }
      if (points.length >= 2) return points
    }
  }
  return value.map(parseLngLatPair).filter((item): item is RoutePoint => Boolean(item))
}

function collectCoordArrays(value: unknown, acc: RoutePoint[][] = [], depth = 0): RoutePoint[][] {
  if (value == null || depth > 8) return acc
  if (typeof value === 'string') {
    const points = decodePathString(value)
    if (points.length >= 2) acc.push(points)
    return acc
  }
  if (Array.isArray(value)) {
    const points = pointsFromUnknownPath(value)
    if (points.length >= 2) acc.push(points)
    if (value.length && (Array.isArray(value[0]) || typeof value[0] === 'object')) {
      for (const item of value) collectCoordArrays(item, acc, depth + 1)
    }
    return acc
  }
  if (typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectCoordArrays(child, acc, depth + 1)
    }
  }
  return acc
}

function longestRoadPath(payload: unknown): RoutePoint[] {
  const candidates = collectCoordArrays(payload)
  if (!candidates.length) return []
  candidates.sort((a, b) => b.length - a.length)
  const best = candidates[0]
  return best.length >= 2 ? best : []
}

function parseNaverDrivingPath(payload: unknown): RoutePoint[] {
  const best = longestRoadPath(payload)
  if (best.length >= 3) return best
  if (!payload || typeof payload !== 'object') return best
  const root = payload as { route?: Record<string, unknown>; result?: { route?: Record<string, unknown> } }
  const route = root.route || root.result?.route
  if (!route) return best
  let picked: RoutePoint[] = best
  for (const value of Object.values(route)) {
    const legs = Array.isArray(value) ? value : value ? [value] : []
    for (const leg of legs) {
      if (!leg || typeof leg !== 'object') continue
      const row = leg as { path?: unknown; points?: unknown; vertexes?: unknown; coords?: unknown }
      for (const raw of [row.path, row.points, row.vertexes, row.coords]) {
        const points = pointsFromUnknownPath(raw)
        if (points.length > picked.length) picked = points
      }
    }
  }
  return picked.length >= 2 ? picked : []
}

async function drivingPathNaver(origin: RoutePoint, dest: RoutePoint): Promise<RoutePoint[]> {
  const { keyId, headers } = naverGatewayHeaders()
  if (!keyId) return []
  const start = `${origin.lng},${origin.lat}`
  const goal = `${dest.lng},${dest.lat}`
  const options = ['traoptimal', 'trafast', 'tracomfort']
  const hosts = [
    'https://maps.apigw.ntruss.com/map-direction/v1/driving',
    'https://maps.apigw.ntruss.com/map-direction-15/v1/driving',
    'https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving',
    'https://naveropenapi.apigw.ntruss.com/map-direction-15/v1/driving',
  ]
  for (const option of options) {
    const query = `start=${encodeURIComponent(start)}&goal=${encodeURIComponent(goal)}&option=${option}`
    for (const host of hosts) {
      try {
        const response = await fetch(`${host}?${query}`, {
          headers,
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        })
        if (!response.ok) continue
        const points = parseNaverDrivingPath(await response.json())
        if (points.length >= 3) return points
      } catch {
        continue
      }
    }
  }
  return []
}

async function drivingPathOsrm(origin: RoutePoint, dest: RoutePoint): Promise<RoutePoint[]> {
  try {
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson&steps=false`,
      {
        headers: { Accept: 'application/json', 'User-Agent': 'TaxiTago/1.0 (directions)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
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
    if (naver.length >= 3) return naver
    const osrm = await drivingPathOsrm(origin, dest)
    if (osrm.length >= 3) return osrm
    if (naver.length >= 2) return naver
    return osrm
  } catch {
    try {
      return await drivingPathOsrm(origin, dest)
    } catch {
      return []
    }
  }
}
