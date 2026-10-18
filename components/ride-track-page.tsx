'use client'

import { useEffect, useRef, useState } from 'react'
import { Car, Clock, MapPin, ShieldCheck } from 'lucide-react'
import { TaxiLiveMap, type TaxiLivePhase } from '@/components/app-map'
import { useLocale } from '@/components/locale-provider'

type SharePoint = { lat: number; lng: number; address: string; label: string }

type SharedRide = {
  kind: 'taxi' | 'daeri'
  status: 'searching' | 'offered' | 'assigned' | 'unmatched' | 'cancelled' | 'completed'
  pickup: SharePoint
  dest: SharePoint
  waypoints: SharePoint[]
  boardedAt: string | null
  readyToSettleAt: string | null
  driver: { name: string; vehicle: string; plate: string } | null
  vehicle: { lat: number; lng: number; heading: number; at: string } | null
  updatedAt: string
}

const POLL_MS = 5_000

export default function RideTrackPage({ token }: { token: string }) {
  const { t, locale } = useLocale()
  const [ride, setRide] = useState<SharedRide | null>(null)
  const [missing, setMissing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const stoppedRef = useRef(false)

  useEffect(() => {
    stoppedRef.current = false
    const pull = async () => {
      try {
        const res = await fetch(`/api/share/${encodeURIComponent(token)}`, { cache: 'no-store' })
        if (stoppedRef.current) return
        if (res.status === 404) {
          setMissing(true)
          setRide(null)
          return
        }
        const data = (await res.json().catch(() => null)) as { ride?: SharedRide } | null
        if (data?.ride) {
          setRide(data.ride)
          setMissing(false)
          setUpdatedAt(new Date())
        }
      } catch {
        // 일시적 네트워크 실패는 다음 폴링이 복구한다.
      }
    }
    void pull()
    const timer = window.setInterval(pull, POLL_MS)
    return () => {
      stoppedRef.current = true
      window.clearInterval(timer)
    }
  }, [token])

  const statusText = !ride
    ? missing
      ? t('track.st.missing')
      : t('common.checking')
    : ride.status === 'completed'
      ? t('track.st.completed')
      : ride.status === 'cancelled'
        ? t('track.st.cancelled')
        : ride.status === 'assigned'
          ? ride.readyToSettleAt
            ? t('track.st.arrived')
            : ride.boardedAt
              ? t('track.st.moving')
              : t('track.st.pickup')
          : t('track.st.call')

  const ended = ride?.status === 'completed' || ride?.status === 'cancelled' || missing
  const phase: TaxiLivePhase = ride?.boardedAt || ride?.readyToSettleAt ? 'moving' : 'arriving'

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md bg-[#F8FAFC] px-4 py-6">
      <header className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#4A82B8] text-white">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-black text-[#0F172A]">{t('track.title')}</h1>
          <p className="text-[11px] font-bold text-[#64748B]">{t('track.sub')}</p>
        </div>
      </header>

      <section className="mt-4 rounded-[24px] border-2 border-[#BFDBFE] bg-white p-4">
        <p className="text-[10px] font-black text-[#4A82B8]">{t('track.status')}</p>
        <p className="mt-1 text-base font-black text-[#0F172A]">{statusText}</p>
        {updatedAt && !missing ? (
          <p className="mt-1 flex items-center gap-1 text-[11px] font-bold text-[#64748B]">
            <Clock className="h-3 w-3" />
            {t('track.updated', { time: updatedAt.toLocaleTimeString(locale === 'ko' ? 'ko-KR' : locale === 'ja' ? 'ja-JP' : locale === 'zh' ? 'zh-CN' : 'en-US') })}
          </p>
        ) : null}
      </section>

      {ride?.driver ? (
        <section className="mt-3 rounded-[24px] border border-[#E2E8F0] bg-white p-4">
          <p className="text-[10px] font-black text-[#8b8495]">{t('track.driver')}</p>
          <div className="mt-2 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#4A82B8] text-base font-black text-white">
              {ride.driver.name.slice(0, 1)}
            </span>
            <div>
              <p className="text-sm font-black text-[#0F172A]">{t('match.driverTitle', { name: ride.driver.name })}</p>
              <p className="mt-0.5 text-xs font-bold text-[#64748B]">
                {ride.driver.vehicle} · {ride.driver.plate}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {ride ? (
        <section className="mt-3 rounded-[24px] border border-[#E2E8F0] bg-white p-4">
          <p className="flex items-center gap-1 text-[10px] font-black text-[#8b8495]">
            <MapPin className="h-3 w-3" />
            {t('track.route')}
          </p>
          <p className="mt-2 text-sm font-bold leading-5 text-[#0F172A]">
            {ride.pickup.label || ride.pickup.address}
            {ride.waypoints.map((wp) => ` → ${wp.label || wp.address}`).join('')}
            {' → '}
            {ride.dest.label || ride.dest.address}
          </p>
        </section>
      ) : null}

      {ride && !ended ? (
        <TaxiLiveMap
          kind={ride.kind === 'daeri' ? 'daeri' : 'taxi'}
          phase={phase}
          routeLabel={`${ride.pickup.label || ride.pickup.address} → ${ride.dest.label || ride.dest.address}`}
          statusLabel={statusText}
          originLat={ride.pickup.lat}
          originLng={ride.pickup.lng}
          destLat={ride.dest.lat}
          destLng={ride.dest.lng}
          originLabel={ride.pickup.label || ride.pickup.address}
          destLabel={ride.dest.label || ride.dest.address}
          waypoints={ride.waypoints}
          vehicleLat={ride.vehicle?.lat}
          vehicleLng={ride.vehicle?.lng}
          vehicleHeading={ride.vehicle?.heading}
          className="h-[320px]"
        />
      ) : ended && ride ? (
        <div className="mt-3 flex items-center justify-center gap-2 rounded-[24px] border-2 border-[#CBD5E1] bg-white py-10">
          <Car className="h-5 w-5 text-[#64748B]" />
          <p className="text-sm font-black text-[#334155]">{t('track.end')}</p>
        </div>
      ) : null}

      <p className="mt-6 text-center text-[11px] font-bold text-[#94A3B8]">{t('track.footer')}</p>
    </main>
  )
}
