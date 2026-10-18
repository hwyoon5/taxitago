'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BatteryCharging, CarFront, CircleX, Clock3, MapPin, Package, Route, X } from 'lucide-react'
import { activateTrip, cancelTripById, createTripPlan, fetchMyTrips, fetchRideRequest } from '@/lib/dispatch-client'
import type { Trip, TripLeg, TripLegStatus } from '@/lib/trip-planner'
import { searchPlacesFromApi, type SearchedPlace } from '@/lib/geocode-client'
import { listNearbyServiceSpots } from '@/lib/nearby-services'
import { piText } from '@/lib/pi-format'
import { useLocale } from '@/components/locale-provider'
import type { PublicRide } from '@/lib/dispatch-types'

type PlacePick = { lat: number; lng: number; address: string; label: string }

const LEG_ICON: Record<string, typeof CarFront> = { ride: CarFront, ev: BatteryCharging, delivery: Package }
const LEG_TONE: Record<TripLegStatus, string> = {
  planned: 'bg-[#F1F5F9] text-[#64748B]',
  booked: 'bg-[#DBEAFE] text-[#1D4ED8]',
  active: 'bg-[#ECFDF5] text-[#047857]',
  completed: 'bg-[#0F172A] text-white',
  cancelled: 'bg-[#F1F5F9] text-[#94A3B8] line-through',
  failed: 'bg-[#FEE2E2] text-[#B91C1C]',
}

const fmtTime = (iso?: string | null) => {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(ms))
}

