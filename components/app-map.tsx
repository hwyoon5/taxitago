'use client'

import { useEffect, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from 'react'
import { Car, LocateFixed, MapPin, Minus, Plus, UserRound } from 'lucide-react'
import {
  applyMapBottomInset,
  createDomMarker,
  createHtmlOverlay,
  hasNaverMapClientId,
  loadNaverMaps,
  refreshNaverMap,
  trackMapPoint,
  waitForMapSize,
  type MapHtmlPin,
  type NaverMapInstance,
  type NaverMapsSdk,
  type NaverMarker,
  type NaverPolyline,
} from '@/lib/naver-maps'

export const SEOUL_CITY_HALL = { lat: 37.5665, lng: 126.978, label: '서울시청' }

const TILE_SIZE = 256

export type TaxiLivePhase = 'arriving' | 'boarding' | 'moving'
export type TaxiMatchPhase = 'searching' | TaxiLivePhase
export type RidePoint = { lat: number; lng: number }

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

function fitRideBounds(sdk: NaverMapsSdk, map: NaverMapInstance, origin: RidePoint, dest: RidePoint) {
  const mid = lerpPoint(origin, dest, 0.5)
  const span = Math.max(Math.abs(dest.lat - origin.lat), Math.abs(dest.lng - origin.lng))
  if (span < 0.0008) {
    map.setCenter(new sdk.LatLng(mid.lat, mid.lng))
    map.setZoom(16)
    return
  }
  if (sdk.LatLngBounds && map.fitBounds) {
    const sw = new sdk.LatLng(Math.min(origin.lat, dest.lat), Math.min(origin.lng, dest.lng))
    const ne = new sdk.LatLng(Math.max(origin.lat, dest.lat), Math.max(origin.lng, dest.lng))
    map.fitBounds(new sdk.LatLngBounds(sw, ne), { top: 56, right: 48, bottom: 56, left: 48 })
    return
  }
  map.setCenter(new sdk.LatLng(mid.lat, mid.lng))
  map.setZoom(span > 0.08 ? 12 : span > 0.03 ? 13 : 15)
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
  onPick?: (lat: number, lng: number) => void
  onActivate?: () => void
  onLocate?: () => void
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
      <div className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-3 z-20 flex flex-col items-end gap-2">
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

function StartPulsePin() {
  return (
    <span className="tt-start-pin">
      <span className="tt-start-halo" />
      <span className="tt-start-dot" />
      <span className="tt-start-balloon">출발</span>
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
  onPick,
  onActivate,
  onLocate,
  onZoomIn,
  onZoomOut,
  notice,
  children,
}: MapViewProps & { zoom: number; onZoomIn: () => void; onZoomOut: () => void; notice?: string; children?: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState({ lat, lng })
  const panRef = useRef({ active: false, x: 0, y: 0, lat, lng, moved: false })
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef(0)

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
    onPick(point.lat, point.lng)
  }

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 touch-none overflow-hidden"
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
        setView(worldToLatLng(start.x - (event.clientX - panRef.current.x), start.y - (event.clientY - panRef.current.y), zoom))
      }}
      onPointerUp={(event) => {
        const tapped = panRef.current.active && !panRef.current.moved && pointersRef.current.size <= 1
        pointersRef.current.delete(event.pointerId)
        if (pointersRef.current.size < 2) pinchRef.current = 0
        if (pointersRef.current.size === 0) panRef.current.active = false
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
      {!hidePin ? (
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
          }}
        />
      ) : null}
    </div>
  )
}

