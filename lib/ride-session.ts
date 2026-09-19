export type StoredPoint = { lat: number; lng: number; address?: string; label?: string }

export type RideSession = {
  origin: StoredPoint
  dest: StoredPoint | null
  updatedAt: number
}

const RIDE_SESSION_KEY = 'taxitago-ride-session'
const PICKUP_KEY = 'taxitago-pickup-place'

let memorySession: RideSession | null = null

export function isUsableCoord(lat: unknown, lng: unknown): lat is number {
  const nextLat = Number(lat)
  const nextLng = Number(lng)
  return Number.isFinite(nextLat) && Number.isFinite(nextLng) && Math.abs(nextLat) <= 90 && Math.abs(nextLng) <= 180 && !(Math.abs(nextLat) < 1e-6 && Math.abs(nextLng) < 1e-6)
}

export function asStoredPoint(lat: unknown, lng: unknown, extra?: { address?: string; label?: string }): StoredPoint | null {
  if (!isUsableCoord(lat, lng)) return null
  return { lat: Number(lat), lng: Number(lng), address: extra?.address, label: extra?.label }
}

function parsePoint(value: unknown): StoredPoint | null {
  if (!value || typeof value !== 'object') return null
  const point = value as { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }
  const parsed = asStoredPoint(point.lat, point.lng, {
    address: typeof point.address === 'string' ? point.address : undefined,
    label: typeof point.label === 'string' ? point.label : undefined,
  })
  return parsed
}

function readJson(key: string): unknown {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function readStoredPickup(): StoredPoint | null {
  const parsed = parsePoint(readJson(PICKUP_KEY))
  if (parsed) return parsed
  return parsePoint(memorySession?.origin)
}

export function readRideSession(): RideSession | null {
  if (memorySession?.origin && isUsableCoord(memorySession.origin.lat, memorySession.origin.lng)) return memorySession
  const parsed = readJson(RIDE_SESSION_KEY) as Partial<RideSession> | null
  const origin = parsePoint(parsed?.origin)
  if (!origin) return null
  const session: RideSession = {
    origin,
    dest: parsePoint(parsed?.dest),
    updatedAt: typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
  }
  memorySession = session
  return session
}

export function writeRideSession(next: { origin?: StoredPoint | null; dest?: StoredPoint | null }) {
  const current = readRideSession()
  const origin = next.origin ?? current?.origin
  if (!origin || !isUsableCoord(origin.lat, origin.lng)) return
  const dest = next.dest === undefined ? current?.dest ?? null : next.dest
  const session: RideSession = { origin, dest, updatedAt: Date.now() }
  memorySession = session
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RIDE_SESSION_KEY, JSON.stringify(session))
  } catch {
    undefined
  }
}

export function resolveLiveRidePoints(input: {
  originLat?: number
  originLng?: number
  destLat?: number
  destLng?: number
  originAddress?: string
  destAddress?: string
  destLabel?: string
}) {
  const session = readRideSession()
  const pickup = readStoredPickup()
  const origin =
    asStoredPoint(input.originLat, input.originLng, { address: input.originAddress }) ||
    session?.origin ||
    pickup
  const dest =
    asStoredPoint(input.destLat, input.destLng, { address: input.destAddress, label: input.destLabel }) ||
    session?.dest ||
    null
  return { origin, dest }
}
