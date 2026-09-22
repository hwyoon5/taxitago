export function fallbackCoordAddress(lat: number, lng: number) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

export async function lookupAddressFromApi(lat: number, lng: number, signal?: AbortSignal) {
  const fallback = fallbackCoordAddress(lat, lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fallback
  const response = await fetch(
    `/api/geocode?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}`,
    {
      method: 'GET',
      cache: 'no-store',
      signal,
      headers: { Accept: 'application/json' },
    },
  )
  if (!response.ok) return fallback
  const data = (await response.json()) as { address?: unknown }
  const label = typeof data.address === 'string' ? data.address.trim() : ''
  return label || fallback
}

export type SearchedPlace = { name: string; address: string; lat: number; lng: number }

export async function searchPlacesFromApi(query: string, signal?: AbortSignal) {
  const q = query.trim()
  if (!q) return [] as SearchedPlace[]
  const response = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, {
    method: 'GET',
    cache: 'no-store',
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) return []
  const data = (await response.json()) as { places?: Array<{ name?: unknown; address?: unknown; lat?: unknown; lng?: unknown }> }
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
  const originBase = typeof window === 'undefined' ? '' : window.location.origin
  const urls = [`${originBase}/api/directions/?${query}`, `${originBase}/api/directions?${query}`]
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal,
        headers: { Accept: 'application/json' },
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
