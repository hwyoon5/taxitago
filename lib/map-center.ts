import type { NaverMapInstance, NaverMapsSdk } from '@/lib/naver-maps'

export type MapLatLng = { lat: number; lng: number }

export function readCoordNumber(value: unknown): number {
  if (typeof value === 'function') {
    try {
      return Number((value as () => number)())
    } catch {
      return Number.NaN
    }
  }
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim()) return Number(value)
  return Number.NaN
}

function isWgs84(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

export function readLatLngValue(value: unknown): MapLatLng | null {
  if (!value || typeof value !== 'object') return null
  const point = value as {
    lat?: unknown
    lng?: unknown
    y?: unknown
    x?: unknown
    _lat?: unknown
    _lng?: unknown
    latitude?: unknown
    longitude?: unknown
  }
  const pairs: Array<[unknown, unknown]> = [
    [point.lat, point.lng],
    [point._lat, point._lng],
    [point.latitude, point.longitude],
    [point.y, point.x],
  ]
  for (const [latRaw, lngRaw] of pairs) {
    const lat = readCoordNumber(latRaw)
    const lng = readCoordNumber(lngRaw)
    if (isWgs84(lat, lng)) return { lat, lng }
  }
  return null
}

export function readMapGetCenter(map: NaverMapInstance | null): MapLatLng | null {
  if (!map || typeof map.getCenter !== 'function') return null
  try {
    return readLatLngValue(map.getCenter())
  } catch {
    return null
  }
}

export function readVisualMapCenter(
  map: NaverMapInstance | null,
  sdk: NaverMapsSdk | null,
  canvas?: HTMLElement | null,
): MapLatLng | null {
  const fromGetter = readMapGetCenter(map)
  if (fromGetter) return fromGetter
  if (!map || !sdk || !canvas || typeof sdk.Point !== 'function') return null
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  if (width < 1 || height < 1) return null
  try {
    return readLatLngValue(map.getProjection?.()?.fromOffsetToCoord?.(new sdk.Point(width / 2, height / 2)))
  } catch {
    return null
  }
}

export function sameMapPoint(a: MapLatLng | null | undefined, b: MapLatLng | null | undefined, digits = 6) {
  if (!a || !b) return false
  return a.lat.toFixed(digits) === b.lat.toFixed(digits) && a.lng.toFixed(digits) === b.lng.toFixed(digits)
}

export function applyMapCenter(map: NaverMapInstance | null, sdk: NaverMapsSdk | null, point: MapLatLng): MapLatLng | null {
  if (!map || !sdk || typeof sdk.LatLng !== 'function') return readMapGetCenter(map)
  try {
    const latlng = new sdk.LatLng(point.lat, point.lng)
    map.setCenter(latlng)
  } catch {
    try {
      map.panTo(new sdk.LatLng(point.lat, point.lng))
    } catch {
      undefined
    }
  }
  return readMapGetCenter(map) || point
}

export function panMapByPixels(
  map: NaverMapInstance | null,
  sdk: NaverMapsSdk | null,
  canvas: HTMLElement | null,
  dx: number,
  dy: number,
): MapLatLng | null {
  const before = readMapGetCenter(map)
  if (!map || !sdk || (!dx && !dy)) return before || readVisualMapCenter(map, sdk, canvas)
  const width = canvas?.clientWidth ?? 0
  const height = canvas?.clientHeight ?? 0
  let computed: MapLatLng | null = null
  try {
    const projection = map.getProjection?.()
    if (projection?.fromOffsetToCoord && typeof sdk.Point === 'function' && width > 0 && height > 0) {
      computed = readLatLngValue(projection.fromOffsetToCoord(new sdk.Point(width / 2 - dx, height / 2 - dy)))
    }
  } catch {
    undefined
  }
  if (computed) {
    const afterSet = applyMapCenter(map, sdk, computed)
    const live = readMapGetCenter(map)
    if (live && !sameMapPoint(live, before)) return live
    return afterSet || computed
  }
  try {
    if (typeof map.panBy === 'function' && typeof sdk.Point === 'function') {
      map.panBy(new sdk.Point(-dx, -dy))
    }
  } catch {
    undefined
  }
  const afterPan = readMapGetCenter(map)
  if (afterPan && !sameMapPoint(afterPan, before)) return afterPan
  return afterPan || computed || readVisualMapCenter(map, sdk, canvas)
}
