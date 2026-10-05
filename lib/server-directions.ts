import { naverGatewayHeaders } from '@/lib/naver-apigw'

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

export type DrivingRouteSummary = { path: RoutePoint[]; durationMin: number | null }

const EMPTY_ROUTE: DrivingRouteSummary = { path: [], durationMin: null }

// Naver Directions 응답의 route.<option>[0].summary.duration(ms)에서 예상 소요 시간을 읽는다.
function parseNaverDurationMin(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as { route?: Record<string, unknown>; result?: { route?: Record<string, unknown> } }
  const route = root.route || root.result?.route
  if (!route) return null
  for (const value of Object.values(route)) {
    const legs = Array.isArray(value) ? value : value ? [value] : []
    for (const leg of legs) {
      const ms = Number((leg as { summary?: { duration?: unknown } })?.summary?.duration)
      if (Number.isFinite(ms) && ms > 0) return ms / 60000
    }
  }
  return null
}

async function drivingRouteNaver(origin: RoutePoint, dest: RoutePoint, via: RoutePoint[] = []): Promise<DrivingRouteSummary> {
  const { keyId, headers } = naverGatewayHeaders()
  if (!keyId || !headers) return EMPTY_ROUTE
  const start = `${origin.lng},${origin.lat}`
  const goal = `${dest.lng},${dest.lat}`
  // Naver Directions: waypoints는 "lng,lat|lng,lat" 형식 (direction-15는 최대 5개).
  const waypointsQuery = via.length
    ? `&waypoints=${encodeURIComponent(via.map((point) => `${point.lng},${point.lat}`).join('|'))}`
    : ''
  const options = ['traoptimal', 'trafast', 'tracomfort']
  const hosts = [
    'https://maps.apigw.ntruss.com/map-direction/v1/driving',
    'https://maps.apigw.ntruss.com/map-direction-15/v1/driving',
    'https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving',
    'https://naveropenapi.apigw.ntruss.com/map-direction-15/v1/driving',
  ]
  for (const option of options) {
    const query = `start=${encodeURIComponent(start)}&goal=${encodeURIComponent(goal)}${waypointsQuery}&option=${option}`
    for (const host of hosts) {
      try {
        const response = await fetch(`${host}?${query}`, {
          headers,
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        })
        if (!response.ok) continue
        const payload = await response.json()
        const points = parseNaverDrivingPath(payload)
        if (points.length >= 3) return { path: points, durationMin: parseNaverDurationMin(payload) }
      } catch {
        continue
      }
    }
  }
  return EMPTY_ROUTE
}

async function drivingRouteOsrm(origin: RoutePoint, dest: RoutePoint, via: RoutePoint[] = []): Promise<DrivingRouteSummary> {
  try {
    const chain = [origin, ...via, dest].map((point) => `${point.lng},${point.lat}`).join(';')
    const response = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${chain}?overview=full&geometries=geojson&steps=false`,
      {
        headers: { Accept: 'application/json', 'User-Agent': 'TaxiTago/1.0 (directions)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      },
    )
    if (!response.ok) return EMPTY_ROUTE
    const payload = (await response.json()) as { routes?: Array<{ geometry?: { coordinates?: unknown[] }; duration?: unknown }> }
    const coords = payload.routes?.[0]?.geometry?.coordinates
    if (!Array.isArray(coords)) return EMPTY_ROUTE
    const path = coords.map(parseLngLatPair).filter((item): item is RoutePoint => Boolean(item))
    const seconds = Number(payload.routes?.[0]?.duration)
    return { path, durationMin: Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : null }
  } catch {
    return EMPTY_ROUTE
  }
}

function validRoutePoint(point: RoutePoint) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180
}

// 반환 경로가 각 경유지 근처(약 200m)를 실제로 지나는지 확인한다.
// 일부 제공자는 잘못된 waypoints 파라미터를 무시하고 직행 경로만 돌려준다.
function pathCoversWaypoints(path: RoutePoint[], via: RoutePoint[]) {
  return via.every((point) =>
    path.some((node) => Math.abs(node.lat - point.lat) < 0.002 && Math.abs(node.lng - point.lng) < 0.002),
  )
}

// 경유지 포함 단일 경로 요청이 실패하면 구간별 경로를 이어 붙인다. 소요 시간은 구간별 합계.
async function drivingRouteLegsOnServer(chain: RoutePoint[]): Promise<DrivingRouteSummary> {
  const stitched: RoutePoint[] = []
  let durationMin = 0
  let hasDuration = false
  for (let index = 1; index < chain.length; index += 1) {
    const leg = await drivingRouteSummaryOnServer(chain[index - 1], chain[index])
    if (leg.path.length < 2) return EMPTY_ROUTE
    const first = stitched[stitched.length - 1]
    const join = leg.path[0]
    stitched.push(...(first && Math.abs(first.lat - join.lat) < 1e-6 && Math.abs(first.lng - join.lng) < 1e-6 ? leg.path.slice(1) : leg.path))
    if (leg.durationMin != null) {
      durationMin += leg.durationMin
      hasDuration = true
    }
  }
  return { path: stitched, durationMin: hasDuration ? durationMin : null }
}

export async function drivingRouteSummaryOnServer(
  origin: RoutePoint,
  dest: RoutePoint,
  waypoints: RoutePoint[] = [],
): Promise<DrivingRouteSummary> {
  if (!validRoutePoint(origin) || !validRoutePoint(dest)) return EMPTY_ROUTE
  const via = waypoints.filter(validRoutePoint).slice(0, 5)
  try {
    const naver = await drivingRouteNaver(origin, dest, via)
    if (naver.path.length >= 3 && pathCoversWaypoints(naver.path, via)) return naver
    const osrm = await drivingRouteOsrm(origin, dest, via)
    if (osrm.path.length >= 3 && pathCoversWaypoints(osrm.path, via)) return osrm
    if (!via.length) return naver.path.length >= 2 ? naver : osrm
    // 경유지가 있는데 2점 직선 결과만 나오면 경유지를 무시한 경로이므로 구간 결합을 시도한다.
    return await drivingRouteLegsOnServer([origin, ...via, dest])
  } catch {
    try {
      const osrm = await drivingRouteOsrm(origin, dest, via)
      if (osrm.path.length >= 2) return osrm
    } catch {
      return EMPTY_ROUTE
    }
    return via.length ? drivingRouteLegsOnServer([origin, ...via, dest]) : EMPTY_ROUTE
  }
}

export async function drivingPathOnServer(origin: RoutePoint, dest: RoutePoint, waypoints: RoutePoint[] = []) {
  return (await drivingRouteSummaryOnServer(origin, dest, waypoints)).path
}
