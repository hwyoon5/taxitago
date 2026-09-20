export const NAVER_MAPS_SCRIPT_HOSTS = [
  'https://oapi.map.naver.com/openapi/v3/maps.js',
  'https://openapi.map.naver.com/openapi/v3/maps.js',
] as const

export type NaverLatLng = { lat: () => number; lng: () => number }

export type NaverMapInstance = {
  setCenter: (latlng: unknown) => void
  panTo: (latlng: unknown) => void
  panBy: (offset: unknown) => void
  setZoom: (zoom: number, useEffect?: boolean) => void
  getZoom: () => number
  getCenter?: () => unknown
  getProjection?: () => { fromOffsetToCoord?: (offset: unknown) => unknown } | null
  fitBounds?: (bounds: unknown, margin?: unknown) => void
  autoResize?: () => void
  destroy?: () => void
}

export type NaverMarker = {
  setMap: (map: NaverMapInstance | null) => void
  setPosition: (position: unknown) => void
  setIcon: (icon: unknown) => void
}

export type NaverPolyline = {
  setMap: (map: NaverMapInstance | null) => void
  setPath: (path: unknown[]) => void
}

export type NaverMapsSdk = {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => NaverMapInstance
  LatLng: new (lat: number, lng: number) => unknown
  LatLngBounds?: new (sw: unknown, ne: unknown) => unknown
  Point: new (x: number, y: number) => unknown
  Marker: new (options: Record<string, unknown>) => NaverMarker
  Polyline: new (options: Record<string, unknown>) => NaverPolyline
  OverlayView: new () => {
    setMap: (map: NaverMapInstance | null) => void
    getMap: () => NaverMapInstance | null
    getPanes: () => { overlayLayer: HTMLElement; overlayMouseTarget: HTMLElement }
    getProjection: () => { fromCoordToOffset: (coord: unknown) => { x: number; y: number } } | null
    draw: () => void
  }
  Event: {
    addListener: (target: unknown, eventName: string, handler: (event?: { coord?: NaverLatLng }) => void) => unknown
    removeListener: (listener: unknown) => void
    trigger: (target: unknown, eventName: string, ...rest: unknown[]) => void
  }
  Service?: {
    reverseGeocode: (
      options: { coords: unknown; orders?: string },
      callback: (status: number, response: NaverReverseGeocodeResponse) => void,
    ) => void
    geocode?: (
      options: { query: string },
      callback: (status: number, response: { v2?: { addresses?: Array<{ x?: string; y?: string; roadAddress?: string; jibunAddress?: string }> } }) => void,
    ) => void
    Status: { OK: number; ERROR?: number }
    OrderType: { ADDR: string; ROAD_ADDR: string }
  }
}

export type NaverReverseGeocodeResponse = {
  v2?: {
    address?: { roadAddress?: string; jibunAddress?: string }
    results?: Array<{
      region?: { area1?: { name?: string }; area2?: { name?: string }; area3?: { name?: string }; area4?: { name?: string } }
      land?: { name?: string; number1?: string; addition0?: { value?: string } }
    }>
  }
}

declare global {
  interface Window {
    naver?: { maps?: NaverMapsSdk }
    __naverMapsReady?: () => void
    __NAVER_MAP_CLIENT_ID__?: string
  }
}

const PLACEHOLDER_IDS = new Set(['', 'YOUR_CLIENT_ID', 'your_client_id', 'undefined', 'null'])

function normalizeClientId(value?: string | null) {
  const id = (value || '').trim()
  if (!id || PLACEHOLDER_IDS.has(id)) return ''
  return id
}

const DEFAULT_NAVER_MAP_CLIENT_ID = 'svhbb5mbpy'

export function resolveNaverMapClientId() {
  return (
    normalizeClientId(
      process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID ||
        process.env.NEXT_PUBLIC_NAVER_MAP_NCP_KEY_ID ||
        process.env.NAVER_MAP_CLIENT_ID ||
        process.env.NAVER_CLIENT_ID ||
        process.env.NCP_KEY_ID ||
        process.env.NAVER_MAP_NCP_KEY_ID ||
        '',
    ) || DEFAULT_NAVER_MAP_CLIENT_ID
  )
}

