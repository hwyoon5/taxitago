'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BatteryCharging, CalendarClock, ListOrdered, Zap } from 'lucide-react'
import { useLocale } from '@/components/locale-provider'
import { cancelEvBooking, createEvBooking, fetchEvBookings, type EvBooking, type EvStationAvailability } from '@/lib/ev-booking-client'

type StationLite = { id: string; name: string; powerKw?: number; providerName?: string }

const OPEN_STATUSES = ['queued', 'reserved', 'notified', 'active']

const fmtTime = (iso: string | undefined, locale: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : ''
}

const fmtDayTime = (iso: string | undefined, locale: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''
}

/**
 * EV 충전 예약·대기열 패널 — 충전소별 실시간 잔여 슬롯 표시, 시간대 예약,
 * 대기열 순번·차례 도착 알림까지 이용자 측 전체 흐름을 담당한다.
 * 15초 폴링으로 서버 스윕(만료·승격) 결과를 흡수한다.
 */
export default function EvBookingPanel({
  stations,
  selectedId,
  userId,
  userUid,
  onBookingChange,
  onAvailability,
  onStartCharging,
  onNotice,
}: {
  stations: StationLite[]
  selectedId: string
  userId: string
  userUid?: string
  onBookingChange?: (booking: EvBooking | null) => void
  onAvailability?: (rows: EvStationAvailability[]) => void
  onStartCharging?: (booking: EvBooking) => void
  onNotice?: (message: string) => void
}) {
  const { locale, t } = useLocale()
  const [mine, setMine] = useState<EvBooking | null>(null)
  const [avail, setAvail] = useState<EvStationAvailability[]>([])
  const [offsetMin, setOffsetMin] = useState(0)
  const [durationMin, setDurationMin] = useState(60)
  const [busy, setBusy] = useState(false)
  const mineRef = useRef<EvBooking | null>(null)

  const stationIds = useMemo(() => stations.map((s) => ({ id: s.id, name: s.name })), [stations])

  const load = useCallback(async () => {
    if (!userId) return
    const data = await fetchEvBookings(userId, stationIds).catch(() => null)
    if (!data) return
    const next = data.mine && OPEN_STATUSES.includes(data.mine.status) ? data.mine : null
    mineRef.current = next
    setMine(next)
    setAvail(data.availability)
    onBookingChange?.(next)
    onAvailability?.(data.availability)
  }, [userId, stationIds, onBookingChange, onAvailability])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const selectedAvail = avail.find((row) => row.stationId === selectedId) ?? null
  const selectedStation = stations.find((s) => s.id === selectedId) ?? null

  const book = async () => {
    if (busy || !selectedId) return
    setBusy(true)
    try {
      const startAt = offsetMin > 0 ? new Date(Date.now() + offsetMin * 60_000).toISOString() : undefined
      const booking = await createEvBooking({
        userId,
        userUid,
        stationId: selectedId,
        stationName: selectedStation?.name,
        startAt,
        durationMin,
        powerKw: selectedStation?.powerKw,
        providerName: selectedStation?.providerName,
      })
      mineRef.current = booking
      setMine(booking)
      onBookingChange?.(booking)
      onNotice?.(booking.status === 'queued' ? t('evb.queued') : t('evb.created'))
      void load()
    } catch {
      onNotice?.(t('evb.err'))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    const booking = mineRef.current
    if (!booking || busy) return
    setBusy(true)
    try {
      await cancelEvBooking(booking.id, userId)
      mineRef.current = null
      setMine(null)
      onBookingChange?.(null)
      onNotice?.(t('evb.cancelled'))
      void load()
    } catch {
      onNotice?.(t('evb.err'))
    } finally {
      setBusy(false)
    }
  }

  const startCharging = () => {
    const booking = mineRef.current
    if (booking && booking.status === 'notified') onStartCharging?.(booking)
  }

  const statusLabel = mine
    ? mine.status === 'queued'
      ? t('evb.myQueued', { n: String(mine.queuePos ?? 1) })
      : mine.status === 'reserved'
        ? t('evb.myReserved')
        : mine.status === 'notified'
          ? t('evb.myNotified')
          : t('evb.myActive')
    : ''

  return (
    <div className="rounded-2xl border-2 border-[#BFDBFE] bg-[#F5F9FF] p-3.5">
      <p className="flex items-center gap-1.5 text-[12px] font-black text-[#1D4ED8]">
        <CalendarClock className="h-4 w-4" /> {t('evb.title')}
      </p>

      {selectedAvail ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-black">
          <span className={`rounded-full px-2 py-0.5 ${selectedAvail.occupiedNow < selectedAvail.slots ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#FEF2F2] text-[#B91C1C]'}`}>
            <Zap className="mr-0.5 inline h-3 w-3" />
            {selectedAvail.occupiedNow < selectedAvail.slots
              ? t('evb.free', { free: String(selectedAvail.slots - selectedAvail.occupiedNow), slots: String(selectedAvail.slots) })
              : t('evb.full', { slots: String(selectedAvail.slots) })}
          </span>
          {selectedAvail.queueDepth > 0 ? (
            <span className="rounded-full bg-[#FFFBEB] px-2 py-0.5 text-[#B45309]">
              <ListOrdered className="mr-0.5 inline h-3 w-3" /> {t('evb.queueN', { n: String(selectedAvail.queueDepth) })}
            </span>
          ) : null}
          {selectedAvail.nextFreeAt ? (
            <span className="rounded-full bg-white px-2 py-0.5 text-[#64748B]">{t('evb.nextFree', { t: fmtTime(selectedAvail.nextFreeAt, locale) })}</span>
          ) : null}
        </div>
      ) : null}

      {mine ? (
        <div className="mt-2.5 rounded-xl border border-[#BFDBFE] bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-black text-[#0F172A]">{mine.stationName}</p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
                mine.status === 'notified'
                  ? 'bg-[#ECFDF5] text-[#047857]'
                  : mine.status === 'queued'
                    ? 'bg-[#FFFBEB] text-[#B45309]'
                    : 'bg-[#EFF6FF] text-[#1D4ED8]'
              }`}
            >
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 text-[11px] font-bold text-[#64748B]">
            {mine.flexible ? t('evb.now') : fmtDayTime(mine.startAt, locale)} · {t('evb.durMin', { m: String(mine.durationMin) })}
          </p>
          {mine.status === 'queued' && mine.estStartAt ? (
            <p className="mt-0.5 text-[11px] font-bold text-[#4A82B8]">{t('evb.eta', { t: fmtDayTime(mine.estStartAt, locale) })}</p>
          ) : null}
          {mine.status === 'notified' && mine.checkInBy ? (
            <p className="mt-0.5 text-[11px] font-black text-[#B45309]">{t('evb.checkin', { t: fmtTime(mine.checkInBy, locale) })}</p>
          ) : null}
          <div className="mt-2.5 flex gap-2">
            {mine.status === 'notified' ? (
              <button
                type="button"
                onClick={startCharging}
                className="flex-1 rounded-xl bg-[#15803D] py-2.5 text-sm font-black text-white shadow-[0_6px_12px_rgba(21,128,61,0.25)]"
              >
                <BatteryCharging className="mr-1 inline h-4 w-4" /> {t('evb.start')}
              </button>
            ) : null}
            {mine.status !== 'active' ? (
              <button
                type="button"
                disabled={busy}
                onClick={cancel}
                className={`${mine.status === 'notified' ? 'px-4' : 'flex-1'} rounded-xl border-2 border-[#E2E8F0] bg-white py-2.5 text-sm font-black text-[#64748B] disabled:opacity-60`}
              >
                {t('evb.cancel')}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[10px] font-black text-[#64748B]">{t('evb.when')}</span>
            <div className="flex flex-1 gap-1">
              {[
                { m: 0, label: t('evb.now') },
                { m: 30, label: t('evb.later', { m: '30' }) },
                { m: 60, label: t('evb.later', { m: '60' }) },
                { m: 120, label: t('evb.later', { m: '120' }) },
              ].map((opt) => (
                <button
                  key={opt.m}
                  type="button"
                  onClick={() => setOffsetMin(opt.m)}
                  className={`flex-1 rounded-lg px-1 py-1.5 text-[10px] font-black ${offsetMin === opt.m ? 'bg-[#4A82B8] text-white' : 'bg-white text-[#475569] ring-1 ring-[#E2E8F0]'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[10px] font-black text-[#64748B]">{t('evb.dur')}</span>
            <div className="flex flex-1 gap-1">
              {[30, 60, 90, 120].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDurationMin(m)}
                  className={`flex-1 rounded-lg px-1 py-1.5 text-[10px] font-black ${durationMin === m ? 'bg-[#4A82B8] text-white' : 'bg-white text-[#475569] ring-1 ring-[#E2E8F0]'}`}
                >
                  {t('evb.durMin', { m: String(m) })}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            disabled={busy || !selectedId}
            onClick={book}
            className="w-full rounded-xl bg-[#4A82B8] py-2.5 text-sm font-black text-white shadow-[0_6px_12px_rgba(74,130,184,0.25)] disabled:opacity-60"
          >
            {busy ? t('evb.booking') : t('evb.book')}
          </button>
        </div>
      )}
    </div>
  )
}