function NaverLocationMap(props: MapViewProps) {
  const { lat, lng, pinLat, pinLng, className, interactive, pulsePin, hidePin, showZoom, bottomInset = 0, locatePlacement = 'stacked', onPick, onActivate, onLocate } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<NaverMapInstance | null>(null)
  const mapsRef = useRef<NaverMapsSdk | null>(null)
  const pinRef = useRef<MapHtmlPin | null>(null)
  const pickRef = useRef(onPick)
  const activateRef = useRef(onActivate)
  const insetRef = useRef(bottomInset)
  const centerRef = useRef({ lat, lng, pinLat, pinLng })
  const [mode, setMode] = useState<'loading' | 'naver' | 'fallback'>(hasNaverMapClientId() ? 'loading' : 'fallback')
  const [zoom, setZoom] = useState(15)
  const [pinScreen, setPinScreen] = useState<{ x: number; y: number } | null>(null)
  const [loadNotice, setLoadNotice] = useState<string | undefined>()
  pickRef.current = onPick
  activateRef.current = onActivate
  insetRef.current = bottomInset
  centerRef.current = { lat, lng, pinLat, pinLng }
  useNaverResize(mapsRef, mapRef, hostRef)

  useEffect(() => {
    if (!hasNaverMapClientId()) {
      setMode('fallback')
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    let clickListener: unknown
    let zoomListener: unknown
    void (async () => {
      await waitForMapSize(canvas)
      const sdk = await loadNaverMaps()
      if (cancelled || !canvasRef.current) return
      if (!sdk?.Map) {
        setLoadNotice('네이버 지도를 불러오지 못해 대체 지도를 표시합니다.')
        setMode('fallback')
        return
      }
      mapsRef.current = sdk
      const center = centerRef.current
      const map = new sdk.Map(canvasRef.current, {
        center: new sdk.LatLng(center.lat, center.lng),
        zoom: 15,
        scaleControl: false,
        mapDataControl: false,
        zoomControl: false,
        disableDoubleClickZoom: false,
        draggable: true,
        pinchZoom: true,
        scrollWheel: true,
        keyboardShortcuts: true,
      })
      mapRef.current = map
      if (!hidePin) {
        pinRef.current = trackMapPoint(sdk, map, center.pinLat ?? center.lat, center.pinLng ?? center.lng, (x, y) => {
          if (!cancelled) setPinScreen({ x, y })
        })
      }
      applyMapBottomInset(sdk, map, center.lat, center.lng, 0)
      window.requestAnimationFrame(() => {
        map.panTo(new sdk.LatLng(center.lat, center.lng))
      })
      clickListener = interactive
        ? sdk.Event.addListener(map, 'click', (event) => {
            if (activateRef.current && !pickRef.current) {
              activateRef.current()
              return
            }
            const eventPoint = event as { coord?: { lat: () => number; lng: () => number; y?: number; x?: number }; latlng?: { lat: () => number; lng: () => number } }
            const coord = eventPoint.coord ?? eventPoint.latlng
            if (!coord) return
            const nextLat = typeof coord.lat === 'function' ? coord.lat() : Number.NaN
            const nextLng = typeof coord.lng === 'function' ? coord.lng() : Number.NaN
            if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return
            pickRef.current?.(nextLat, nextLng)
          })
        : undefined
      zoomListener = sdk.Event.addListener(map, 'zoom_changed', () => pinRef.current?.draw?.())
      refreshNaverMap(sdk, map)
      window.setTimeout(() => refreshNaverMap(sdk, map), 80)
      window.setTimeout(() => {
        refreshNaverMap(sdk, map)
        pinRef.current?.draw?.()
      }, 400)
      setMode('naver')
    })()
    return () => {
      cancelled = true
      if (clickListener && mapsRef.current) mapsRef.current.Event.removeListener(clickListener)
      if (zoomListener && mapsRef.current) mapsRef.current.Event.removeListener(zoomListener)
      pinRef.current?.setMap(null)
      pinRef.current = null
      mapRef.current?.destroy?.()
      mapRef.current = null
    }
  }, [hidePin, interactive, pulsePin, showZoom])

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
    if (!map || !sdk || mode !== 'naver') return
    map.panTo(new sdk.LatLng(lat, lng))
    pinRef.current?.draw?.()
  }, [lat, lng, mode])

  useEffect(() => {
    pinRef.current?.setPosition(pinLat ?? lat, pinLng ?? lng)
  }, [lat, lng, pinLat, pinLng])

  const changeNaverZoom = (delta: number) => {
    const map = mapRef.current
    if (!map) return
    map.setZoom(Math.min(19, Math.max(11, map.getZoom() + delta)))
    refreshNaverMap(mapsRef.current, map)
    pinRef.current?.draw?.()
  }

  return (
    <MapFrame className={className}>
      {mode !== 'fallback' ? (
        <div ref={hostRef} className="naver-map-host absolute inset-0">
          <div ref={canvasRef} className="naver-map-canvas h-full w-full touch-manipulation" style={{ width: '100%', height: '100%' }} />
          {!hidePin && pinScreen ? <FixedMapPin pulse={Boolean(pulsePin)} x={pinScreen.x} y={pinScreen.y} /> : null}
        </div>
      ) : (
        <FallbackSlippyMap
          {...props}
          zoom={zoom}
          onZoomIn={() => setZoom((value) => Math.min(18, value + 1))}
          onZoomOut={() => setZoom((value) => Math.max(12, value - 1))}
          notice={loadNotice}
        />
      )}
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
            map.panTo(new sdk.LatLng(lat, lng))
            pinRef.current?.draw?.()
            onLocate?.()
          }}
        />
      ) : null}
    </MapFrame>
  )
}

