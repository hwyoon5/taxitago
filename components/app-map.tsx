'use client'

import { useEffect, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from 'react'
import { Car, LocateFixed, MapPin, Minus, Plus, UserRound } from 'lucide-react'
import {
  applyMapBottomInset,
  createDomMarker,
  createHtmlOverlay,
  hasNaverMapClientId,
  getNaverMapClientId,
  loadNaverMaps,
  createNaverLatLng,
  getNaverMaps,
  refreshNaverMap,
  trackMapPoint,
  waitForMapSize,
  type MapHtmlPin,
  type NaverMapInstance,
  type NaverMapsSdk,
  type NaverMarker,
  type NaverPolyline,
} from '@/lib/naver-maps'

import { resolveLiveRidePoints, isUsableCoord } from '@/lib/ride-session'
import { ADDRESS_LOADING, createLiveAddressLookup, fetchDrivingPath, lookupAddressFromApi } from '@/lib/geocode-client'
import { watchMapSettle, createSettleDebounce } from '@/lib/watch-map-settle'

const TILE_SIZE = 256

export type TaxiLivePhase = 'arriving' | 'boarding' | 'moving'
export type TaxiMatchPhase = 'searching' | TaxiLivePhase
export type RidePoint = { lat: number; lng: number }

function readCoordNumber(value: unknown): number {
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

function readLatLngValue(value: unknown): RidePoint | null {
  if (!value || typeof value !== 'object') return null
  const point = value as { lat?: unknown; lng?: unknown; y?: unknown; x?: unknown; _lat?: unknown; _lng?: unknown }
  const lat = readCoordNumber(point.lat ?? point.y ?? point._lat)
  const lng = readCoordNumber(point.lng ?? point.x ?? point._lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

function readMapCenter(map: NaverMapInstance | null, sdk?: NaverMapsSdk | null, canvas?: HTMLDivElement | null): RidePoint | null {
  if (!map) return null
  try {
    const fromGetter = readLatLngValue(invokeMapCenter(map))
    if (fromGetter) return fromGetter
  } catch {
    undefined
  }
  const fromProp = readLatLngValue((map as { center?: unknown }).center)
  if (fromProp) return fromProp
  if (sdk && canvas) {
    try {
      const projection = map.getProjection?.()
      const mapped = typeof sdk?.Point === 'function'
        ? projection?.fromOffsetToCoord?.(new sdk.Point(canvas.clientWidth / 2, canvas.clientHeight / 2))
        : null
      return readLatLngValue(mapped)
    } catch {
      return null
    }
  }
  return null
}

function invokeMapCenter(map: NaverMapInstance | null): unknown {
  if (!map) return undefined
  const getter = map.getCenter
  if (typeof getter !== 'function') return undefined
  try {
    return getter.call(map)
  } catch {
    return undefined
  }
}

function liveNaverMaps(sdk?: NaverMapsSdk | null): NaverMapsSdk | null {
  if (sdk && typeof sdk.Map === 'function' && typeof sdk.LatLng === 'function') return sdk
  const bundled = getNaverMaps()
  if (bundled) return bundled
  if (typeof window === 'undefined') return null
  const maps = window.naver?.maps
  if (maps && typeof maps.Map === 'function' && typeof maps.LatLng === 'function') return maps
  return null
}

async function waitForNaverSdk(timeoutMs = 10000): Promise<NaverMapsSdk | null> {
  if (typeof window === 'undefined' || !getNaverMapClientId()) return null
  const loaded = liveNaverMaps(await loadNaverMaps())
  if (loaded) return loaded
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const ready = liveNaverMaps()
    if (ready) return ready
    await new Promise((resolve) => window.setTimeout(resolve, 80))
  }
  return liveNaverMaps()
}

const NAVER_MAP_INTERACTION = {
  scaleControl: false,
  mapDataControl: false,
  zoomControl: false,
  draggable: true,
  pinchZoom: true,
  scrollWheel: true,
  keyboardShortcuts: true,
  disableDoubleClickZoom: false,
  disableDoubleTapZoom: false,
  disableTwoFingerTapZoom: false,
} as const

function applyNaverMapInteraction(map: NaverMapInstance | null) {
  if (!map) return
  const options = { ...NAVER_MAP_INTERACTION }
  try {
    ;(map as { setOptions?: (next: Record<string, unknown>) => void }).setOptions?.(options)
  } catch {
    undefined
  }
}

function createNaverMapInstance(
  maps: NaverMapsSdk,
  canvas: HTMLElement,
  center: unknown,
  zoom: number,
) {
  const attempts: Record<string, unknown>[] = [
    { center, zoom, ...NAVER_MAP_INTERACTION },
    { center, zoom, draggable: true, pinchZoom: true, scrollWheel: true },
    { center, zoom },
  ]
  let lastError: unknown
  for (const options of attempts) {
    try {
      const map = new maps.Map(canvas, options)
      applyNaverMapInteraction(map)
      return map
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('naver-map-init-failed')
}

function naverLatLng(sdk: NaverMapsSdk | null | undefined, lat: number, lng: number) {
  return createNaverLatLng(liveNaverMaps(sdk), lat, lng)
}

function naverEventApi(sdk?: NaverMapsSdk | null) {
  return liveNaverMaps(sdk)?.Event ?? (typeof window === 'undefined' ? undefined : window.naver?.maps?.Event)
}

function addNaverMapListener(
  sdk: NaverMapsSdk | null | undefined,
  map: NaverMapInstance,
  eventName: string,
  handler: (event?: { coord?: unknown; latlng?: unknown }) => void,
): unknown {
  const addListener = naverEventApi(sdk)?.addListener
  if (typeof addListener !== 'function') return null
  try {
    return addListener(map, eventName, handler)
  } catch {
    return null
  }
}

function removeNaverMapListener(sdk: NaverMapsSdk | null | undefined, listener: unknown) {
  if (listener == null) return
  const removeListener = naverEventApi(sdk)?.removeListener
  if (typeof removeListener !== 'function') return
  try {
    removeListener(listener)
  } catch {
    undefined
  }
}

function detachNaverMap(
  sdk: NaverMapsSdk | null | undefined,
  map: NaverMapInstance | null,
  listeners: unknown[],
  canvas?: HTMLDivElement | null,
) {
  const eventApi = naverEventApi(sdk)
  if (map) {
    for (const eventName of ['idle', 'dragend', 'dragstart', 'drag', 'bounds_changed', 'center_changed', 'zoom_changed', 'tilesloaded', 'click', 'tap']) {
      try {
        eventApi?.clearListeners?.(map, eventName)
      } catch {
        undefined
      }
    }
    try {
      eventApi?.clearInstanceListeners?.(map)
    } catch {
      undefined
    }
  }
  listeners.forEach((listener) => removeNaverMapListener(sdk, listener))
  listeners.length = 0
  try {
    map?.destroy?.()
  } catch {
    undefined
  }
  if (canvas) {
    try {
      canvas.replaceChildren()
    } catch {
      canvas.innerHTML = ''
    }
  }
}

function readMapClickLatLng(event: unknown): RidePoint | null {
  if (!event || typeof event !== 'object') return null
  const payload = event as { latlng?: unknown; coord?: unknown }
  const raw = payload.latlng ?? payload.coord
  if (!raw || typeof raw !== 'object') return null
  const point = raw as { lat?: unknown; lng?: unknown; y?: unknown; x?: unknown }
  const lat = readCoordNumber(point.lat ?? point.y)
  const lng = readCoordNumber(point.lng ?? point.x)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

function snapToNearbyPoint(clicked: RidePoint, anchor: RidePoint, maxMeters: number) {
  const dLat = ((clicked.lat - anchor.lat) * Math.PI) / 180
  const dLng = ((clicked.lng - anchor.lng) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((anchor.lat * Math.PI) / 180) * Math.cos((clicked.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  const meters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return meters <= maxMeters ? anchor : clicked
}

function stopMapEvent(event: { stopPropagation: () => void; preventDefault?: () => void; nativeEvent?: { stopImmediatePropagation?: () => void } }) {
  event.stopPropagation()
  event.nativeEvent?.stopImmediatePropagation?.()
  event.preventDefault?.()
}

function PickupStartButton({ onConfirm }: { onConfirm: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef(onConfirm)
  const lockRef = useRef(0)
  confirmRef.current = onConfirm

  const fire = (event?: { stopPropagation: () => void; preventDefault?: () => void }) => {
    event?.stopPropagation()
    event?.preventDefault?.()
    const now = Date.now()
    if (now - lockRef.current < 450) return
    lockRef.current = now
    confirmRef.current()
  }

  useEffect(() => {
    const node = buttonRef.current
    if (!node) return
    const block = (event: Event) => {
      event.stopPropagation()
      event.preventDefault()
    }
    const nativeFire = (event: Event) => {
      event.stopPropagation()
      event.preventDefault()
      fire()
    }
    const blockTypes = ['pointerdown', 'mousedown', 'touchstart', 'dblclick', 'wheel'] as const
    const fireTypes = ['click', 'touchend'] as const
    blockTypes.forEach((type) => node.addEventListener(type, block, { capture: true, passive: false }))
    fireTypes.forEach((type) => node.addEventListener(type, nativeFire, { capture: true, passive: false }))
    return () => {
      blockTypes.forEach((type) => node.removeEventListener(type, block, true))
      fireTypes.forEach((type) => node.removeEventListener(type, nativeFire, true))
    }
  }, [])

  return (
    <button
      ref={buttonRef}
      type="button"
      className="tt-start-balloon pointer-events-auto"
      style={{ touchAction: 'manipulation' }}
      onClick={(event) => fire(event)}
      onTouchEnd={(event) => fire(event)}
    >
      출발
    </button>
  )
}

function CenteredMapPin({ pulse, lift, onConfirm }: { pulse: boolean; lift?: boolean; onConfirm?: () => void }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[50]"
      style={{ transform: 'none' }}
    >
      <div
        className="pointer-events-none absolute"
        style={{
          left: '50%',
          top: '50%',
          transform: pulse
            ? `translate(-50%, calc(-50% - ${lift ? 10 : 0}px))`
            : `translate(-50%, calc(-100% - ${lift ? 12 : 0}px))`,
          transition: 'transform 120ms ease-out',
        }}
      >
        {pulse ? (
          <StartPulsePin onConfirm={onConfirm} />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#4C1FB8] text-white shadow-md">
            <MapPin className="h-5 w-5" />
          </span>
        )}
      </div>
    </div>
  )
}

export function toTaxiLivePhase(phase: TaxiMatchPhase): TaxiLivePhase {
  if (phase === 'boarding' || phase === 'moving') return phase
  return 'arriving'
}

function lerpPoint(from: RidePoint, to: RidePoint, t: number): RidePoint {
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: from.lng + (to.lng - from.lng) * t,
  }
}

function headingAngle(from: RidePoint, to: RidePoint) {
  return (Math.atan2(-(to.lat - from.lat), to.lng - from.lng) * 180) / Math.PI
}

export function resolveRideDestination(origin: RidePoint, destLat?: number, destLng?: number): RidePoint | null {
  if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) return null
  return { lat: destLat as number, lng: destLng as number }
}

function vehicleOnRide(phase: TaxiLivePhase, origin: RidePoint, dest: RidePoint, t: number) {
  const progress = Math.min(1, Math.max(0, t))
  if (phase === 'boarding') return { ...origin, angle: headingAngle(origin, dest) }
  if (phase === 'arriving') {
    const start = lerpPoint(origin, dest, -0.18)
    const pos = lerpPoint(start, origin, progress)
    return { ...pos, angle: headingAngle(start, origin) }
  }
  const pos = lerpPoint(origin, dest, progress)
  return { ...pos, angle: headingAngle(origin, dest) }
}

function fitRideBounds(sdk: NaverMapsSdk, map: NaverMapInstance, origin: RidePoint, dest: RidePoint, path?: RidePoint[]) {
  const maps = liveNaverMaps(sdk)
  if (!maps) return
  const points = path && path.length >= 2 ? path : [origin, dest]
  const lats = points.map((point) => point.lat)
  const lngs = points.map((point) => point.lng)
  const sw = { lat: Math.min(...lats), lng: Math.min(...lngs) }
  const ne = { lat: Math.max(...lats), lng: Math.max(...lngs) }
  const mid = { lat: (sw.lat + ne.lat) / 2, lng: (sw.lng + ne.lng) / 2 }
  const span = Math.max(ne.lat - sw.lat, ne.lng - sw.lng)
  const midLatLng = naverLatLng(maps, mid.lat, mid.lng)
  if (span < 0.0008) {
    if (midLatLng) map.setCenter(midLatLng)
    map.setZoom(16)
    return
  }
  const swLatLng = naverLatLng(maps, sw.lat, sw.lng)
  const neLatLng = naverLatLng(maps, ne.lat, ne.lng)
  if (typeof maps.LatLngBounds === 'function' && map.fitBounds && swLatLng && neLatLng) {
    map.fitBounds(new maps.LatLngBounds(swLatLng, neLatLng), {
      top: 56,
      right: 48,
      bottom: 56,
      left: 48,
    })
    return
  }
  if (midLatLng) map.setCenter(midLatLng)
  map.setZoom(span > 0.08 ? 12 : span > 0.03 ? 13 : 15)
}

function forceRideCamera(sdk: NaverMapsSdk, map: NaverMapInstance, origin: RidePoint, dest: RidePoint, focus: 'route' | 'dest' = 'route', path?: RidePoint[]) {
  const maps = liveNaverMaps(sdk)
  if (!maps) return
  const span = Math.max(Math.abs(dest.lat - origin.lat), Math.abs(dest.lng - origin.lng))
  if (span < 0.0008) {
    const destLatLng = naverLatLng(maps, dest.lat, dest.lng)
    if (destLatLng) map.setCenter(destLatLng)
    map.setZoom(16)
    return
  }
  try {
    fitRideBounds(maps, map, origin, dest, path)
  } catch {
    undefined
  }
  if (focus === 'dest') {
    const destLatLng = naverLatLng(maps, dest.lat, dest.lng)
    if (destLatLng) map.setCenter(destLatLng)
  }
}

function ridePathPoints(sdk: NaverMapsSdk, points: RidePoint[]) {
  const maps = liveNaverMaps(sdk)
  if (!maps) return []
  return points
    .map((point) => naverLatLng(maps, point.lat, point.lng))
    .filter((point): point is NonNullable<typeof point> => Boolean(point))
}

function polylineDom(line: NaverPolyline | null): Element | null {
  if (!line) return null
  const raw = line as unknown as {
    getElement?: () => Element | null
    _element?: Element
    _el?: Element
  }
  try {
    return raw.getElement?.() || raw._element || raw._el || null
  } catch {
    return null
  }
}

function mapOverlayRoots(map: NaverMapInstance | null, canvas?: HTMLElement | null): Array<ParentNode | null> {
  const roots: Array<ParentNode | null> = [canvas, canvas?.parentElement ?? null]
  try {
    const panes = (map as { getPanes?: () => Record<string, HTMLElement | undefined> }).getPanes?.()
    if (panes) {
      roots.push(panes.overlayLayer ?? null, panes.overlayMouseTarget ?? null, panes.floatPane ?? null)
    }
  } catch {
    undefined
  }
  return roots
}

const SOLID_POLYLINE_STROKE = {
  strokeColor: '#000000',
  strokeStyle: 'solid',
  strokeWeight: 5,
  strokeOpacity: 1,
  strokeLineCap: 'round',
  strokeLineJoin: 'round',
} as const

function stripPolylineDash(root?: ParentNode | null) {
  if (!root || typeof (root as Element).querySelectorAll !== 'function') return
  const visit = (el: Element) => {
    el.removeAttribute('stroke-dasharray')
    el.removeAttribute('stroke-dashoffset')
    const svg = el as SVGElement
    svg.style.strokeDasharray = '0'
    svg.style.strokeDashoffset = '0'
    svg.style.stroke = '#000000'
    svg.style.strokeLinecap = 'round'
    svg.style.strokeLinejoin = 'round'
  }
  if (root instanceof Element && (root.tagName === 'PATH' || root.tagName === 'POLYLINE')) visit(root)
  ;(root as Element).querySelectorAll?.('svg path, svg polyline, path, polyline').forEach(visit)
}

function applySolidPolylineStyle(
  line: NaverPolyline | null,
  canvas?: HTMLElement | null,
  map?: NaverMapInstance | null,
) {
  if (line) {
    try {
      line.setOptions?.(SOLID_POLYLINE_STROKE)
    } catch {
      undefined
    }
    try {
      line.setStyle?.(SOLID_POLYLINE_STROKE)
    } catch {
      undefined
    }
  }
  const extra = polylineDom(line)
  stripPolylineDash(extra)
  stripPolylineDash(extra?.parentElement ?? null)
  for (const root of mapOverlayRoots(map ?? null, canvas)) stripPolylineDash(root)
  if (typeof window !== 'undefined') {
    window.requestAnimationFrame(() => {
      stripPolylineDash(extra)
      for (const root of mapOverlayRoots(map ?? null, canvas)) stripPolylineDash(root)
    })
  }
}

function solidRidePath(sdk: NaverMapsSdk, map: NaverMapInstance, points: RidePoint[], canvas?: HTMLElement | null) {
  const maps = liveNaverMaps(sdk)
  const path = ridePathPoints(sdk, points)
  if (!maps || typeof maps.Polyline !== 'function' || path.length < 2) return null
  const line = new maps.Polyline({
    map,
    path,
    clickable: false,
    zIndex: 80,
    strokeColor: '#000000',
    strokeStyle: 'solid',
    strokeWeight: 5,
    strokeOpacity: 1,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
  })
  applySolidPolylineStyle(line, canvas, map)
  return line
}

function replaceSolidRidePath(
  sdk: NaverMapsSdk,
  map: NaverMapInstance,
  current: NaverPolyline | null,
  points: RidePoint[],
  canvas?: HTMLElement | null,
) {
  try {
    current?.setMap(null)
  } catch {
    undefined
  }
  return solidRidePath(sdk, map, points, canvas)
}

type MapViewProps = {
  lat: number
  lng: number
  pinLat?: number
  pinLng?: number
  className?: string
  interactive?: boolean
  pulsePin?: boolean
  hidePin?: boolean
  showZoom?: boolean
  bottomInset?: number
  locatePlacement?: 'stacked' | 'bottom'
  centerPin?: boolean
  onPick?: (lat: number, lng: number) => void
  onActivate?: () => void
  onLocate?: () => void
  onConfirm?: () => void
  onCenterChange?: (lat: number, lng: number, dragging?: boolean) => void
  onCenterIdle?: (lat: number, lng: number) => void
  onAddressChange?: (place: { lat: number; lng: number; address: string }) => void
}

function latLngToWorld(lat: number, lng: number, zoom: number) {
  const n = 2 ** zoom
  const x = ((lng + 180) / 360) * n * TILE_SIZE
  const sin = Math.min(0.9999, Math.max(-0.9999, Math.sin((lat * Math.PI) / 180)))
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n * TILE_SIZE
  return { x, y }
}

function worldToLatLng(x: number, y: number, zoom: number) {
  const n = 2 ** zoom * TILE_SIZE
  const lng = (x / n) * 360 - 180
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)))
  return { lat: (latRad * 180) / Math.PI, lng }
}

function MapControls({
  onZoomIn,
  onZoomOut,
  onLocate,
  locatePlacement = 'stacked',
}: {
  onZoomIn: () => void
  onZoomOut: () => void
  onLocate?: () => void
  locatePlacement?: 'stacked' | 'bottom'
}) {
  const zoomButtons = (
    <>
      <button type="button" onClick={(event) => { event.stopPropagation(); onZoomIn() }} className="flex h-10 w-10 items-center justify-center text-[#4A82B8]" aria-label="지도 확대">
        <Plus className="h-4 w-4" />
      </button>
      <button type="button" onClick={(event) => { event.stopPropagation(); onZoomOut() }} className="flex h-10 w-10 items-center justify-center border-t border-[#E2E8F0] text-[#4A82B8]" aria-label="지도 축소">
        <Minus className="h-4 w-4" />
      </button>
    </>
  )
  const locateButton = onLocate ? (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onLocate()
      }}
      className={
        locatePlacement === 'bottom'
          ? 'flex h-10 w-10 items-center justify-center text-[#4C1FB8]'
          : 'flex h-10 w-10 items-center justify-center border-t border-[#E2E8F0] text-[#4C1FB8]'
      }
      aria-label="내 위치 찾기"
    >
      <LocateFixed className="h-4 w-4" />
    </button>
  ) : null

  if (locatePlacement === 'bottom') {
    return (
      <div className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-3 z-20 flex flex-col items-end gap-2">
        <div className="flex flex-col overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_8px_18px_rgba(15,23,42,0.12)]">
          {zoomButtons}
        </div>
        {onLocate ? (
          <div className="overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-[0_8px_18px_rgba(15,23,42,0.12)]">
            {locateButton}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="absolute right-3 top-5 z-20 flex flex-col overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-md">
      {zoomButtons}
      {onLocate ? locateButton : null}
    </div>
  )
}

function MapFrame({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`naver-map-shell relative w-full overflow-hidden bg-[#dbe7ee] ${className ?? 'h-[320px]'}`}>
      {children}
    </div>
  )
}

function FallbackNotice({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="pointer-events-none absolute bottom-2 left-2 z-20 max-w-[78%] rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold leading-4 text-[#334155] shadow-sm">
      {message}
    </p>
  )
}

function StartPulsePin({ onConfirm }: { onConfirm?: () => void }) {
  return (
    <span className="tt-start-pin">
      <span className="tt-start-halo" />
      <span className="tt-start-dot" />
      {onConfirm ? <PickupStartButton onConfirm={onConfirm} /> : <span className="tt-start-balloon">출발</span>}
    </span>
  )
}

function FixedMapPin({ pulse, x, y }: { pulse: boolean; x: number; y: number }) {
  return (
    <div
      className="pointer-events-none absolute z-[6]"
      style={{
        left: x,
        top: y,
        transform: pulse ? 'translate(-50%, -50%)' : 'translate(-50%, -100%)',
      }}
    >
      {pulse ? (
        <StartPulsePin />
      ) : (
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#4C1FB8] text-white shadow-md">
          <MapPin className="h-5 w-5" />
        </span>
      )}
    </div>
  )
}

function markerHtml(walker: boolean) {
  return walker
    ? `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 1px 1px rgba(255,255,255,.95))"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`
    : `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 1px 1px rgba(255,255,255,.95))"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`
}

function useNaverResize(mapsRef: MutableRefObject<NaverMapsSdk | null>, mapRef: MutableRefObject<NaverMapInstance | null>, hostRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const host = hostRef.current
    const fire = () => refreshNaverMap(mapsRef.current, mapRef.current)
    if (!host) return
    const observer = new ResizeObserver(() => fire())
    observer.observe(host)
    window.addEventListener('orientationchange', fire)
    window.visualViewport?.addEventListener('resize', fire)
    const first = window.setTimeout(fire, 60)
    const second = window.setTimeout(fire, 360)
    return () => {
      observer.disconnect()
      window.removeEventListener('orientationchange', fire)
      window.visualViewport?.removeEventListener('resize', fire)
      window.clearTimeout(first)
      window.clearTimeout(second)
    }
  }, [hostRef, mapRef, mapsRef])
}

function replaceMapCanvas(node: HTMLDivElement) {
  const parent = node.parentElement
  try {
    node.replaceChildren()
  } catch {
    node.innerHTML = ''
  }
  if (!parent) return node
  const fresh = node.cloneNode(false) as HTMLDivElement
  parent.replaceChild(fresh, node)
  return fresh
}

function FallbackSlippyMap({
  lat,
  lng,
  pinLat,
  pinLng,
  zoom,
  hidePin,
  pulsePin,
  interactive,
  showZoom,
  bottomInset = 0,
  locatePlacement = 'stacked',
  centerPin,
  onPick,
  onActivate,
  onLocate,
  onConfirm,
  onCenterChange,
  onCenterIdle,
  onAddressChange,
  onZoomIn,
  onZoomOut,
  notice,
  children,
}: MapViewProps & { zoom: number; onZoomIn: () => void; onZoomOut: () => void; notice?: string; children?: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState({ lat, lng })
  const [dragging, setDragging] = useState(false)
  const viewRef = useRef(view)
  const panRef = useRef({ active: false, x: 0, y: 0, lat, lng, moved: false })
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef(0)
  const centerChangeRef = useRef(onCenterChange)
  const centerIdleRef = useRef(onCenterIdle)
  const addressChangeRef = useRef(onAddressChange)
  const liveAddressRef = useRef(
    createLiveAddressLookup((nextLat, nextLng, nextAddress) => {
      addressChangeRef.current?.({ lat: nextLat, lng: nextLng, address: nextAddress })
    }, 220),
  )
  const settleRef = useRef(
    createSettleDebounce(() => {
      const next = viewRef.current
      centerChangeRef.current?.(next.lat, next.lng, false)
      centerIdleRef.current?.(next.lat, next.lng)
      liveAddressRef.current.run(next.lat, next.lng)
    }),
  )
  centerChangeRef.current = onCenterChange
  centerIdleRef.current = onCenterIdle
  addressChangeRef.current = onAddressChange
  viewRef.current = view

  const emitIdle = () => {
    settleRef.current.kick()
  }

  useEffect(() => {
    const node = wrapRef.current
    if (!node) return
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const lookup = liveAddressRef.current
    const settle = settleRef.current
    lookup.run(viewRef.current.lat, viewRef.current.lng)
    return () => {
      lookup.stop()
      settle.stop()
    }
  }, [])

  useEffect(() => {
    if (panRef.current.active) return
    setView({ lat, lng })
  }, [lat, lng])

  const center = latLngToWorld(view.lat, view.lng, zoom)
  const pin = latLngToWorld(pinLat ?? lat, pinLng ?? lng, zoom)
  const originX = center.x - size.width / 2
  const originY = center.y - size.height / 2
  const tiles: { key: string; src: string; left: number; top: number }[] = []
  if (size.width > 0 && size.height > 0) {
    const minTx = Math.floor(originX / TILE_SIZE)
    const maxTx = Math.floor((originX + size.width) / TILE_SIZE)
    const minTy = Math.floor(originY / TILE_SIZE)
    const maxTy = Math.floor((originY + size.height) / TILE_SIZE)
    const limit = 2 ** zoom
    for (let ty = minTy; ty <= maxTy; ty += 1) {
      for (let tx = minTx; tx <= maxTx; tx += 1) {
        const wrappedX = ((tx % limit) + limit) % limit
        if (ty < 0 || ty >= limit) continue
        tiles.push({
          key: `${zoom}-${wrappedX}-${ty}`,
          src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png`,
          left: tx * TILE_SIZE - originX,
          top: ty * TILE_SIZE - originY,
        })
      }
    }
  }

  const pickFromPoint = (clientX: number, clientY: number) => {
    const box = wrapRef.current?.getBoundingClientRect()
    if (!box || !onPick) return
    const worldX = originX + (clientX - box.left)
    const worldY = originY + (clientY - box.top)
    const point = worldToLatLng(worldX, worldY, zoom)
    if (centerPin) {
      onPick(point.lat, point.lng)
      return
    }
    const anchor = { lat: pinLat ?? lat, lng: pinLng ?? lng }
    const snapped = snapToNearbyPoint(point, anchor, 90)
    onPick(snapped.lat, snapped.lng)
  }

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 overflow-hidden touch-manipulation"
      onWheel={(event) => {
        event.preventDefault()
        if (event.deltaY < 0) onZoomIn()
        else onZoomOut()
      }}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (pointersRef.current.size >= 2) {
          panRef.current.active = false
          const pts = [...pointersRef.current.values()]
          pinchRef.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
          return
        }
        panRef.current = { active: true, x: event.clientX, y: event.clientY, lat: view.lat, lng: view.lng, moved: false }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (pointersRef.current.has(event.pointerId)) {
          pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        }
        if (pointersRef.current.size >= 2) {
          const pts = [...pointersRef.current.values()]
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
          if (pinchRef.current > 0) {
            const ratio = dist / pinchRef.current
            if (ratio > 1.12) {
              onZoomIn()
              pinchRef.current = dist
            } else if (ratio < 0.88) {
              onZoomOut()
              pinchRef.current = dist
            }
          }
          return
        }
        if (!panRef.current.active) return
        if (Math.abs(event.clientX - panRef.current.x) > 8 || Math.abs(event.clientY - panRef.current.y) > 8) {
          panRef.current.moved = true
        }
        const start = latLngToWorld(panRef.current.lat, panRef.current.lng, zoom)
        const next = worldToLatLng(start.x - (event.clientX - panRef.current.x), start.y - (event.clientY - panRef.current.y), zoom)
        viewRef.current = next
        setView(next)
        if (panRef.current.moved) {
          setDragging(true)
        }
      }}
      onPointerUp={(event) => {
        const tapped = panRef.current.active && !panRef.current.moved && pointersRef.current.size <= 1
        const panned = panRef.current.moved
        pointersRef.current.delete(event.pointerId)
        if (pointersRef.current.size < 2) pinchRef.current = 0
        if (pointersRef.current.size === 0) panRef.current.active = false
        if (panned && pointersRef.current.size === 0) {
          setDragging(false)
          emitIdle()
        }
        if (centerPin && tapped) {
          const box = wrapRef.current?.getBoundingClientRect()
          if (box) {
            const worldX = originX + (event.clientX - box.left)
            const worldY = originY + (event.clientY - box.top)
            const point = worldToLatLng(worldX, worldY, zoom)
            viewRef.current = point
            setView(point)
            emitIdle()
          }
          return
        }
        if (!interactive || !tapped) return
        if (onActivate && !onPick) {
          onActivate()
          return
        }
        pickFromPoint(event.clientX, event.clientY)
      }}
      onPointerCancel={(event) => {
        pointersRef.current.delete(event.pointerId)
        pinchRef.current = 0
        panRef.current.active = false
      }}
    >
      {tiles.map((tile) => (
        <img
          key={tile.key}
          src={tile.src}
          alt=""
          draggable={false}
          className="pointer-events-none absolute max-w-none"
          style={{ left: tile.left, top: tile.top, width: TILE_SIZE, height: TILE_SIZE }}
        />
      ))}
      {!hidePin && centerPin ? <CenteredMapPin pulse={Boolean(pulsePin)} lift={dragging} onConfirm={onConfirm} /> : null}
      {!hidePin && !centerPin ? (
        <span
          className="pointer-events-none absolute z-[5]"
          style={{
            left: pin.x - originX,
            top: pin.y - originY,
            transform: pulsePin ? 'translate(-50%, -50%)' : 'translate(-50%, -100%)',
          }}
        >
          {pulsePin ? (
            <StartPulsePin />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#4C1FB8] text-white shadow-md">
              <MapPin className="h-5 w-5" />
            </span>
          )}
        </span>
      ) : null}
      {children}
      <FallbackNotice message={notice} />
      {interactive || showZoom ? (
        <MapControls
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          locatePlacement={locatePlacement}
          onLocate={() => {
            setView({ lat, lng })
            onLocate?.()
            liveAddressRef.current.run(lat, lng)
          }}
        />
      ) : null}
    </div>
  )
}

function NaverLocationMap(props: MapViewProps) {
  const { lat, lng, pinLat, pinLng, className, interactive, pulsePin, hidePin, showZoom, bottomInset = 0, locatePlacement = 'stacked', centerPin, onPick, onActivate, onLocate, onConfirm, onAddressChange } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<NaverMapInstance | null>(null)
  const mapsRef = useRef<NaverMapsSdk | null>(null)
  const pinRef = useRef<MapHtmlPin | null>(null)
  const pickRef = useRef(onPick)
  const activateRef = useRef(onActivate)
  const addressChangeRef = useRef(onAddressChange)
  const sessionRef = useRef(0)
  const centerRef = useRef({ lat, lng, pinLat, pinLng })
  const followCenterRef = useRef(Boolean(centerPin))
  const lookupIdRef = useRef(0)
  const [mode, setMode] = useState<'loading' | 'naver' | 'fallback'>(hasNaverMapClientId() ? 'loading' : 'fallback')
  const [zoom, setZoom] = useState(15)
  const [pinScreen, setPinScreen] = useState<{ x: number; y: number } | null>(null)
  const [loadNotice, setLoadNotice] = useState<string | undefined>()
  pickRef.current = onPick
  activateRef.current = onActivate
  addressChangeRef.current = onAddressChange
  centerRef.current = { lat, lng, pinLat, pinLng }
  followCenterRef.current = Boolean(centerPin)
  useNaverResize(mapsRef, mapRef, hostRef)

  useEffect(() => {
    if (!hasNaverMapClientId()) {
      setMode('fallback')
      return
    }
    const initialCanvas = canvasRef.current
    if (!initialCanvas) return
    let cancelled = false
    const listeners: unknown[] = []
    let mapInstance: NaverMapInstance | null = null
    let canvasNode = initialCanvas
    let refreshTimer = 0
    let stopWatch: (() => void) | null = null
    const session = ++sessionRef.current
    const isLive = () => !cancelled && session === sessionRef.current
    lookupIdRef.current = 0
    setMode('loading')
    void (async () => {
      try {
        await waitForMapSize(canvasNode)
        const sdk = await waitForNaverSdk()
        if (!isLive()) return
        canvasNode = replaceMapCanvas(canvasRef.current || canvasNode)
        canvasRef.current = canvasNode
        const maps = liveNaverMaps(sdk)
        if (!maps) {
          setLoadNotice('네이버 지도를 불러오지 못해 대체 지도를 표시합니다.')
          setMode('fallback')
          return
        }
        mapsRef.current = maps
        const start = centerRef.current
        const center = naverLatLng(maps, start.lat, start.lng)
        if (!center) {
          setLoadNotice('네이버 지도를 불러오지 못해 대체 지도를 표시합니다.')
          setMode('fallback')
          return
        }
        let map: NaverMapInstance
        try {
          map = createNaverMapInstance(maps, canvasNode, center, 15)
        } catch {
          setLoadNotice('네이버 지도를 불러오지 못해 대체 지도를 표시합니다.')
          setMode('fallback')
          return
        }
        mapInstance = map
        mapRef.current = map
        if (!isLive()) {
          detachNaverMap(maps, map, listeners, canvasNode)
          if (mapRef.current === map) mapRef.current = null
          return
        }
        if (!hidePin && !followCenterRef.current) {
          pinRef.current = trackMapPoint(maps, map, start.pinLat ?? start.lat, start.pinLng ?? start.lng, (x, y) => {
            if (isLive()) setPinScreen({ x, y })
          })
        }
        if (addressChangeRef.current) {
          stopWatch = watchMapSettle(map, maps, hostRef.current || canvasNode, (point) => {
            if (!isLive()) return
            const requestId = ++lookupIdRef.current
            addressChangeRef.current?.({ lat: point.lat, lng: point.lng, address: ADDRESS_LOADING })
            void lookupAddressFromApi(point.lat, point.lng).then((nextAddress) => {
              if (!isLive() || requestId !== lookupIdRef.current) return
              addressChangeRef.current?.({ lat: point.lat, lng: point.lng, address: nextAddress })
            })
          })
        }
        if (interactive && !followCenterRef.current && (pickRef.current || activateRef.current)) {
          const onMapPress = (event?: { coord?: unknown; latlng?: unknown }) => {
            if (activateRef.current && !pickRef.current) {
              activateRef.current()
              return
            }
            const clicked = readMapClickLatLng(event)
            if (!clicked) return
            const pin = centerRef.current
            const snapped = snapToNearbyPoint(clicked, { lat: pin.pinLat ?? pin.lat, lng: pin.pinLng ?? pin.lng }, 90)
            pickRef.current?.(snapped.lat, snapped.lng)
          }
          const clickHandle = addNaverMapListener(maps, map, 'click', onMapPress)
          const tapHandle = addNaverMapListener(maps, map, 'tap', onMapPress)
          if (clickHandle) listeners.push(clickHandle)
          if (tapHandle) listeners.push(tapHandle)
        }
        refreshNaverMap(maps, map)
        refreshTimer = window.setTimeout(() => {
          if (!isLive()) return
          refreshNaverMap(maps, map)
        }, 80)
        if (!isLive()) {
          detachNaverMap(maps, map, listeners, canvasNode)
          if (mapRef.current === map) mapRef.current = null
          return
        }
        setMode('naver')
      } catch {
        if (!isLive()) return
        setLoadNotice('네이버 지도를 불러오지 못해 대체 지도를 표시합니다.')
        setMode('fallback')
      }
    })()
    return () => {
      cancelled = true
      sessionRef.current += 1
      lookupIdRef.current += 1
      stopWatch?.()
      window.clearTimeout(refreshTimer)
      try {
        pinRef.current?.setMap(null)
      } catch {
        undefined
      }
      pinRef.current = null
      const sdk = liveNaverMaps(mapsRef.current)
      detachNaverMap(sdk, mapInstance || mapRef.current, listeners, canvasNode)
      if (mapRef.current === mapInstance || !mapInstance) mapRef.current = null
      mapsRef.current = null
    }
  }, [hidePin, interactive, centerPin])

  useEffect(() => {
    const map = mapRef.current
    const sdk = mapsRef.current
    if (!map || !sdk || mode !== 'naver') return
    refreshNaverMap(sdk, map)
    pinRef.current?.draw?.()
  }, [bottomInset, mode])

  useEffect(() => {
    const map = mapRef.current
    const sdk = mapsRef.current
    const maps = liveNaverMaps(sdk)
    if (!map || !maps || mode !== 'naver') return
    const current = readLatLngValue(map.getCenter?.())
    if (current && Math.abs(current.lat - lat) < 1e-6 && Math.abs(current.lng - lng) < 1e-6) return
    const next = naverLatLng(maps, lat, lng)
    if (next) map.panTo(next)
    pinRef.current?.draw?.()
  }, [lat, lng, mode, centerPin])

  useEffect(() => {
    if (centerPin) return
    pinRef.current?.setPosition(pinLat ?? lat, pinLng ?? lng)
  }, [lat, lng, pinLat, pinLng, centerPin])

  const changeNaverZoom = (delta: number) => {
    const map = mapRef.current
    if (!map) return
    try {
      map.setZoom(Math.min(19, Math.max(11, map.getZoom() + delta)))
      refreshNaverMap(mapsRef.current, map)
      pinRef.current?.draw?.()
    } catch {
      undefined
    }
  }

  return (
    <MapFrame className={className}>
      {mode !== 'fallback' ? (
        <div ref={hostRef} className="naver-map-host absolute inset-0 z-0">
          <div ref={canvasRef} className="naver-map-canvas h-full w-full touch-manipulation" style={{ width: '100%', height: '100%' }} />
          {!hidePin && !centerPin && pinScreen ? <FixedMapPin pulse={Boolean(pulsePin)} x={pinScreen.x} y={pinScreen.y} /> : null}
        </div>
      ) : (
        <FallbackSlippyMap
          {...props}
          zoom={zoom}
          interactive
          showZoom
          onZoomIn={() => setZoom((value) => Math.min(18, value + 1))}
          onZoomOut={() => setZoom((value) => Math.max(12, value - 1))}
          notice={loadNotice}
        />
      )}
      {!hidePin && centerPin && mode !== 'loading' ? (
        <CenteredMapPin pulse={Boolean(pulsePin)} lift={false} onConfirm={onConfirm} />
      ) : null}
      {mode === 'loading' ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#dbe7ee]/80">
          <p className="rounded-full bg-white px-3 py-2 text-xs font-bold text-[#334155] shadow-sm">지도를 불러오는 중이에요</p>
        </div>
      ) : null}
      {mode === 'naver' ? (
        <MapControls
          onZoomIn={() => changeNaverZoom(1)}
          onZoomOut={() => changeNaverZoom(-1)}
          locatePlacement={locatePlacement}
          onLocate={() => {
            const map = mapRef.current
            const sdk = mapsRef.current
            if (!map || !sdk) return
            const next = naverLatLng(liveNaverMaps(sdk), centerRef.current.lat, centerRef.current.lng)
            if (next) map.panTo(next)
            pinRef.current?.draw?.()
            onLocate?.()
          }}
        />
      ) : null}
    </MapFrame>
  )
}

export function LocationTileMap(props: MapViewProps) {
  const [mountId] = useState(() => `naver-loc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`)
  return <NaverLocationMap key={mountId} {...props} />
}

function LiveFallbackOverlay({
  phase,
  kind,
  taxi,
  origin,
  dest,
  path,
  zoom,
  size,
}: {
  phase: TaxiLivePhase
  kind: 'taxi' | 'daeri'
  taxi: RidePoint & { angle: number }
  origin: RidePoint
  dest: RidePoint
  path: RidePoint[]
  zoom: number
  size: { width: number; height: number }
}) {
  const mid = lerpPoint(origin, dest, 0.5)
  const center = latLngToWorld(mid.lat, mid.lng, zoom)
  const originX = center.x - size.width / 2
  const originY = center.y - size.height / 2
  const toPx = (point: RidePoint) => {
    const world = latLngToWorld(point.lat, point.lng, zoom)
    return { left: world.x - originX, top: world.y - originY }
  }
  const start = toPx(origin)
  const end = toPx(dest)
  const mover = toPx(taxi)
  const walker = kind === 'daeri' && phase !== 'moving'
  const MarkerIcon = walker ? UserRound : Car
  const line = path.length >= 2 ? path : [origin, dest]
  const d = line
    .map((point, index) => {
      const px = toPx(point)
      return `${index === 0 ? 'M' : 'L'} ${px.left} ${px.top}`
    })
    .join(' ')
  if (size.width < 8) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-[6]">
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        <path d={d} fill="none" stroke="#000000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="1" />
      </svg>
      <span className="absolute rounded-full bg-[#0F172A] px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-white shadow-sm" style={{ left: start.left, top: start.top, transform: 'translate(-50%, -145%)' }}>
        출발
      </span>
      <span className="absolute rounded-full bg-[#1D4ED8] px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-white shadow-sm" style={{ left: end.left, top: end.top, transform: 'translate(-50%, -145%)' }}>
        도착
      </span>
      <span className="absolute" style={{ left: mover.left, top: mover.top, transform: `translate(-50%, -50%) rotate(${walker ? 0 : taxi.angle}deg)` }}>
        <MarkerIcon className="h-7 w-7 text-[#0F172A] drop-shadow-[0_1px_1px_rgba(255,255,255,0.95)]" strokeWidth={2.35} />
      </span>
    </div>
  )
}
function NaverLiveRideMap({
  phase,
  kind,
  taxi,
  origin,
  dest,
  className,
}: {
  phase: TaxiLivePhase;
  kind: 'taxi' | 'daeri';
  taxi: RidePoint & { angle: number };
  origin: RidePoint;
  dest: RidePoint;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<NaverMapInstance | null>(null)
  const mapsRef = useRef<NaverMapsSdk | null>(null)
  const moverRef = useRef<NaverMarker | null>(null)
  const moverEl = useRef<HTMLDivElement | null>(null)
  const lineRef = useRef<NaverPolyline | null>(null)
  const startPinRef = useRef<MapHtmlPin | null>(null)
  const endPinRef = useRef<MapHtmlPin | null>(null)
  const walker = kind === 'daeri' && phase !== 'moving'
  const originRef = useRef(origin)
  const destRef = useRef(dest)
  const phaseRef = useRef(phase)
  const routePathRef = useRef<RidePoint[]>([origin, dest])
  originRef.current = origin
  destRef.current = dest
  phaseRef.current = phase
  const mid = lerpPoint(origin, dest, 0.5)
  const [mode, setMode] = useState<'loading' | 'naver' | 'fallback'>(hasNaverMapClientId() ? 'loading' : 'fallback')
  const [zoom, setZoom] = useState(15)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [loadNotice, setLoadNotice] = useState<string | undefined>()
  const [routePath, setRoutePath] = useState<RidePoint[]>([origin, dest])

  const keepSolidStroke = () => {
    applySolidPolylineStyle(lineRef.current, canvasRef.current, mapRef.current)
  }

  const applyPolyline = (sdk: NaverMapsSdk) => {
    const map = mapRef.current
    const points = routePathRef.current
    if (!map || points.length < 2) return
    const coords = ridePathPoints(sdk, points)
    if (coords.length < 2) return
    try {
      if (lineRef.current) {
        lineRef.current.setPath(coords)
        keepSolidStroke()
        return
      }
    } catch {
      undefined
    }
    lineRef.current = replaceSolidRidePath(sdk, map, lineRef.current, points, canvasRef.current)
    keepSolidStroke()
  }

  const applyCamera = () => {
    const map = mapRef.current
    const sdk = liveNaverMaps(mapsRef.current)
    if (!map || !sdk) return
    refreshNaverMap(sdk, map)
    forceRideCamera(sdk, map, originRef.current, destRef.current, phaseRef.current === 'moving' ? 'dest' : 'route', routePathRef.current)
    startPinRef.current?.setPosition(originRef.current.lat, originRef.current.lng)
    endPinRef.current?.setPosition(destRef.current.lat, destRef.current.lng)
    applyPolyline(sdk)
    keepSolidStroke()
  }

  useEffect(() => {
    const host = hostRef.current
    const fire = () => applyCamera()
    if (!host) return
    const observer = new ResizeObserver(() => fire())
    observer.observe(host)
    window.addEventListener('orientationchange', fire)
    window.visualViewport?.addEventListener('resize', fire)
    const first = window.setTimeout(fire, 60)
    const second = window.setTimeout(fire, 360)
    const third = window.setTimeout(fire, 900)
    return () => {
      observer.disconnect()
      window.removeEventListener('orientationchange', fire)
      window.visualViewport?.removeEventListener('resize', fire)
      window.clearTimeout(first)
      window.clearTimeout(second)
      window.clearTimeout(third)
    }
  }, [hostRef])

  useEffect(() => {
    const node = hostRef.current
    if (!node) return
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [mode])

  useEffect(() => {
    const controller = new AbortController()
    void fetchDrivingPath(origin, dest, controller.signal)
      .then((path) => {
        if (controller.signal.aborted || path.length < 3) return
        routePathRef.current = path
        setRoutePath(path)
        const sdk = liveNaverMaps(mapsRef.current)
        const map = mapRef.current
        if (!sdk || !map) return
        lineRef.current = replaceSolidRidePath(sdk, map, lineRef.current, path, canvasRef.current)
        forceRideCamera(sdk, map, origin, dest, phaseRef.current === 'moving' ? 'dest' : 'route', path)
        applySolidPolylineStyle(lineRef.current, canvasRef.current, map)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [origin.lat, origin.lng, dest.lat, dest.lng])

  useEffect(() => {
    if (!isUsableCoord(origin.lat, origin.lng) || !isUsableCoord(dest.lat, dest.lng)) return
    if (!hasNaverMapClientId()) {
      setMode('fallback')
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    const strokeListeners: unknown[] = []
    let dashObserver: MutationObserver | null = null
    void (async () => {
      await waitForMapSize(canvas)
      const [sdk, roadPath] = await Promise.all([waitForNaverSdk(), fetchDrivingPath(origin, dest).catch(() => [] as RidePoint[])])
      if (cancelled || !canvasRef.current) return
      const maps = liveNaverMaps(sdk)
      if (!maps || !isUsableCoord(origin.lat, origin.lng)) {
        setLoadNotice('네이버 지도를 불러오지 못해 대체 지도를 표시합니다.')
        setMode('fallback')
        return
      }
      if (roadPath.length >= 3) {
        routePathRef.current = roadPath
        setRoutePath(roadPath)
      }
      mapsRef.current = maps
      const center = naverLatLng(maps, mid.lat, mid.lng)
      if (!center) {
        setLoadNotice('네이버 지도를 불러오지 못해 대체 지도를 표시합니다.')
        setMode('fallback')
        return
      }
      let map: NaverMapInstance
      try {
        map = createNaverMapInstance(maps, canvasRef.current, center, 15)
      } catch {
        setLoadNotice('네이버 지도를 불러오지 못해 대체 지도를 표시합니다.')
        setMode('fallback')
        return
      }
      mapRef.current = map
      map.setCenter(center)
      forceRideCamera(maps, map, origin, dest, phase === 'moving' ? 'dest' : 'route', routePathRef.current)
      lineRef.current = solidRidePath(maps, map, routePathRef.current, canvasRef.current)
      applySolidPolylineStyle(lineRef.current, canvasRef.current, map)
      const keepStrokeOnRender = () => {
        if (cancelled) return
        applySolidPolylineStyle(lineRef.current, canvasRef.current, map)
      }
      for (const eventName of ['idle', 'tilesloaded', 'zoom_changed', 'bounds_changed', 'center_changed', 'dragend']) {
        const handle = addNaverMapListener(maps, map, eventName, keepStrokeOnRender)
        if (handle) strokeListeners.push(handle)
      }
      if (cancelled) {
        strokeListeners.forEach((listener) => removeNaverMapListener(maps, listener))
        return
      }
      const observeRoot = canvasRef.current || hostRef.current
      if (observeRoot && typeof MutationObserver === 'function') {
        dashObserver = new MutationObserver(() => keepStrokeOnRender())
        dashObserver.observe(observeRoot, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['style', 'stroke-dasharray', 'stroke-dashoffset', 'd'],
        })
      }
      if (routePathRef.current.length < 3) {
        void fetchDrivingPath(origin, dest)
          .then((path) => {
            if (cancelled || path.length < 3 || !mapRef.current) return
            routePathRef.current = path
            setRoutePath(path)
            const live = liveNaverMaps(maps)
            if (!live) return
            lineRef.current = replaceSolidRidePath(live, mapRef.current, lineRef.current, path, canvasRef.current)
            applySolidPolylineStyle(lineRef.current, canvasRef.current, mapRef.current)
            forceRideCamera(live, mapRef.current, origin, dest, phase === 'moving' ? 'dest' : 'route', path)
          })
          .catch(() => undefined)
      }
      const startLabel = document.createElement('div')
      startLabel.style.cssText = 'white-space:nowrap;writing-mode:horizontal-tb;width:max-content;border-radius:9999px;background:#0F172A;color:#fff;padding:3px 8px;font-size:10px;font-weight:800;letter-spacing:0.02em;box-shadow:0 4px 10px rgba(15,23,42,0.22)'
      startLabel.textContent = '출발'
      const endLabel = document.createElement('div')
      endLabel.style.cssText = 'white-space:nowrap;writing-mode:horizontal-tb;width:max-content;border-radius:9999px;background:#1D4ED8;color:#fff;padding:3px 8px;font-size:10px;font-weight:800;letter-spacing:0.02em;box-shadow:0 4px 10px rgba(29,78,216,0.28)'
      endLabel.textContent = '도착'
      startPinRef.current = createHtmlOverlay(maps, map, startLabel, origin.lat, origin.lng, 'translate(-50%, -120%)')
      endPinRef.current = createHtmlOverlay(maps, map, endLabel, dest.lat, dest.lng, 'translate(-50%, -120%)')
      const mover = document.createElement('div')
      mover.style.willChange = 'transform'
      mover.innerHTML = markerHtml(walker)
      moverEl.current = mover
      moverRef.current = createDomMarker(maps, map, mover, taxi.lat, taxi.lng, 14, 14)
      const pinCamera = () => {
        if (cancelled) return
        refreshNaverMap(maps, map)
        forceRideCamera(maps, map, origin, dest, phase === 'moving' ? 'dest' : 'route', routePathRef.current)
        startPinRef.current?.setPosition(origin.lat, origin.lng)
        endPinRef.current?.setPosition(dest.lat, dest.lng)
        applyPolyline(maps)
        applySolidPolylineStyle(lineRef.current, canvasRef.current, map)
        if (phase === 'moving') {
          const destLatLng = naverLatLng(maps, dest.lat, dest.lng)
          if (destLatLng) map.setCenter(destLatLng)
        }
      }
      pinCamera()
      window.requestAnimationFrame(pinCamera)
      window.setTimeout(pinCamera, 80)
      window.setTimeout(pinCamera, 400)
      window.setTimeout(pinCamera, 1000)
      setMode('naver')
    })()
    return () => {
      cancelled = true
      dashObserver?.disconnect()
      const sdk = liveNaverMaps(mapsRef.current)
      strokeListeners.forEach((listener) => removeNaverMapListener(sdk, listener))
      startPinRef.current?.setMap(null)
      startPinRef.current = null
      endPinRef.current?.setMap(null)
      endPinRef.current = null
      moverRef.current?.setMap(null)
      moverRef.current = null
      lineRef.current?.setMap(null)
      lineRef.current = null
      mapRef.current?.destroy?.()
      mapRef.current = null
    }
  }, [kind, walker, phase, origin.lat, origin.lng, dest.lat, dest.lng])

  useEffect(() => {
    const marker = moverRef.current
    const el = moverEl.current
    const sdk = mapsRef.current
    const maps = liveNaverMaps(sdk)
    if (!marker || !maps || mode !== 'naver') return
    if (el) el.style.transform = `rotate(${walker ? 0 : taxi.angle}deg)`
    const position = naverLatLng(maps, taxi.lat, taxi.lng)
    if (position) marker.setPosition(position)
  }, [taxi, walker, mode])

  return (
    <MapFrame className={className}>
      <div ref={hostRef} className="naver-map-host absolute inset-0">
        {mode !== 'fallback' ? <div ref={canvasRef} className="naver-map-canvas h-full w-full touch-manipulation" style={{ width: '100%', height: '100%' }} /> : null}
      </div>
      {mode === 'fallback' ? (
        <FallbackSlippyMap
          lat={mid.lat}
          lng={mid.lng}
          hidePin
          zoom={zoom}
          interactive
          showZoom
          onZoomIn={() => setZoom((value) => Math.min(18, value + 1))}
          onZoomOut={() => setZoom((value) => Math.max(12, value - 1))}
          notice={loadNotice}
        >
          <LiveFallbackOverlay phase={phase} kind={kind} taxi={taxi} origin={origin} dest={dest} path={routePath} zoom={zoom} size={size} />
        </FallbackSlippyMap>
      ) : null}
      {mode === 'loading' ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#dbe7ee]/80">
          <p className="rounded-full bg-white px-3 py-2 text-xs font-bold text-[#334155] shadow-sm">지도를 불러오는 중이에요</p>
        </div>
      ) : null}
      {mode === 'naver' ? (
        <MapControls
          onZoomIn={() => {
            const map = mapRef.current
            if (!map) return
            map.setZoom(Math.min(19, Math.max(11, map.getZoom() + 1)))
            refreshNaverMap(mapsRef.current, map)
          }}
          onZoomOut={() => {
            const map = mapRef.current
            if (!map) return
            map.setZoom(Math.min(19, Math.max(11, map.getZoom() - 1)))
            refreshNaverMap(mapsRef.current, map)
          }}
        />
      ) : null}
    </MapFrame>
  )
}

export function TaxiLiveMap({
  phase,
  routeLabel: _routeLabel,
  statusLabel,
  kind = 'taxi',
  originLat,
  originLng,
  destLat,
  destLng,
  originLabel,
  destLabel,
  vehicleLat,
  vehicleLng,
  vehicleHeading,
}: {
  phase: TaxiLivePhase
  routeLabel: string
  statusLabel: string
  kind?: 'taxi' | 'daeri'
  originLat: number
  originLng: number
  destLat?: number
  destLng?: number
  originLabel?: string
  destLabel?: string
  vehicleLat?: number
  vehicleLng?: number
  vehicleHeading?: number
}) {
  const live = resolveLiveRidePoints({
    originLat,
    originLng,
    destLat,
    destLng,
    originAddress: originLabel,
    destAddress: destLabel,
    destLabel,
  });

  console.log("TaxiLiveMap 진입 - originLat:", originLat, "originLng:", originLng, "destLat:", destLat, "destLng:", destLng);

  const origin = live.origin ? { lat: live.origin.lat, lng: live.origin.lng } : null;
  const dest = live.dest ? { lat: live.dest.lat, lng: live.dest.lng } : null;
  console.log("👉 파싱된 origin:", origin, "dest:", dest);
   const [taxi, setTaxi] = useState(() => {
    if (isUsableCoord(vehicleLat, vehicleLng)) {
      return { lat: vehicleLat as number, lng: vehicleLng as number, angle: vehicleHeading ?? 0 }
    }
    return origin && dest ? vehicleOnRide(phase, origin, dest, phase === 'boarding' ? 1 : 0) : { lat: 0, lng: 0, angle: 0 }
  })

  useEffect(() => {
    if (!isUsableCoord(vehicleLat, vehicleLng)) return
    setTaxi((prev) => ({
      lat: vehicleLat as number,
      lng: vehicleLng as number,
      angle: Number.isFinite(vehicleHeading) ? (vehicleHeading as number) : prev.angle,
    }))
  }, [vehicleLat, vehicleLng, vehicleHeading])

  useEffect(() => {
    if (isUsableCoord(vehicleLat, vehicleLng)) return
    if (!origin || !dest) return
    if (phase === 'boarding') {
      setTaxi(vehicleOnRide(phase, origin, dest, 1))
      return
    }
    const duration = phase === 'moving' ? 24000 : 16000
    let frame = 0
    const started = performance.now()
    const tick = (now: number) => {
      const elapsed = (now - started) % duration
      setTaxi(vehicleOnRide(phase, origin, dest, elapsed / duration))
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [phase, origin?.lat, origin?.lng, dest?.lat, dest?.lng, vehicleLat, vehicleLng])

  if (!origin || !dest) {
    return (
      <div className="relative mt-4 flex h-[268px] items-center justify-center overflow-hidden rounded-[24px] border-2 border-[#CBD5E1] bg-[#E2E8F0]">
        <p className="rounded-full bg-white px-3 py-2 text-xs font-bold text-[#334155] shadow-sm">실제 위치를 불러오는 중이에요</p>
      </div>
    )
  }

  return (
    <div className="relative mt-4 overflow-hidden rounded-[24px] border-2 border-[#CBD5E1] bg-[#E2E8F0]">
      <NaverLiveRideMap
        key={`ride-${phase}-${origin.lat.toFixed(5)}-${dest.lat.toFixed(5)}-${dest.lng.toFixed(5)}`}
        phase={phase}
        kind={kind}
        taxi={isUsableCoord(taxi.lat, taxi.lng) ? taxi : { ...origin, angle: 0 }}
        origin={origin}
        dest={dest}
        className="h-[268px]"
      />
      <div className="pointer-events-none absolute right-3 top-3 z-[15]">
        <span className="rounded-full bg-[#4A82B8] px-2.5 py-1 text-[10px] font-bold text-white shadow-[0_6px_14px_rgba(15,23,42,0.16)]">{statusLabel}</span>
      </div>
      <div className="absolute bottom-3 left-3 z-[15] flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold text-[#334155] shadow-sm">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#4A82B8]" />
        {phase === 'arriving' ? (kind === 'daeri' ? '기사 → 호출자 이동 중' : '기사 → 승객 이동 중') : phase === 'boarding' ? (kind === 'daeri' ? '호출자 위치 도착' : '픽업 지점 도착') : '출발지 → 목적지 주행 중'}
      </div>
    </div>
  )
}

type DeadNearbyMapSpot = {
  id: string
  name: string
  lat: number
  lng: number
}

function nearbyPinElement(index: number, selected: boolean, onClick: () => void) {
  const el = document.createElement('button')
  el.type = 'button'
  el.textContent = String(index + 1)
  el.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'width:28px',
    'height:28px',
    'border-radius:9999px',
    'border:2px solid #fff',
    'font-size:11px',
    'font-weight:800',
    'cursor:pointer',
    'box-shadow:0 6px 14px rgba(15,23,42,0.22)',
    selected ? 'background:#4C1FB8;color:#fff;transform:scale(1.15)' : 'background:#0F172A;color:#fff',
  ].join(';')
  el.addEventListener('click', (event) => {
    event.stopPropagation()
    onClick()
  })
  return el
}

function userPinElement() {
  const el = document.createElement('div')
  el.style.cssText = 'position:relative;width:18px;height:18px'
  el.innerHTML =
    '<span style="position:absolute;inset:-8px;border-radius:9999px;background:rgba(37,99,235,.22);animation:ping 1.4s cubic-bezier(0,0,.2,1) infinite"></span><span style="position:absolute;inset:0;border-radius:9999px;border:2px solid #fff;background:#2563EB;box-shadow:0 4px 10px rgba(37,99,235,.35)"></span>'
  return el
}

function NaverNearbyServiceMap({
  origin,
  spots,
  selectedId,
  onSelect,
  className,
}: {
  origin: RidePoint
  spots: DeadNearbyMapSpot[]
  selectedId?: string
  onSelect?: (id: string) => void
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<NaverMapInstance | null>(null)
  const mapsRef = useRef<NaverMapsSdk | null>(null)
  const pinsRef = useRef<MapHtmlPin[]>([])
  const selectRef = useRef(onSelect)
  const spotsRef = useRef(spots)
  const selectedRef = useRef(selectedId)
  const [mode, setMode] = useState<'loading' | 'naver' | 'fallback'>(hasNaverMapClientId() ? 'loading' : 'fallback')
  selectRef.current = onSelect
  spotsRef.current = spots
  selectedRef.current = selectedId
  useNaverResize(mapsRef, mapRef, hostRef)

  const clearPins = () => {
    for (const pin of pinsRef.current) pin.setMap(null)
    pinsRef.current = []
  }

  const paintPins = (maps: NaverMapsSdk, map: NaverMapInstance) => {
    clearPins()
    const user = createHtmlOverlay(maps, map, userPinElement(), origin.lat, origin.lng, 'translate(-50%, -50%)')
    pinsRef.current.push(user)
    spotsRef.current.forEach((spot, index) => {
      const selected = spot.id === selectedRef.current
      const pin = createHtmlOverlay(
        maps,
        map,
        nearbyPinElement(index, selected, () => selectRef.current?.(spot.id)),
        spot.lat,
        spot.lng,
        'translate(-50%, -100%)',
      )
      pinsRef.current.push(pin)
    })
  }

  const focusSelected = (maps: NaverMapsSdk, map: NaverMapInstance, animate = true) => {
    const selected = spotsRef.current.find((spot) => spot.id === selectedRef.current)
    const target = selected ?? origin
    const next = naverLatLng(maps, target.lat, target.lng)
    if (!next) return
    try {
      if (animate) map.panTo(next)
      else map.setCenter(next)
      map.setZoom(selected ? 17 : 16)
    } catch {
      undefined
    }
  }

  useEffect(() => {
    if (!hasNaverMapClientId() || !isUsableCoord(origin.lat, origin.lng)) {
      setMode('fallback')
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    let mapInstance: NaverMapInstance | null = null
    void (async () => {
      await waitForMapSize(canvas)
      const sdk = await waitForNaverSdk()
      if (cancelled || !canvasRef.current) return
      const maps = liveNaverMaps(sdk)
      const center = maps ? naverLatLng(maps, origin.lat, origin.lng) : null
      if (!maps || !center) {
        setMode('fallback')
        return
      }
      mapsRef.current = maps
      try {
        mapInstance = createNaverMapInstance(maps, canvasRef.current, center, 16)
      } catch {
        setMode('fallback')
        return
      }
      mapRef.current = mapInstance
      if (typeof maps.LatLngBounds === 'function' && typeof mapInstance.fitBounds === 'function') {
        try {
          const first = naverLatLng(maps, origin.lat, origin.lng)
          if (first) {
            const bounds = new maps.LatLngBounds(first, first)
            const extend = (bounds as { extend?: (coord: unknown) => void }).extend
            for (const spot of spotsRef.current) {
              const point = naverLatLng(maps, spot.lat, spot.lng)
              if (point) extend?.call(bounds, point)
            }
            mapInstance.fitBounds(bounds)
          }
        } catch {
          undefined
        }
      }
      paintPins(maps, mapInstance)
      refreshNaverMap(maps, mapInstance)
      setMode('naver')
    })()
    return () => {
      cancelled = true
      clearPins()
      detachNaverMap(liveNaverMaps(mapsRef.current), mapInstance || mapRef.current, [], canvasRef.current)
      mapRef.current = null
      mapsRef.current = null
    }
  }, [origin.lat, origin.lng])

  useEffect(() => {
    const map = mapRef.current
    const maps = liveNaverMaps(mapsRef.current)
    if (!map || !maps || mode !== 'naver') return
    paintPins(maps, map)
    focusSelected(maps, map, true)
  }, [selectedId, mode])

  if (mode === 'fallback') {
    const size = { width: 360, height: 220 }
    const center = latLngToWorld(origin.lat, origin.lng, 16)
    const originX = center.x - size.width / 2
    const originY = center.y - size.height / 2
    const toPx = (point: RidePoint) => {
      const world = latLngToWorld(point.lat, point.lng, 16)
      return { left: world.x - originX, top: world.y - originY }
    }
    const user = toPx(origin)
    return (
      <MapFrame className={className ?? 'h-[220px] rounded-[24px]'}>
        <div className="absolute inset-0 bg-[#dbe7ee]" />
        <span className="absolute z-10 h-3.5 w-3.5 rounded-full border-2 border-white bg-[#2563EB] shadow" style={{ left: user.left, top: user.top, transform: 'translate(-50%, -50%)' }} />
        {spots.map((spot, index) => {
          const px = toPx(spot)
          const selected = spot.id === selectedId
          return (
            <button
              key={spot.id}
              type="button"
              onClick={() => onSelect?.(spot.id)}
              className={`absolute z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[11px] font-black shadow ${selected ? 'scale-110 bg-[#4C1FB8] text-white' : 'bg-[#0F172A] text-white'}`}
              style={{ left: px.left, top: px.top, transform: 'translate(-50%, -100%)' }}
            >
              {index + 1}
            </button>
          )
        })}
      </MapFrame>
    )
  }

  return (
    <MapFrame className={className ?? 'h-[220px] rounded-[24px]'}>
      <div ref={hostRef} className="naver-map-host absolute inset-0 z-0">
        <div ref={canvasRef} className="naver-map-canvas h-full w-full touch-manipulation" style={{ width: '100%', height: '100%' }} />
      </div>
      {mode === 'loading' ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#dbe7ee]/80">
          <p className="rounded-full bg-white px-3 py-2 text-xs font-bold text-[#334155] shadow-sm">지도를 불러오는 중이에요</p>
        </div>
      ) : null}
      <MapControls
        onZoomIn={() => {
          const map = mapRef.current
          if (!map) return
          map.setZoom(Math.min(19, map.getZoom() + 1))
        }}
        onZoomOut={() => {
          const map = mapRef.current
          if (!map) return
          map.setZoom(Math.max(12, map.getZoom() - 1))
        }}
        onLocate={() => {
          const map = mapRef.current
          const maps = liveNaverMaps(mapsRef.current)
          if (!map || !maps) return
          const next = naverLatLng(maps, origin.lat, origin.lng)
          if (next) map.panTo(next)
          map.setZoom(16)
        }}
      />
      <p className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold text-[#334155] shadow-sm">내 위치 기준 가까운 지점</p>
    </MapFrame>
  )
}

function DeadNearbyServiceMap({
  originLat,
  originLng,
  spots,
  selectedId,
  onSelect,
  className,
}: {
  originLat: number
  originLng: number
  spots: DeadNearbyMapSpot[]
  selectedId?: string
  onSelect?: (id: string) => void
  className?: string
}) {
  const origin = isUsableCoord(originLat, originLng) ? { lat: originLat, lng: originLng } : null
  if (!origin) {
    return (
      <div className={`flex items-center justify-center overflow-hidden rounded-[24px] border-2 border-[#CBD5E1] bg-[#E2E8F0] ${className ?? 'h-[220px]'}`}>
        <p className="rounded-full bg-white px-3 py-2 text-xs font-bold text-[#334155] shadow-sm">현재 위치를 불러오는 중이에요</p>
      </div>
    )
  }
  return (
    <NaverNearbyServiceMap
      key={`nearby-${origin.lat.toFixed(5)}-${origin.lng.toFixed(5)}`}
      origin={origin}
      spots={spots}
      selectedId={selectedId}
      onSelect={onSelect}
      className={className}
    />
  )
}

