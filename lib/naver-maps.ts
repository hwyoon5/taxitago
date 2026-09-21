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
      options: { coords: unknown; orders?: string; coordType?: string },
      callback: (status: number | string, response: NaverReverseGeocodeResponse) => void,
    ) => void
    geocode?: (
      options: { query: string },
      callback: (status: number, response: { v2?: { addresses?: Array<{ x?: string; y?: string; roadAddress?: string; jibunAddress?: string }> } }) => void,
    ) => void
    Status: { OK: number | string; ERROR?: number | string }
    OrderType: { ADDR: string; ROAD_ADDR: string }
    CoordType?: { LATLNG?: string; TM128?: string }
  }
}

export type NaverReverseGeocodeResponse = {
  address?: { roadAddress?: string; jibunAddress?: string; address?: string }
  result?: {
    items?: Array<{ address?: string; roadAddress?: string; jibunAddress?: string }>
    address?: { roadAddress?: string; jibunAddress?: string }
  }
  v2?: {
    address?: { roadAddress?: string; jibunAddress?: string; jibunaddr?: string; roadaddr?: string }
    results?: Array<{
      name?: string
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
  return getNaverMaps()
}

export function getNaverMapsSdk(): NaverMapsSdk | null {
  return mapsReady()
}

export function getNaverMaps(): NaverMapsSdk | null {
  if (typeof window === 'undefined') return null
  const maps = window.naver?.maps
  return maps?.Map ? maps : null
}

export function getNaverGeocoderService() {
  const maps = getNaverMaps()
  const service = maps?.Service
  if (!maps || typeof service?.reverseGeocode !== 'function') return null
  return { maps, service }
}

function scriptHasGeocoder(src?: string | null) {
  return /(?:[?&]submodules=)[^&]*geocoder/i.test(src || '')
}

function existingMapsScript() {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLScriptElement>('script[src*="map.naver.com"][src*="maps.js"]')
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
    `${host}?ncpKeyId=${encoded}&ncpClientId=${encoded}&submodules=geocoder`,
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

export async function waitForNaverGeocoder(timeoutMs = 2500) {
  return ensureNaverGeocoder(timeoutMs)
}

export function hasNaverGeocoder(sdk?: NaverMapsSdk | null) {
  return typeof (sdk || mapsReady())?.Service?.reverseGeocode === 'function'
}

async function waitForGeocoder(timeoutMs: number) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const live = mapsReady()
    if (hasNaverGeocoder(live)) return live
    await new Promise((resolve) => window.setTimeout(resolve, 50))
  }
  const live = mapsReady()
  return hasNaverGeocoder(live) ? live : null
}

export async function ensureNaverGeocoder(timeoutMs = 4000) {
  const sdk = await loadNaverMaps()
  if (!sdk) return null
  const already = await waitForGeocoder(Math.min(1200, timeoutMs))
  if (already) return already
  const id = getNaverMapClientId()
  if (!id) return mapsReady()
  const existing = existingMapsScript()
  if (!scriptHasGeocoder(existing?.getAttribute('src'))) {
    const started = Date.now()
    for (const url of scriptUrls(id)) {
      if (Date.now() - started >= timeoutMs) break
      try {
        await injectScript(url)
      } catch {
        continue
      }
      const ready = await waitForGeocoder(Math.max(400, timeoutMs - (Date.now() - started)))
      if (ready) return ready
    }
  }
  return waitForGeocoder(Math.max(0, timeoutMs))
}

export function loadNaverMaps(): Promise<NaverMapsSdk | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  const already = mapsReady()
  if (already) return Promise.resolve(already)
  if (!hasNaverMapClientId()) return Promise.resolve(null)
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const existing = existingMapsScript()
    if (existing && !scriptHasGeocoder(existing.getAttribute('src'))) {
      const urls = scriptUrls(getNaverMapClientId())
      for (const url of urls) {
        try {
          await injectScript(url)
          break
        } catch {
          continue
        }
      }
    }
    if (!existingMapsScript()) {
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

function cleanAddress(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text && !/^(undefined|null)$/i.test(text) ? text : ''
}

export function parseNaverReverseAddress(response: unknown): string {
  if (!response || typeof response !== 'object') return ''
  const root = response as NaverReverseGeocodeResponse & Record<string, unknown>
  const v2 = (root.v2 || root) as NonNullable<NaverReverseGeocodeResponse['v2']> & Record<string, unknown>
  const address = (v2.address || root.address || root.result?.address) as
    | { roadAddress?: string; jibunAddress?: string; address?: string; roadaddr?: string; jibunaddr?: string }
    | undefined
  const road = cleanAddress(address?.roadAddress) || cleanAddress(address?.roadaddr)
  const jibun = cleanAddress(address?.jibunAddress) || cleanAddress(address?.jibunaddr) || cleanAddress(address?.address)
  if (road) return road
  if (jibun) return jibun
  const item = root.result?.items?.[0]
  const itemAddress = cleanAddress(item?.roadAddress) || cleanAddress(item?.jibunAddress) || cleanAddress(item?.address)
  if (itemAddress) return itemAddress
  const result = v2.results?.[0]
  if (!result) return ''
  const parts = [
    result.region?.area1?.name,
    result.region?.area2?.name,
    result.region?.area3?.name,
    result.region?.area4?.name,
    result.land?.name,
    result.land?.number1,
    result.land?.addition0?.value,
  ].filter(Boolean)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

export function callNaverReverseGeocode(
  lat: number,
  lng: number,
  timeoutMs = 4000,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(null), timeoutMs)
    try {
      const maps = window.naver?.maps
      const service = maps?.Service
      if (!maps || typeof service?.reverseGeocode !== 'function' || typeof maps.LatLng !== 'function') {
        finish(null)
        return
      }
      const coords = new maps.LatLng(lat, lng)
      const orders = [service.OrderType?.ROAD_ADDR, service.OrderType?.ADDR].filter(Boolean).join(',') || 'roadaddr,addr'
      const handle = (status: unknown, response: NaverReverseGeocodeResponse) => {
        try {
          const payload =
            response && typeof response === 'object'
              ? response
              : ((status as NaverReverseGeocodeResponse) || response)
          const formatted = parseNaverReverseAddress(payload)
          if (formatted) {
            finish(formatted)
            return
          }
          finish(null)
        } catch {
          finish(null)
        }
      }
      const options: { coords: unknown; orders: string; coordType?: string } = { coords, orders }
      if (service.CoordType?.LATLNG) options.coordType = service.CoordType.LATLNG
      try {
        service.reverseGeocode(options, handle)
      } catch {
        service.reverseGeocode({ coords }, handle)
      }
    } catch {
      finish(null)
    }
  })
}
