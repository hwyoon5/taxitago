export type NaverLatLng = { lat: () => number; lng: () => number }

export type NaverMapInstance = {
  setCenter: (latlng: unknown) => void
  panTo: (latlng: unknown) => void
  panBy: (offset: unknown) => void
  setZoom: (zoom: number, useEffect?: boolean) => void
  getZoom: () => number
  getCenter?: () => unknown
  getProjection?: () => {
    fromOffsetToCoord?: (offset: unknown) => unknown
    fromCoordToOffset?: (coord: unknown) => { x: number; y: number } | null
  } | null
  fitBounds?: (bounds: unknown, margin?: unknown) => void
  autoResize?: () => void
  setSize?: (size: unknown) => void
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
  setOptions?: (options: Record<string, unknown>) => void
  setStyle?: (options: Record<string, unknown>) => void
}

export type NaverMapsSdk = {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => NaverMapInstance
  LatLng: new (lat: number, lng: number) => unknown
  LatLngBounds?: new (sw: unknown, ne: unknown) => unknown
  Point: new (x: number, y: number) => unknown
  Size?: new (width: number, height: number) => unknown
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
    clearListeners?: (target: unknown, eventName?: string) => void
    clearInstanceListeners?: (target: unknown) => void
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
  if (typeof window !== 'undefined') {
    const fromPage =
      normalizeClientId(window.__NAVER_MAP_CLIENT_ID__) ||
      normalizeClientId(document.querySelector('meta[name="naver-map-client-id"]')?.getAttribute('content'))
    if (fromPage) return fromPage
  }
  return resolveNaverMapClientId()
}

export function hasNaverMapClientId() {
  return Boolean(getNaverMapClientId())
}

let loadPromise: Promise<NaverMapsSdk | null> | null = null

function mapsReady(): NaverMapsSdk | null {
  return getNaverMaps()
}

export function getNaverMapsSdk(): NaverMapsSdk | null {
  return mapsReady()
}

export function getNaverMaps(): NaverMapsSdk | null {
  if (typeof window === 'undefined') return null
  const maps = window.naver?.maps
  if (!maps) return null
  if (typeof maps.Map !== 'function' || typeof maps.LatLng !== 'function') return null
  return maps
}

export function createNaverLatLng(maps: NaverMapsSdk | null | undefined, lat: number, lng: number) {
  const LatLng = maps?.LatLng ?? (typeof window === 'undefined' ? undefined : window.naver?.maps?.LatLng)
  if (typeof LatLng !== 'function') return null
  try {
    return new LatLng(lat, lng)
  } catch {
    return null
  }
}

function existingMapsScript() {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLScriptElement>(
    'script#naver-maps-sdk, script#naver-maps-sdk-loader, script[src*="/api/naver-maps/sdk"], script[src*="map.naver.com"][src*="maps.js"]',
  )
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
  return [`/api/naver-maps/sdk/?ncpKeyId=${encoded}`]
}

function injectScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const previous = document.getElementById('naver-maps-sdk-loader')
    previous?.remove()
    const script = document.createElement('script')
    script.id = 'naver-maps-sdk-loader'
    script.async = true
    script.src = src
    const timer = window.setTimeout(() => {
      script.onload = null
      script.onerror = null
      reject(new Error(`timeout:${src}`))
    }, 8000)
    script.onload = () => {
      window.clearTimeout(timer)
      resolve()
    }
    script.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error(`failed:${src}`))
    }
    document.head.appendChild(script)
  })
}

export function loadNaverMaps(): Promise<NaverMapsSdk | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  const already = mapsReady()
  if (already) return Promise.resolve(already)
  if (!hasNaverMapClientId()) return Promise.resolve(null)
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const alreadyReady = mapsReady()
    if (alreadyReady) return alreadyReady

    const existing = existingMapsScript()
    let ready = await waitUntilMapsReady(existing ? 8000 : 1200)
    if (ready) return ready

    const urls = scriptUrls(getNaverMapClientId())
    for (const url of urls) {
      try {
        await injectScript(url)
        ready = await waitUntilMapsReady(3500)
        if (ready) return ready
      } catch {
        continue
      }
    }

    ready = await waitUntilMapsReady(2500)
    if (!ready) loadPromise = null
    return ready
  })()

  return loadPromise
}

export function resetNaverMapLoad() {
  loadPromise = null
  if (typeof document === 'undefined') return
  document.getElementById('naver-maps-sdk-loader')?.remove()
}

export function refreshNaverMap(maps: NaverMapsSdk | null, map: NaverMapInstance | null, canvas?: HTMLElement | null) {
  if (!maps || !map) return
  if (canvas) {
    const width = Math.max(canvas.clientWidth, canvas.offsetWidth, Math.round(canvas.getBoundingClientRect().width))
    const height = Math.max(canvas.clientHeight, canvas.offsetHeight, Math.round(canvas.getBoundingClientRect().height))
    if (width >= 24 && height >= 24 && maps.Size && typeof map.setSize === 'function') {
      try {
        map.setSize(new maps.Size(width, height))
      } catch {
        undefined
      }
    }
  }
  maps.Event?.trigger?.(map, 'resize')
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
): NaverMarker | null {
  const LatLng = maps?.LatLng
  const Marker = maps?.Marker
  const Point = maps?.Point
  if (typeof LatLng !== 'function' || typeof Marker !== 'function' || typeof Point !== 'function') return null
  const position = createNaverLatLng(maps, lat, lng)
  if (!position) return null
  return new Marker({
    map,
    position,
    clickable: false,
    icon: {
      content: element,
      size: new Point(anchorX * 2, anchorY * 2),
      anchor: new Point(anchorX, anchorY),
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
      setMap: (next) => marker?.setMap(next),
      setPosition: (nextLat, nextLng) => {
        const position = createNaverLatLng(maps, nextLat, nextLng)
        if (position) marker?.setPosition(position)
      },
    }
  }
  if (typeof maps?.OverlayView !== 'function' || typeof maps?.LatLng !== 'function') return asMarkerPin()

  try {
    const Overlay = function Overlay(this: MapHtmlPin & { _position: unknown }) {
      maps.OverlayView.call(this as never)
      this.setPosition = (nextLat: number, nextLng: number) => {
        const position = createNaverLatLng(maps, nextLat, nextLng)
        if (!position) return
        this._position = position
        this.draw?.()
      }
      this._position = createNaverLatLng(maps, lat, lng)
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
  const center = createNaverLatLng(maps, lat, lng)
  if (center) map.setCenter(center)
  if (bottomInset > 0 && typeof maps?.Point === 'function') map.panBy(new maps.Point(0, Math.round(bottomInset / 2)))
}
