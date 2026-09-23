export const ADDRESS_LOADING = '새로운 주소를 불러오는 중...'

export function fallbackCoordAddress(lat: number, lng: number) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

export function createLiveAddressLookup(
  apply: (lat: number, lng: number, address: string) => void,
  intervalMs = 220,
) {
  let timer = 0
  let lastFire = 0
  let requestId = 0
  let wanted: { lat: number; lng: number } | null = null
  const fire = () => {
    if (!wanted) return
    window.clearTimeout(timer)
    const lat = wanted.lat
    const lng = wanted.lng
    const id = ++requestId
    const liveLat = Number(lat)
    const liveLng = Number(lng)
    lastFire = Date.now()
    void lookupAddressFromApi(liveLat, liveLng)
      .then((label) => {
        if (id !== requestId) return
        apply(liveLat, liveLng, label.trim() || fallbackCoordAddress(liveLat, liveLng))
      })
      .catch(() => {
        if (id !== requestId) return
        apply(liveLat, liveLng, fallbackCoordAddress(liveLat, liveLng))
      })
  }
  return {
    run(lat: number, lng: number) {
      const nextLat = Number(lat)
      const nextLng = Number(lng)
      if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return
      wanted = { lat: nextLat, lng: nextLng }
      const wait = lastFire ? Math.max(0, intervalMs - (Date.now() - lastFire)) : 0
      window.clearTimeout(timer)
      if (wait === 0) fire()
      else timer = window.setTimeout(fire, wait)
    },
    flush() {
      if (!wanted) return
      lastFire = 0
      fire()
    },
    stop() {
      requestId += 1
      window.clearTimeout(timer)
      wanted = null
      lastFire = 0
    },
  }
}

const jsonHeaders = { Accept: 'application/json' } as const

export async function lookupAddressFromApi(lat: number, lng: number, signal?: AbortSignal) {
  const liveLat = Number(lat)
  const liveLng = Number(lng)
  const fallback = fallbackCoordAddress(liveLat, liveLng)
  if (!Number.isFinite(liveLat) || !Number.isFinite(liveLng) || Math.abs(liveLat) > 90 || Math.abs(liveLng) > 180) {
    return fallback
  }
  try {
    const response = await fetch(
      `/api/geocode/?lat=${encodeURIComponent(String(liveLat))}&lng=${encodeURIComponent(String(liveLng))}`,
      { method: 'GET', cache: 'no-store', credentials: 'same-origin', signal, headers: jsonHeaders },
    )
    if (!response.ok) return fallback
    const data = (await response.json()) as { address?: unknown }
    const label = typeof data.address === 'string' ? data.address.trim() : ''
    return label || fallback
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
    return fallback
  }
}

export type SearchedPlace = { name: string; address: string; lat: number; lng: number }

export async function searchPlacesFromApi(query: string, signal?: AbortSignal) {
  const q = query.trim()
  if (!q) return [] as SearchedPlace[]
  try {
    const response = await fetch(`/api/geocode/?q=${encodeURIComponent(q)}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
      headers: jsonHeaders,
    })
    if (!response.ok) return []
    const data = (await response.json()) as {
      places?: Array<{ name?: unknown; address?: unknown; lat?: unknown; lng?: unknown }>
    }
    return (data.places || [])
      .map((item) => {
        const name = typeof item.name === 'string' ? item.name.trim() : q
        const address = typeof item.address === 'string' ? item.address.trim() : ''
        const lat = Number(item.lat)
        const lng = Number(item.lng)
        if (!address || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
        return { name: name || q, address, lat, lng }
      })
      .filter((item): item is SearchedPlace => Boolean(item))
  } catch {
    return [] as SearchedPlace[]
  }
}

export type DrivingPathPoint = { lat: number; lng: number }

function parseDrivingPathPayload(data: unknown): DrivingPathPoint[] {
  if (!data || typeof data !== 'object') return []
  const root = data as { path?: unknown; route?: unknown }
  const rows = Array.isArray(root.path) ? root.path : Array.isArray(root.route) ? root.route : []
  return rows
    .map((item) => {
      if (Array.isArray(item) && item.length >= 2) {
        const first = Number(item[0])
        const second = Number(item[1])
        if (!Number.isFinite(first) || !Number.isFinite(second)) return null
        if (Math.abs(second) <= 90 && Math.abs(first) <= 180) return { lat: second, lng: first }
        if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return { lat: first, lng: second }
        return null
      }
      if (!item || typeof item !== 'object') return null
      const point = item as { lat?: unknown; lng?: unknown }
      const lat = Number(point.lat)
      const lng = Number(point.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      return { lat, lng }
    })
    .filter((item): item is DrivingPathPoint => Boolean(item))
}

export async function fetchDrivingPath(
  origin: DrivingPathPoint,
  dest: DrivingPathPoint,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    startLat: String(origin.lat),
    startLng: String(origin.lng),
    destLat: String(dest.lat),
    destLng: String(dest.lng),
  })
  const query = params.toString()
  const urls = [`/api/directions/?${query}`, `/api/directions?${query}`]
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
        headers: jsonHeaders,
      })
      if (!response.ok) continue
      const points = parseDrivingPathPayload(await response.json())
      if (points.length >= 2) return points
    } catch (error) {
      if (signal?.aborted) throw error
    }
  }
  return [] as DrivingPathPoint[]
}