export function getNaverMapClientId() {
  const bundled = resolveNaverMapClientId()
  if (bundled) return bundled
  if (typeof window === 'undefined') return ''
  return (
    normalizeClientId(window.__NAVER_MAP_CLIENT_ID__) ||
    normalizeClientId(document.querySelector('meta[name="naver-map-client-id"]')?.getAttribute('content'))
  )
}

export function hasNaverMapClientId() {
  return Boolean(getNaverMapClientId())
}

let loadPromise: Promise<NaverMapsSdk | null> | null = null

function mapsReady(): NaverMapsSdk | null {
  const maps = typeof window === 'undefined' ? undefined : window.naver?.maps
  return maps?.Map ? maps : null
}

function waitUntilMapsReady(timeoutMs = 8000) {
  return new Promise<NaverMapsSdk | null>((resolve) => {
    const started = Date.now()
    const tick = () => {
      const ready = mapsReady()
      if (ready) {
        resolve(ready)
        return
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(null)
        return
      }
      window.setTimeout(tick, 60)
    }
    tick()
  })
}

function scriptUrls(id: string) {
  const encoded = encodeURIComponent(id)
  return NAVER_MAPS_SCRIPT_HOSTS.flatMap((host) => [
    `${host}?ncpKeyId=${encoded}&submodules=geocoder`,
    `${host}?ncpClientId=${encoded}&submodules=geocoder`,
  ])
}

function injectScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const previous = document.getElementById('naver-maps-sdk-loader')
    previous?.remove()
    const script = document.createElement('script')
    script.id = 'naver-maps-sdk-loader'
    script.async = true
    window.__naverMapsReady = () => resolve()
    script.src = `${src}${src.includes('?') ? '&' : '?'}callback=__naverMapsReady`
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`failed:${src}`))
    document.head.appendChild(script)
  })
}

export async function waitForNaverGeocoder(timeoutMs = 5000) {
  const sdk = await loadNaverMaps()
  if (!sdk) return null
  const started = Date.now()
  while (!sdk.Service?.reverseGeocode && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => window.setTimeout(resolve, 40))
  }
  return sdk.Service?.reverseGeocode ? sdk : null
}

export function loadNaverMaps(): Promise<NaverMapsSdk | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  const already = mapsReady()
  if (already) return Promise.resolve(already)
  if (!hasNaverMapClientId()) return Promise.resolve(null)
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const existing = document.querySelector('script[src*="map.naver.com"]')
    if (!existing) {
      const urls = scriptUrls(getNaverMapClientId())
      for (const url of urls) {
        try {
          await injectScript(url)
          const ready = await waitUntilMapsReady(2500)
          if (ready) return ready
        } catch {
          continue
        }
      }
    }
    const ready = await waitUntilMapsReady(8000)
    if (!ready) loadPromise = null
    return ready
  })()

  return loadPromise
}

export function refreshNaverMap(maps: NaverMapsSdk | null, map: NaverMapInstance | null) {
  if (!maps || !map) return
  maps.Event.trigger(map, 'resize')
  map.autoResize?.()
}

export function waitForMapSize(el: HTMLElement) {
  return new Promise<void>((resolve) => {
    const ready = () => el.clientWidth >= 24 && el.clientHeight >= 24
    if (ready()) {
      resolve()
      return
    }
    const observer = new ResizeObserver(() => {
      if (!ready()) return
      observer.disconnect()
      resolve()
    })
    observer.observe(el)
    window.setTimeout(() => {
      observer.disconnect()
      resolve()
    }, 2000)
  })
}

export function naverTilesLoaded(canvas: HTMLElement) {
  return Boolean(
    canvas.querySelector('img, canvas, .nmap') ||
      canvas.querySelector('[class*="nmap"]') ||
      canvas.childElementCount > 0,
  )
}

export function createDomMarker(
  maps: NaverMapsSdk,
  map: NaverMapInstance,
  element: HTMLElement,
  lat: number,
  lng: number,
  anchorX: number,
  anchorY: number,
): NaverMarker {
  return new maps.Marker({
    map,
    position: new maps.LatLng(lat, lng),
    clickable: false,
    icon: {
      content: element,
      size: new maps.Point(anchorX * 2, anchorY * 2),
      anchor: new maps.Point(anchorX, anchorY),
    },
  })
}

