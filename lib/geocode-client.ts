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