export function LocationTileMap(props: MapViewProps) {
  return <NaverLocationMap {...props} />
}

function LiveFallbackOverlay({
  phase,
  kind,
  taxi,
  origin,
  dest,
  zoom,
  size,
}: {
  phase: TaxiLivePhase
  kind: 'taxi' | 'daeri'
  taxi: RidePoint & { angle: number }
  origin: RidePoint
  dest: RidePoint
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
  const d = `M ${start.left} ${start.top} L ${end.left} ${end.top}`
  if (size.width < 8) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-[6]">
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        <path d={d} fill="none" stroke="#4A82B8" strokeWidth="2" strokeLinecap="round" strokeDasharray="8 7" strokeOpacity="0.88" />
      </svg>
      <span className="absolute rounded-full bg-[#0F172A] px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ left: start.left, top: start.top, transform: 'translate(-50%, -140%)' }}>
        출발
      </span>
      <span className="absolute rounded-full bg-[#1D4ED8] px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ left: end.left, top: end.top, transform: 'translate(-50%, -140%)' }}>
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
  originLabel,
  destLabel,
  className,
}: {
  phase: TaxiLivePhase
  kind: 'taxi' | 'daeri'
  taxi: RidePoint & { angle: number }
  origin: RidePoint
  dest: RidePoint
  originLabel?: string
  destLabel?: string
  className?: string
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
  const mid = lerpPoint(origin, dest, 0.5)
  const [mode, setMode] = useState<'loading' | 'naver' | 'fallback'>(hasNaverMapClientId() ? 'loading' : 'fallback')
  const [zoom, setZoom] = useState(15)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [loadNotice, setLoadNotice] = useState<string | undefined>()
  useNaverResize(mapsRef, mapRef, hostRef)

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
    if (!hasNaverMapClientId()) {
      setMode('fallback')
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    void (async () => {
      await waitForMapSize(canvas)
      const sdk = await loadNaverMaps()
      if (cancelled || !canvasRef.current) return
      if (!sdk?.Map) {
        setLoadNotice('네이버 지도를 불러오지 못해 대체 지도를 표시합니다.')
        setMode('fallback')
        return
      }
      mapsRef.current = sdk
      const map = new sdk.Map(canvasRef.current, {
        center: new sdk.LatLng(mid.lat, mid.lng),
        zoom: 15,
        scaleControl: false,
        mapDataControl: false,
        zoomControl: false,
        draggable: true,
        pinchZoom: true,
        scrollWheel: true,
      })
      mapRef.current = map
      fitRideBounds(sdk, map, origin, dest)
      lineRef.current = new sdk.Polyline({
        map,
        path: [new sdk.LatLng(origin.lat, origin.lng), new sdk.LatLng(dest.lat, dest.lng)],
        strokeColor: '#4A82B8',
        strokeWeight: 2,
        strokeOpacity: 0.88,
        strokeStyle: 'dash',
        strokeDashPattern: [8, 7],
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
      })
      const startLabel = document.createElement('div')
      startLabel.style.cssText = 'white-space:nowrap;writing-mode:horizontal-tb;width:max-content;border-radius:9999px;background:#0F172A;color:#fff;padding:2px 6px;font-size:9px;font-weight:700'
      startLabel.textContent = originLabel || '출발'
      const endLabel = document.createElement('div')
      endLabel.style.cssText = 'white-space:nowrap;writing-mode:horizontal-tb;width:max-content;border-radius:9999px;background:#1D4ED8;color:#fff;padding:2px 6px;font-size:9px;font-weight:700'
      endLabel.textContent = destLabel || '도착'
      startPinRef.current = createHtmlOverlay(sdk, map, startLabel, origin.lat, origin.lng, 'translate(-50%, -120%)')
      endPinRef.current = createHtmlOverlay(sdk, map, endLabel, dest.lat, dest.lng, 'translate(-50%, -120%)')
      const mover = document.createElement('div')
      mover.style.willChange = 'transform'
      mover.innerHTML = markerHtml(walker)
      moverEl.current = mover
      moverRef.current = createDomMarker(sdk, map, mover, taxi.lat, taxi.lng, 14, 14)
      refreshNaverMap(sdk, map)
      window.requestAnimationFrame(() => fitRideBounds(sdk, map, origin, dest))
      window.setTimeout(() => {
        fitRideBounds(sdk, map, origin, dest)
        refreshNaverMap(sdk, map)
      }, 80)
      window.setTimeout(() => refreshNaverMap(sdk, map), 400)
      setMode('naver')
    })()
    return () => {
      cancelled = true
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
  }, [kind, walker, origin.lat, origin.lng, dest.lat, dest.lng, originLabel, destLabel])

  useEffect(() => {
    const marker = moverRef.current
    const el = moverEl.current
    const sdk = mapsRef.current
    if (!marker || !sdk || mode !== 'naver') return
    if (el) el.style.transform = `rotate(${walker ? 0 : taxi.angle}deg)`
    marker.setPosition(new sdk.LatLng(taxi.lat, taxi.lng))
  }, [taxi, walker, mode])

  return (
    <MapFrame className={className}>
      <div ref={hostRef} className="naver-map-host absolute inset-0">
        {mode !== 'fallback' ? <div ref={canvasRef} className="naver-map-canvas h-full w-full" style={{ width: '100%', height: '100%' }} /> : null}
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
            <LiveFallbackOverlay phase={phase} kind={kind} taxi={taxi} origin={origin} dest={dest} zoom={zoom} size={size} />
          </FallbackSlippyMap>
        ) : null}
      </div>
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
  routeLabel,
  statusLabel,
  kind = 'taxi',
  originLat,
  originLng,
  destLat,
  destLng,
  originLabel,
  destLabel,
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
}) {
  const origin = { lat: originLat, lng: originLng }
  const dest = resolveRideDestination(origin, destLat, destLng) ?? origin
  const [taxi, setTaxi] = useState(() => vehicleOnRide(phase, origin, dest, phase === 'boarding' ? 1 : 0))

  useEffect(() => {
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
  }, [phase, origin.lat, origin.lng, dest.lat, dest.lng])

  return (
    <div className="relative mt-4 overflow-hidden rounded-[24px] border-2 border-[#CBD5E1] bg-[#E2E8F0]">
      <NaverLiveRideMap
        phase={phase}
        kind={kind}
        taxi={taxi}
        origin={origin}
        dest={dest}
        originLabel={originLabel}
        destLabel={destLabel}
        className="h-[248px]"
      />
      <div className="pointer-events-none absolute inset-x-3 top-3 z-[15] mr-14 flex items-center justify-between rounded-2xl bg-white/95 px-3 py-2 shadow-[0_8px_18px_rgba(15,23,42,0.12)]">
        <p className="truncate pr-2 text-xs font-bold text-[#0F172A]">{routeLabel}</p>
        <span className="shrink-0 rounded-full bg-[#4A82B8] px-2 py-1 text-[10px] font-bold text-white">{statusLabel}</span>
      </div>
      <div className="absolute bottom-3 left-3 z-[15] flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold text-[#334155] shadow-sm">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#4A82B8]" />
        {phase === 'arriving' ? (kind === 'daeri' ? '기사 → 호출자 이동 중' : '기사 → 승객 이동 중') : phase === 'boarding' ? (kind === 'daeri' ? '호출자 위치 도착' : '픽업 지점 도착') : '출발지 → 목적지 주행 중'}
      </div>
    </div>
  )
}