/** 목적지·배송지 검색 필드 — /api/geocode 결과에서 한 곳을 고른다. */
function PlaceSearchField({
  placeholder,
  onPick,
}: {
  placeholder: string
  onPick: (place: PlacePick) => void
}) {
  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchedPlace[]>([])
  const [searching, setSearching] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = (value: string) => {
    setQuery(value)
    if (timer.current) clearTimeout(timer.current)
    const keyword = value.trim()
    if (keyword.length < 2) {
      setResults([])
      return
    }
    timer.current = setTimeout(async () => {
      setSearching(true)
      const found = await searchPlacesFromApi(keyword).catch(() => [])
      setResults(found.slice(0, 6))
      setSearching(false)
    }, 350)
  }

  return (
    <div>
      <input
        value={query}
        onChange={(event) => search(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-[#CBD5E1] bg-white px-3 py-2.5 text-sm font-bold text-[#0F172A] outline-none placeholder:text-[#94A3B8] focus:border-[#4A82B8]"
      />
      {searching ? <p className="mt-1 text-[10px] font-bold text-[#94A3B8]">{t('common.loading')}</p> : null}
      {results.length ? (
        <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white p-1.5">
          {results.map((place) => (
            <li key={`${place.lat},${place.lng},${place.name}`}>
              <button
                type="button"
                onClick={() => {
                  onPick({ lat: place.lat, lng: place.lng, address: place.address || place.name, label: place.name })
                  setResults([])
                  setQuery(place.name)
                }}
                className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-[#F1F5F9]"
              >
                <p className="truncate text-[12px] font-black text-[#0F172A]">{place.name}</p>
                <p className="truncate text-[10px] font-bold text-[#94A3B8]">{place.address}</p>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default function TripPlannerSheet({
  originLat,
  originLng,
  originAddress,
  ownerId,
  onClose,
  onNotice,
  onRideStarted,
}: {
  originLat: number
  originLng: number
  originAddress: string
  ownerId: string
  onClose: () => void
  onNotice?: (message: string) => void
  /** 택시 다리가 실행되면 기존 매칭 시트로 연결한다. */
  onRideStarted?: (ride: PublicRide) => void
}) {
  const { t } = useLocale()
  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // 새 여정 입력 상태
  const [dest, setDest] = useState<PlacePick | null>(null)
  const [departIn, setDepartIn] = useState(0) // 분
  const [addEv, setAddEv] = useState(false)
  const [evStationId, setEvStationId] = useState('')
  const [chargeMin, setChargeMin] = useState(45)
  const [addDelivery, setAddDelivery] = useState(false)
  const [delivDest, setDelivDest] = useState<PlacePick | null>(null)
  const [delivLabel, setDelivLabel] = useState('')
  const [delivFare, setDelivFare] = useState('3')
  const [delivPickup, setDelivPickup] = useState<'depart' | 'arrival'>('depart')
  const [planned, setPlanned] = useState<Trip | null>(null)

  const evSpots = useMemo(
    () => listNearbyServiceSpots('ev', originLat, originLng, 6),
    [originLat, originLng],
  )
  const evStation = evSpots.find((spot) => spot.id === evStationId) ?? evSpots[0] ?? null

  const refresh = useCallback(async () => {
    if (!ownerId) {
      setLoading(false)
      return
    }
    const list = await fetchMyTrips(ownerId)
    setTrips(list)
    setLoading(false)
  }, [ownerId])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const canPlan = Boolean(dest) && (addEv ? Boolean(evStation) : true) && (addDelivery ? Boolean(delivDest) : true)

  /** 여정 계획 생성 — 서버가 시간·위치 연동 제안값을 계산해 돌려준다. */
  const plan = async () => {
    if (!canPlan || busy) return
    setBusy(true)
    try {
      const legs: Partial<TripLeg>[] = [
        {
          kind: 'ride',
          pickup: { lat: originLat, lng: originLng, address: originAddress },
          dest: dest ? { lat: dest.lat, lng: dest.lng, address: dest.address, label: dest.label } : undefined,
        },
      ]
      if (addEv && evStation) {
        legs.push({
          kind: 'ev',
          stationId: evStation.id,
          stationName: evStation.name,
          stationLat: evStation.lat,
          stationLng: evStation.lng,
          durationMin: chargeMin,
        })
      }
      if (addDelivery && delivDest) {
        legs.push({
          kind: 'delivery',
          pickupAddress: originAddress,
          pickupLat: originLat,
          pickupLng: originLng,
          destAddress: delivDest.address,
          destLat: delivDest.lat,
          destLng: delivDest.lng,
          packageLabel: delivLabel || '소포',
          fare: Number(delivFare) || 0,
          // 'arrival' 선택 시 scheduledAt을 비워 서버 제안값(도착 시각)을 쓴다.
          scheduledAt: delivPickup === 'arrival' ? undefined : new Date(Date.now() + departIn * 60_000).toISOString(),
        })
      }
      const trip = await createTripPlan({
        departAt: departIn > 0 ? new Date(Date.now() + departIn * 60_000).toISOString() : null,
        legs,
      })
      setPlanned(trip)
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : '여정을 만들지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  /** 여정 실행 — 각 다리의 실제 호출·예약·등록을 서버가 만든다. */
  const run = async (tripId: string) => {
    if (busy) return
    setBusy(true)
    try {
      const trip = await activateTrip(tripId)
      setPlanned(trip)
      void refresh()
      const rideLeg = trip.legs.find((leg) => leg.kind === 'ride' && leg.refId)
      if (rideLeg?.refId && onRideStarted) {
        const ride = await fetchRideRequest(rideLeg.refId)
        if (ride) onRideStarted(ride)
      }
      onNotice?.('여정을 시작했어요. 각 서비스의 진행 상태가 자동으로 연동됩니다.')
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : '여정을 실행하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  const cancelTrip = async (tripId: string) => {
    if (busy) return
    if (!window.confirm('여정을 취소할까요? 예약·호출된 다리도 함께 취소됩니다.')) return
    setBusy(true)
    try {
      const trip = await cancelTripById(tripId)
      setPlanned((prev) => (prev?.id === trip.id ? trip : prev))
      void refresh()
      onNotice?.('여정을 취소했어요.')
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : '취소에 실패했어요.')
    } finally {
      setBusy(false)
    }
  }

  const legStatusText = (status: TripLegStatus) => t(`trip.status.${status}`)

  const renderTrip = (trip: Trip) => (
    <article key={trip.id} className="rounded-[20px] bg-white p-4 ring-1 ring-[#E2E8F0]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-black text-[#334155]">
          {fmtTime(trip.departAt) ? `${fmtTime(trip.departAt)} ${t('trip.departAt')}` : t('trip.departNow')}
          {trip.suggested?.arriveAt ? ` · ${t('trip.arriveEst')} ${fmtTime(trip.suggested.arriveAt)}` : ''}
        </p>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${trip.status === 'completed' ? 'bg-[#ECFDF5] text-[#047857]' : trip.status === 'cancelled' ? 'bg-[#F1F5F9] text-[#94A3B8]' : 'bg-[#DBEAFE] text-[#1D4ED8]'}`}>
          {t(`trip.status.${trip.status}`)}
        </span>
      </div>
      {/* 다리 타임라인 — 위치·시간 연동 미리보기/상태 */}
      <ul className="mt-3 space-y-2">
        {trip.legs.map((leg, index) => {
          const Icon = LEG_ICON[leg.kind] ?? Route
          return (
            <li key={leg.id} className="flex items-start gap-2.5">
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${index === 0 ? 'bg-[#4A82B8] text-white' : 'bg-[#E8F1FA] text-[#4A82B8]'}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-[12px] font-black text-[#0F172A]">{leg.label}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black ${LEG_TONE[leg.status]}`}>
                    {legStatusText(leg.status)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[10px] font-bold text-[#64748B]">
                  {leg.kind === 'ride'
                    ? `${leg.pickup?.address || ''} → ${leg.dest?.address || leg.dest?.label || ''}${leg.waypoints?.length ? ` (${leg.waypoints.length} ${t('trip.via')})` : ''}`
                    : leg.kind === 'ev'
                      ? `${leg.stationName || ''} · ${fmtTime(leg.startAt)} ${t('trip.from')} ${leg.durationMin}${t('trip.minUnit')}`
                      : `${leg.pickupAddress || ''} → ${leg.destAddress || ''}${leg.scheduledAt ? ` · ${t('trip.pickupAt')} ${fmtTime(leg.scheduledAt)}` : ''}`}
                </p>
                {leg.kind === 'ride' && leg.estimatedFare ? (
                  <p className="text-[10px] font-bold text-[#4A82B8]">{piText(leg.estimatedFare)} Pi {t('trip.est')}</p>
                ) : null}
                {leg.error ? <p className="text-[9px] font-bold text-[#B91C1C]">{leg.error}</p> : null}
              </div>
            </li>
          )
        })}
      </ul>
      {trip.status === 'planned' ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(trip.id)}
          className="mt-3 w-full rounded-2xl bg-[#4A82B8] py-3 text-xs font-black text-white shadow-[0_8px_16px_rgba(74,130,184,0.28)] disabled:opacity-60"
        >
          {t('trip.run')}
        </button>
      ) : null}
      {trip.status === 'planned' || trip.status === 'active' ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void cancelTrip(trip.id)}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-2xl border border-[#E2E8F0] bg-white py-2 text-[11px] font-black text-[#64748B]"
        >
          <CircleX className="h-3.5 w-3.5" />
          {t('trip.cancel')}
        </button>
      ) : null}
    </article>
  )

  const openTrips = trips.filter((trip) => trip.status !== 'cancelled' && trip.status !== 'completed')
  const showTrip = planned && openTrips.every((t) => t.id !== planned.id) ? [planned, ...openTrips] : openTrips

  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-slate-900/45 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-[28px] bg-[#F8FAFC] sm:mx-auto sm:max-w-lg sm:rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('trip.title')}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-[28px] border-b border-[#E2E8F0] bg-white px-4 py-3.5">
          <p className="flex items-center gap-1.5 text-sm font-black text-[#0F172A]">
            <Route className="h-4 w-4 text-[#4A82B8]" />
            {t('trip.title')}
          </p>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#475569]" aria-label={t('common.close')}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4 pb-8">
          {/* 진행 중 여정 */}
          {loading ? (
            <article className="rounded-[20px] bg-white p-6 text-center text-xs font-black text-[#64748B]">{t('common.loading')}</article>
          ) : null}
          {showTrip.map(renderTrip)}

          {/* 새 여정 만들기 */}
          <article className="rounded-[20px] bg-white p-4 ring-1 ring-[#E2E8F0]">
            <p className="text-xs font-black text-[#334155]">{t('trip.newTrip')}</p>

            <div className="mt-3 space-y-2.5">
              {/* 출발지 */}
              <div className="flex items-center gap-2 rounded-xl bg-[#F8FAFC] px-3 py-2.5">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-[#4A82B8]" />
                <p className="min-w-0 truncate text-[12px] font-bold text-[#0F172A]">
                  <span className="text-[#94A3B8]">{t('trip.origin')} </span>{originAddress || t('trip.currentLocation')}
                </p>
              </div>
              {/* 목적지 */}
              <PlaceSearchField placeholder={t('trip.destPlaceholder')} onPick={setDest} />
              {dest ? (
                <p className="flex items-center gap-1.5 text-[11px] font-black text-[#047857]">
                  <MapPin className="h-3 w-3" /> {dest.label || dest.address}
                </p>
              ) : null}

              {/* 출발 시각 */}
              <div className="flex items-center gap-1.5">
                <Clock3 className="h-3.5 w-3.5 shrink-0 text-[#64748B]" />
                {[0, 30, 60, 120].map((min) => (
                  <button
                    key={min}
                    type="button"
                    onClick={() => setDepartIn(min)}
                    className={`rounded-full px-3 py-1.5 text-[10px] font-black ${departIn === min ? 'bg-[#0F172A] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
                  >
                    {min === 0 ? t('trip.now') : `+${min}${t('trip.minUnit')}`}
                  </button>
                ))}
              </div>

              {/* EV 충전 경유 토글 */}
              <label className={`flex cursor-pointer items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 ${addEv ? 'border-[#4A82B8] bg-[#E8F1FA]' : 'border-[#E2E8F0] bg-white'}`}>
                <input type="checkbox" checked={addEv} onChange={(event) => setAddEv(event.target.checked)} className="h-4 w-4 accent-[#4A82B8]" />
                <BatteryCharging className="h-4 w-4 text-[#4A82B8]" />
                <span className="flex-1 text-[12px] font-black text-[#0F172A]">{t('trip.addEv')}</span>
              </label>
              {addEv ? (
                <div className="space-y-2 rounded-xl bg-[#F8FAFC] p-3">
                  <select
                    value={evStation?.id ?? ''}
                    onChange={(event) => setEvStationId(event.target.value)}
                    className="w-full rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-2 text-[12px] font-bold text-[#0F172A]"
                  >
                    {evSpots.map((spot) => (
                      <option key={spot.id} value={spot.id}>
                        {spot.name} · {spot.distanceLabel}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black text-[#64748B]">{t('trip.chargeTime')}</span>
                    {[30, 45, 60, 90].map((min) => (
                      <button
                        key={min}
                        type="button"
                        onClick={() => setChargeMin(min)}
                        className={`rounded-full px-2.5 py-1 text-[10px] font-black ${chargeMin === min ? 'bg-[#0F172A] text-white' : 'bg-white text-[#475569] ring-1 ring-[#E2E8F0]'}`}
                      >
                        {min}{t('trip.minUnit')}
                      </button>
                    ))}
                  </div>
                  <p className="text-[9px] font-bold leading-4 text-[#94A3B8]">{t('trip.evHint')}</p>
                </div>
              ) : null}

              {/* 택배 발송 토글 */}
              <label className={`flex cursor-pointer items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 ${addDelivery ? 'border-[#4A82B8] bg-[#E8F1FA]' : 'border-[#E2E8F0] bg-white'}`}>
                <input type="checkbox" checked={addDelivery} onChange={(event) => setAddDelivery(event.target.checked)} className="h-4 w-4 accent-[#4A82B8]" />
                <Package className="h-4 w-4 text-[#4A82B8]" />
                <span className="flex-1 text-[12px] font-black text-[#0F172A]">{t('trip.addDelivery')}</span>
              </label>
              {addDelivery ? (
                <div className="space-y-2 rounded-xl bg-[#F8FAFC] p-3">
                  <PlaceSearchField placeholder={t('trip.delivDestPlaceholder')} onPick={setDelivDest} />
                  {delivDest ? <p className="text-[10px] font-black text-[#047857]">{delivDest.label || delivDest.address}</p> : null}
                  <div className="flex gap-2">
                    <input
                      value={delivLabel}
                      onChange={(event) => setDelivLabel(event.target.value)}
                      placeholder={t('trip.packageLabel')}
                      className="min-w-0 flex-1 rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-2 text-[12px] font-bold text-[#0F172A]"
                    />
                    <input
                      value={delivFare}
                      onChange={(event) => setDelivFare(event.target.value)}
                      inputMode="decimal"
                      placeholder="Pi"
                      className="w-20 rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-2 text-right text-[12px] font-bold tabular-nums text-[#0F172A]"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black text-[#64748B]">{t('trip.pickupWhen')}</span>
                    {(['depart', 'arrival'] as const).map((when) => (
                      <button
                        key={when}
                        type="button"
                        onClick={() => setDelivPickup(when)}
                        className={`rounded-full px-2.5 py-1 text-[10px] font-black ${delivPickup === when ? 'bg-[#0F172A] text-white' : 'bg-white text-[#475569] ring-1 ring-[#E2E8F0]'}`}
                      >
                        {t(`trip.pickup.${when}`)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                disabled={!canPlan || busy}
                onClick={() => void plan()}
                className="w-full rounded-2xl bg-[#0F172A] py-3 text-xs font-black text-white disabled:opacity-50"
              >
                {busy ? t('common.loading') : t('trip.plan')}
              </button>
            </div>
          </article>
        </div>
      </div>
    </div>
  )
}
