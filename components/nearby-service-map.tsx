'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { LocateFixed, Minus, Plus } from 'lucide-react'
import { loadNaverMaps, type NaverMapInstance, type NaverMarker } from '@/lib/naver-maps'
import { isUsableCoord } from '@/lib/ride-session'
import { BUSAN_CITY_HALL } from '@/lib/user-location'

export type NearbyMapSpot = {
  id: string
  name: string
  lat: number
  lng: number
}

const MAP_HEIGHT = 160

function naverMapsApi() {
  return typeof window === 'undefined' ? undefined : window.naver?.maps
}

function pinButton(index: number, selected: boolean) {
  const el = document.createElement('button')
  el.type = 'button'
  el.textContent = String(index + 1)
  el.style.cssText = `display:flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:9999px;outline:2px solid #fff;font-size:11px;font-weight:800;cursor:pointer;box-shadow:0 6px 14px rgba(15,23,42,.22);background:${selected ? '#4C1FB8' : '#0F172A'};color:#fff`
  return el
}

function userDot() {
  const el = document.createElement('div')
  el.style.cssText = 'width:18px;height:18px;border-radius:9999px;border:2px solid #fff;background:#2563EB;box-shadow:0 0 0 6px rgba(37,99,235,.22)'
  return el
}

function forceMapResize(map: NaverMapInstance | null, el: HTMLElement | null) {
  const maps = naverMapsApi()
  if (!maps || !map || !el) return
  const width = Math.max(el.clientWidth, el.offsetWidth, 1)
  const height = Math.max(el.clientHeight, el.offsetHeight, MAP_HEIGHT)
  try {
    if (typeof maps.Size === 'function') map.setSize?.(new maps.Size(width, height))
  } catch {
    undefined
  }
  try {
    maps.Event?.trigger(map, 'resize')
  } catch {
    undefined
  }
  try {
    map.autoResize?.()
  } catch {
    undefined
  }
}

