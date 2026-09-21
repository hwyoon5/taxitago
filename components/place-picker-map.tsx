'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, LocateFixed, MapPin } from 'lucide-react'
import { useLocale } from '@/components/locale-provider'
import { lookupAddressFromApi } from '@/lib/geocode-client'
import { loadNaverMaps, waitForMapSize, type NaverMapInstance, type NaverMapsSdk } from '@/lib/naver-maps'

export type PickedPlace = { lat: number; lng: number; address: string }

function readCenter(map: NaverMapInstance | null): PickedPlace | null {
  if (!map || typeof map.getCenter !== 'function') return null
  try {
    const raw = map.getCenter() as { lat?: unknown; lng?: unknown } | null
    if (!raw) return null
    const lat = typeof raw.lat === 'function' ? Number((raw.lat as () => number)()) : Number(raw.lat)
    const lng = typeof raw.lng === 'function' ? Number((raw.lng as () => number)()) : Number(raw.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng, address: '' }
  } catch {
    return null
  }
}

export function PlacePickerScreen({
  lat,
  lng,
  address,
  variant,
  onClose,
  onConfirm,
}: {
  lat: number
  lng: number
  address?: string
  variant: 'pickup' | 'dest'
  onClose: () => void
  onConfirm: (place: PickedPlace) => void
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<NaverMapInstance | null>(null)
  const mapsRef = useRef<NaverMapsSdk | null>(null)
  const centerRef = useRef({ lat, lng })
  const lookupIdRef = useRef(0)
  const [label, setLabel] = useState(address?.trim() || '이 위치의 주소를 확인하는 중')
  const [looking, setLooking] = useState(!address?.trim())
  const isDest = variant === 'dest'

  const lookup = (nextLat: number, nextLng: number) => {
    centerRef.current = { lat: nextLat, lng: nextLng }
    const id = ++lookupIdRef.current
    setLooking(true)
    void lookupAddressFromApi(nextLat, nextLng)
      .then((next) => {
        if (id !== lookupIdRef.current) return
        setLabel(next)
        setLooking(false)
      })
      .catch(() => {
        if (id !== lookupIdRef.current) return
        setLabel(`${nextLat.toFixed(5)}, ${nextLng.toFixed(5)}`)
        setLooking(false)
      })
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    let listener: unknown = null
    let map: NaverMapInstance | null = null

    void (async () => {
      await waitForMapSize(canvas)
      if (cancelled) return
      const sdk = await loadNaverMaps()
      if (cancelled || !canvasRef.current) return
      if (!sdk?.Map) {
        lookup(lat, lng)
        return
      }
      canvasRef.current.replaceChildren()
      map = new sdk.Map(canvasRef.current, {
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
      listener = sdk.Event.addListener(map, 'idle', () => {
        if (cancelled) return
        const center = readCenter(map)
        if (!center) return
        lookup(center.lat, center.lng)
      })
    })()

    return () => {
      cancelled = true
      lookupIdRef.current += 1
      const sdk = mapsRef.current
      try {
        if (listener != null) sdk?.Event.removeListener(listener)
      } catch {
        undefined
      }
      try {
        if (map) sdk?.Event.clearInstanceListeners?.(map)
      } catch {
        undefined
      }
      try {
        map?.destroy?.()
      } catch {
        undefined
      }
      mapRef.current = null
      mapsRef.current = null
      canvas.replaceChildren()
    }
    // Fresh instance per modal open (parent remounts with a new key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goInitial = () => {
    const sdk = mapsRef.current
    const map = mapRef.current
    if (!sdk || !map) {
      lookup(lat, lng)
      return
    }
    try {
      map.panTo(new sdk.LatLng(lat, lng))
    } catch {
      lookup(lat, lng)
    }
  }

  const confirm = () => {
    const current = centerRef.current
    onConfirm({
      lat: current.lat,
      lng: current.lng,
      address: label.trim() || `${current.lat.toFixed(5)}, ${current.lng.toFixed(5)}`,
    })
  }

  return (
    <div className="fixed inset-0 z-[100] bg-[#0B1220]" role="dialog" aria-modal="true" aria-label={isDest ? '목적지 지도' : '출발지 지도'}>
      <div ref={canvasRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full">
        <MapPin className="h-10 w-10 text-[#4C1FB8] drop-shadow-[0_6px_10px_rgba(15,23,42,0.35)]" />
      </div>
      <button
        type="button"
        onClick={onClose}
        className="absolute left-4 top-[max(0.9rem,env(safe-area-inset-top))] z-20 inline-flex min-h-10 items-center gap-0.5 rounded-full bg-white/95 px-3.5 pr-4 text-[13px] font-black text-[#0F172A] shadow-[0_8px_20px_rgba(15,23,42,0.18)]"
        aria-label="뒤로가기"
      >
        <ChevronLeft className="h-5 w-5" />
        뒤로가기
      </button>
      <button
        type="button"
        onClick={goInitial}
        className="absolute right-4 top-[max(0.9rem,env(safe-area-inset-top))] z-20 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#4C1FB8] shadow-[0_8px_20px_rgba(15,23,42,0.18)]"
        aria-label="처음 위치로"
      >
        <LocateFixed className="h-5 w-5" />
      </button>
      <div className={`absolute inset-x-3 z-20 ${isDest ? 'bottom-[max(1rem,env(safe-area-inset-bottom))]' : 'top-[max(4.4rem,calc(env(safe-area-inset-top)+3.4rem))]'}`}>
        <div className="rounded-2xl border border-[#E2E8F0] bg-white px-4 py-3.5 shadow-[0_12px_24px_rgba(15,23,42,0.16)]">
          <p className="text-[11px] font-black text-[#4C1FB8]">{isDest ? '선택한 목적지' : '현재 지도 위치'}</p>
          <p className="mt-1 text-[15px] font-black leading-snug text-[#0F172A]">{label}</p>
          <p className="mt-1 text-[11px] font-bold text-[#64748B]">
            {looking ? '지도 중심에 맞춰 주소를 갱신하는 중' : '지도를 움직이면 주소가 바로 바뀝니다'}
          </p>
          <button
            type="button"
            onClick={confirm}
            className="mt-3 w-full rounded-2xl bg-[#4C1FB8] py-3 text-sm font-black text-white"
          >
            {isDest ? '이 주소로 선택' : '이 위치를 출발지로 지정'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function PickupLocationBar({
  address,
  status,
  fromMap,
  onOpenMap,
  onRetryGps,
}: {
  address: string
  status: 'pending' | 'ready' | 'approx' | string
  fromMap: boolean
  onOpenMap: () => void
  onRetryGps: () => void
}) {
  const { t } = useLocale()
  const ready = fromMap || status === 'ready'
  return (
    <div
      className={`mt-3 flex min-h-10 items-center gap-2 rounded-2xl px-3 py-2 text-[12px] font-bold ${
        ready ? 'bg-[#ECFDF5] text-[#047857]' : status === 'pending' ? 'bg-[#FFFBEB] text-[#B45309]' : 'bg-[#F1F5F9] text-[#475569]'
      }`}
    >
      <button type="button" onClick={onOpenMap} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-label={t('home.changeLocation')}>
        <LocateFixed className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {ready
            ? t('home.gpsReady', { address })
            : status === 'pending'
              ? t('home.gpsPending')
              : status === 'approx'
                ? t('home.gpsApprox', { address })
                : t('home.gpsDenied', { address })}
        </span>
      </button>
      {!ready ? (
        <button
          type="button"
          onClick={onRetryGps}
          className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-[#4A82B8] shadow-[0_4px_10px_rgba(15,23,42,0.08)]"
        >
          {t('home.allowLocation')}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onOpenMap}
        className="shrink-0 rounded-full bg-[#4A82B8] px-2.5 py-1 text-[11px] font-black text-white shadow-[0_4px_10px_rgba(74,130,184,0.28)]"
      >
        {t('home.viewMap')}
      </button>
    </div>
  )
}
