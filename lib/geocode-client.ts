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