export function NearbyServiceMap({
  originLat,
  originLng,
  spots,
  selectedId,
  focusId,
  onSelect,
  className,
}: {
  originLat: number
  originLng: number
  spots: NearbyMapSpot[]
  selectedId?: string
  focusId?: string
  onSelect?: (id: string) => void
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<NaverMapInstance | null>(null)
  const markersRef = useRef<NaverMarker[]>([])
  const listenersRef = useRef<unknown[]>([])
  const spotsRef = useRef(spots)
  const selectedRef = useRef(selectedId)
  const selectRef = useRef(onSelect)
  const originRef = useRef({
    lat: isUsableCoord(originLat, originLng) ? originLat : BUSAN_CITY_HALL.lat,
    lng: isUsableCoord(originLat, originLng) ? originLng : BUSAN_CITY_HALL.lng,
  })
  spotsRef.current = spots
  selectedRef.current = selectedId
  selectRef.current = onSelect
  originRef.current = {
    lat: isUsableCoord(originLat, originLng) ? originLat : BUSAN_CITY_HALL.lat,
    lng: isUsableCoord(originLat, originLng) ? originLng : BUSAN_CITY_HALL.lng,
  }

  const clearMarkers = () => {
    const maps = naverMapsApi()
    for (const listener of listenersRef.current) {
      try {
        maps?.Event?.removeListener(listener)
      } catch {
        undefined
      }
    }
    listenersRef.current = []
    for (const marker of markersRef.current) {
      try {
        marker.setMap(null)
      } catch {
        undefined
      }
    }
    markersRef.current = []
  }

  const paintMarkers = (map: NaverMapInstance) => {
    const maps = naverMapsApi()
    if (!maps?.Marker || !maps.LatLng || !maps.Point) return
    clearMarkers()
    const here = originRef.current
    const user = new maps.Marker({
      map,
      position: new maps.LatLng(here.lat, here.lng),
      clickable: false,
      zIndex: 80,
      icon: { content: userDot(), size: new maps.Point(18, 18), anchor: new maps.Point(9, 9) },
    })
    markersRef.current.push(user)
    spotsRef.current.forEach((spot, index) => {
      const selected = spot.id === selectedRef.current
      const marker = new maps.Marker({
        map,
        position: new maps.LatLng(spot.lat, spot.lng),
        clickable: true,
        zIndex: selected ? 220 : 120,
        icon: { content: pinButton(index, selected), size: new maps.Point(28, 28), anchor: new maps.Point(14, 28) },
      })
      const listener = maps.Event?.addListener(marker, 'click', () => selectRef.current?.(spot.id))
      if (listener) listenersRef.current.push(listener)
      markersRef.current.push(marker)
    })
  }

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.style.width = '100%'
    el.style.height = `${MAP_HEIGHT}px`
    el.style.minHeight = `${MAP_HEIGHT}px`
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let cancelled = false
    let map: NaverMapInstance | null = null
    const timers: number[] = []

    const resize = () => {
      if (cancelled) return
      forceMapResize(mapRef.current, containerRef.current)
    }

    const createMap = async () => {
      await loadNaverMaps()
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      if (cancelled) return
      const box = containerRef.current
      const maps = naverMapsApi()
      if (!box || !maps?.Map || typeof maps.LatLng !== 'function') return
      box.style.width = `${Math.max(box.clientWidth, box.parentElement?.clientWidth || 0, 320)}px`
      box.style.height = `${MAP_HEIGHT}px`
      const center = new maps.LatLng(originRef.current.lat, originRef.current.lng)
      map = new maps.Map(box, {
        center,
        zoom: 16,
        scaleControl: false,
        mapDataControl: false,
        zoomControl: false,
        draggable: true,
        pinchZoom: true,
        scrollWheel: true,
      })
      mapRef.current = map
      paintMarkers(map)
      resize()
      timers.push(window.setTimeout(resize, 0))
      timers.push(window.setTimeout(resize, 80))
      timers.push(window.setTimeout(resize, 250))
      timers.push(window.setTimeout(resize, 700))
    }

    void createMap()
    return () => {
      cancelled = true
      timers.forEach((timer) => window.clearTimeout(timer))
      clearMarkers()
      try {
        naverMapsApi()?.Event?.clearInstanceListeners?.(map)
      } catch {
        undefined
      }
      try {
        map?.destroy?.()
      } catch {
        undefined
      }
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    paintMarkers(map)
    forceMapResize(map, containerRef.current)
  }, [selectedId, spots])

  useEffect(() => {
    const map = mapRef.current
    const maps = naverMapsApi()
    if (!map || !maps?.LatLng || !focusId) return
    const target = spotsRef.current.find((spot) => spot.id === focusId) ?? originRef.current
    try {
      map.panTo(new maps.LatLng(target.lat, target.lng))
    } catch {
      undefined
    }
    forceMapResize(map, containerRef.current)
  }, [focusId])

  useEffect(() => {
    const map = mapRef.current
    const maps = naverMapsApi()
    if (!map || !maps?.LatLng) return
    try {
      map.setCenter(new maps.LatLng(originRef.current.lat, originRef.current.lng))
    } catch {
      undefined
    }
    forceMapResize(map, containerRef.current)
  }, [originLat, originLng])

  return (
    <div className={`relative w-full overflow-hidden bg-[#dbe7ee] ${className ?? ''}`} style={{ height: MAP_HEIGHT, minHeight: MAP_HEIGHT }}>
      <div
        ref={containerRef}
        className="service-naver-map-host absolute inset-0 z-0"
        style={{ width: '100%', height: MAP_HEIGHT, minHeight: MAP_HEIGHT }}
      />
      <div className="pointer-events-none absolute right-3 top-3 z-20 flex flex-col overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-md">
        <button
          type="button"
          className="pointer-events-auto flex h-9 w-9 items-center justify-center text-[#4C1FB8]"
          aria-label="확대"
          onClick={() => {
            const map = mapRef.current
            if (!map) return
            map.setZoom(Math.min(19, map.getZoom() + 1))
            forceMapResize(map, containerRef.current)
          }}
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="pointer-events-auto flex h-9 w-9 items-center justify-center border-t border-[#E2E8F0] text-[#4C1FB8]"
          aria-label="축소"
          onClick={() => {
            const map = mapRef.current
            if (!map) return
            map.setZoom(Math.max(12, map.getZoom() - 1))
            forceMapResize(map, containerRef.current)
          }}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="pointer-events-auto flex h-9 w-9 items-center justify-center border-t border-[#E2E8F0] text-[#4C1FB8]"
          aria-label="내 위치"
          onClick={() => {
            const map = mapRef.current
            const maps = naverMapsApi()
            if (!map || !maps?.LatLng) return
            map.panTo(new maps.LatLng(originRef.current.lat, originRef.current.lng))
            forceMapResize(map, containerRef.current)
          }}
        >
          <LocateFixed className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