export type MapHtmlPin = {
  setMap: (map: NaverMapInstance | null) => void
  setPosition: (lat: number, lng: number) => void
  draw?: () => void
}

function overlayScale(el: HTMLElement) {
  let scale = 1
  let node: HTMLElement | null = el.parentElement
  while (node && node !== document.body) {
    const transform = getComputedStyle(node).transform
    if (transform && transform !== 'none') {
      try {
        scale *= Math.abs(new DOMMatrixReadOnly(transform).a) || 1
      } catch {
        const part = transform.match(/matrix\(([^,]+)/)
        if (part) scale *= Math.abs(Number(part[1])) || 1
      }
    }
    node = node.parentElement
  }
  return scale || 1
}

export function createHtmlOverlay(
  maps: NaverMapsSdk,
  map: NaverMapInstance,
  element: HTMLElement,
  lat: number,
  lng: number,
  transform = 'translate(-50%, -50%)',
  onPixel?: (x: number, y: number) => void,
): MapHtmlPin {
  const asMarkerPin = (): MapHtmlPin => {
    const marker = createDomMarker(maps, map, element, lat, lng, 12, 12)
    return {
      setMap: (next) => marker.setMap(next),
      setPosition: (nextLat, nextLng) => marker.setPosition(new maps.LatLng(nextLat, nextLng)),
    }
  }
  if (typeof maps.OverlayView !== 'function') return asMarkerPin()

  try {
    const Overlay = function Overlay(this: MapHtmlPin & { _position: unknown }) {
      maps.OverlayView.call(this as never)
      this.setPosition = (nextLat: number, nextLng: number) => {
        this._position = new maps.LatLng(nextLat, nextLng)
        this.draw?.()
      }
      this._position = new maps.LatLng(lat, lng)
    } as unknown as {
      new (): MapHtmlPin & {
        _position: unknown
        getPanes: () => { overlayLayer: HTMLElement; floatPane?: HTMLElement }
        getProjection: () => { fromCoordToOffset: (coord: unknown) => { x: number; y: number } } | null
      }
    }

    Overlay.prototype = new maps.OverlayView()
    Overlay.prototype.constructor = Overlay
    Overlay.prototype.onAdd = function onAdd(this: { getPanes: () => { overlayLayer: HTMLElement; floatPane?: HTMLElement } }) {
      const panes = this.getPanes()
      ;(panes.floatPane || panes.overlayLayer).appendChild(element)
    }
    Overlay.prototype.draw = function draw(this: { getProjection: () => { fromCoordToOffset: (coord: unknown) => { x: number; y: number } } | null; _position: unknown }) {
      const projection = this.getProjection()
      if (!projection || !this._position) return
      const pixel = projection.fromCoordToOffset(this._position)
      const scale = overlayScale(element)
      element.style.position = 'absolute'
      element.style.left = `${pixel.x}px`
      element.style.top = `${pixel.y}px`
      element.style.transform = `${transform} scale(${1 / scale})`
      element.style.transformOrigin = 'center center'
      element.style.zIndex = '20'
      element.style.zoom = '1'
      onPixel?.(pixel.x, pixel.y)
    }
    Overlay.prototype.onRemove = function onRemove() {
      element.remove()
    }

    const overlay = new Overlay()
    overlay.setMap(map)
    overlay.draw?.()
    return overlay
  } catch {
    return asMarkerPin()
  }
}

export function trackMapPoint(
  maps: NaverMapsSdk,
  map: NaverMapInstance,
  lat: number,
  lng: number,
  onPixel: (x: number, y: number) => void,
): MapHtmlPin {
  const element = document.createElement('div')
  element.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;overflow:visible'
  return createHtmlOverlay(maps, map, element, lat, lng, 'translate(0, 0)', onPixel)
}

export function applyMapBottomInset(maps: NaverMapsSdk, map: NaverMapInstance, lat: number, lng: number, bottomInset: number) {
  map.setCenter(new maps.LatLng(lat, lng))
  if (bottomInset > 0) map.panBy(new maps.Point(0, Math.round(bottomInset / 2)))
}
