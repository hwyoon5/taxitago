'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, LocateFixed, MapPin } from 'lucide-react'
import { ADDRESS_LOADING, fallbackCoordAddress, lookupAddressFromApi } from '@/lib/geocode-client'
import { loadNaverMaps, refreshNaverMap, waitForMapSize, type NaverMapInstance, type NaverMapsSdk } from '@/lib/naver-maps'
import { watchMapSettle } from '@/lib/watch-map-settle'

export type PickedPlace = { lat: number; lng: number; address: string }

type PlacePickerScreenProps = {
  lat: number
  lng: number
  address?: string
  variant: 'pickup' | 'dest'
  onClose: () => void
  onConfirm: (place: PickedPlace) => void
}

function isUsableAddress(value?: string) {
  const label = (value || '').trim()
  if (!label || label === ADDRESS_LOADING) return false
  return !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(label)
}

export function PlacePickerScreen({
  lat,
  lng,
  address,
  variant,
  onClose,
  onConfirm,
}: PlacePickerScreenProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<NaverMapInstance | null>(null)
  const mapsRef = useRef<NaverMapsSdk | null>(null)
  const centerRef = useRef({ lat, lng })
  const lookupIdRef = useRef(0)
  const initialReady = isUsableAddress(address)
  const [label, setLabel] = useState(initialReady ? (address as string).trim() : ADDRESS_LOADING)
  const [looking, setLooking] = useState(!initialReady)
  const isDest = variant === 'dest'

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    let cancelled = false
    let map: NaverMapInstance | null = null
    let stopWatch: (() => void) | null = null
    let resizeObserver: ResizeObserver | null = null
    const timers: number[] = []

    const fit = () => {
      const sdk = mapsRef.current
      const live = mapRef.current
      const node = canvasRef.current
      if (!sdk || !live || !node) return
      refreshNaverMap(sdk, live, node)
    }

    void (async () => {
      await waitForMapSize(host)
      await waitForMapSize(canvas)
      if (cancelled) return
      const sdk = await loadNaverMaps()
      if (cancelled || !canvasRef.current || !sdk?.Map) return
      const node = canvasRef.current
      node.style.width = `${Math.max(node.clientWidth, host.clientWidth, window.innerWidth)}px`
      node.style.height = `${Math.max(node.clientHeight, host.clientHeight, window.innerHeight)}px`
      map = new sdk.Map(node, {
        center: new sdk.LatLng(lat, lng),
        zoom: 16,
        scaleControl: false,
        mapDataControl: false,
        zoomControl: false,
        disableDoubleClickZoom: true,
        draggable: true,
        pinchZoom: true,
        scrollWheel: true,
      })
      mapRef.current = map
      mapsRef.current = sdk
      stopWatch = watchMapSettle(map, sdk, host, (center) => {
        if (cancelled) return
        const requestId = ++lookupIdRef.current
        setLooking(true)
        setLabel(ADDRESS_LOADING)
        void lookupAddressFromApi(center.lat, center.lng).then((nextAddress) => {
          if (cancelled || requestId !== lookupIdRef.current) return
          centerRef.current = center
          setLabel(nextAddress)
          setLooking(false)
        })
      })
      refreshNaverMap(sdk, map, node)
      resizeObserver = new ResizeObserver(() => fit())
      resizeObserver.observe(host)
      window.addEventListener('orientationchange', fit)
      timers.push(window.setTimeout(fit, 60), window.setTimeout(fit, 240), window.setTimeout(fit, 640))
    })()

    return () => {
      cancelled = true
      lookupIdRef.current += 1
      resizeObserver?.disconnect()
      window.removeEventListener('orientationchange', fit)
      timers.forEach((id) => window.clearTimeout(id))
      stopWatch?.()
      try {
        map?.destroy?.()
      } catch {
        undefined
      }
      mapRef.current = null
      mapsRef.current = null
      canvas.replaceChildren()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goInitial = () => {
    const sdk = mapsRef.current
    const map = mapRef.current
    if (!sdk || !map) return
    try {
      map.panTo(new sdk.LatLng(lat, lng))
    } catch {
      undefined
    }
  }

  const confirm = () => {
    const current = centerRef.current
    onConfirm({
      lat: current.lat,
      lng: current.lng,
      address: looking || !isUsableAddress(label) ? fallbackCoordAddress(current.lat, current.lng) : label.trim(),
    })
  }

  return (
    <div className="fixed inset-0 z-[100] bg-[#E2E8F0]" role="dialog" aria-modal="true" aria-label={isDest ? '목적지 지도' : '출발지 지도'} style={{ width: '100%', height: '100%' }}>
      <div
        ref={hostRef}
        className="naver-map-host absolute inset-0 z-0"
        style={{ width: '100%', height: '100%', minWidth: '100%', minHeight: '100%', backgroundColor: '#dbe7ee' }}
      >
        <div
          ref={canvasRef}
          className="naver-map-canvas h-full w-full touch-manipulation"
          style={{ width: '100%', height: '100%', minWidth: '100%', minHeight: '100%' }}
        />
      </div>
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full">
        <MapPin className="h-10 w-10 text-[#4C1FB8] drop-shadow-[0_6px_10px_rgba(15,23,42,0.35)]" />
      </div>
      <button
        type="button"
        data-map-ui="true"
        onClick={onClose}
        className="absolute left-4 top-[max(0.9rem,env(safe-area-inset-top))] z-20 inline-flex min-h-10 items-center gap-0.5 rounded-full bg-white/95 px-3.5 pr-4 text-[13px] font-black text-[#0F172A] shadow-[0_8px_20px_rgba(15,23,42,0.18)]"
        aria-label="뒤로가기"
      >
        <ChevronLeft className="h-5 w-5" />
        뒤로가기
      </button>
      <button
        type="button"
        data-map-ui="true"
        onClick={goInitial}
        className="absolute right-4 top-[max(0.9rem,env(safe-area-inset-top))] z-20 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#4C1FB8] shadow-[0_8px_20px_rgba(15,23,42,0.18)]"
        aria-label="처음 위치로"
      >
        <LocateFixed className="h-5 w-5" />
      </button>
      <div data-map-ui="true" className={`absolute inset-x-3 z-20 ${isDest ? 'bottom-[max(1rem,env(safe-area-inset-bottom))]' : 'top-[max(4.4rem,calc(env(safe-area-inset-top)+3.4rem))]'}`}>
        <div className="rounded-2xl border border-[#E2E8F0] bg-white px-4 py-3.5 shadow-[0_12px_24px_rgba(15,23,42,0.16)]">
          <p className="text-[11px] font-black text-[#4C1FB8]">{isDest ? '선택한 목적지' : '현재 지도 위치'}</p>
          <p className="mt-1 text-[15px] font-black leading-snug text-[#0F172A]">{looking ? ADDRESS_LOADING : label}</p>
          <p className="mt-1 text-[11px] font-bold text-[#64748B]">
            {looking ? ADDRESS_LOADING : '지도를 움직이면 주소가 바로 바뀝니다'}
          </p>
          <button type="button" onClick={confirm} className="mt-3 w-full rounded-2xl bg-[#4C1FB8] py-3 text-sm font-black text-white">
            {isDest ? '이 주소로 선택' : '이 위치를 출발지로 지정'}
          </button>
        </div>
      </div>
    </div>
  )
}
