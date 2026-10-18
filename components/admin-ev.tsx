'use client'

import { useCallback, useEffect, useState } from 'react'
import { BatteryCharging, ListOrdered, Zap } from 'lucide-react'
import { adminHeaders } from '@/lib/admin-key'
import type { EvBooking, EvStationLoad } from '@/lib/ev-booking'

type EvState = {
  network: string
  stations: EvStationLoad[]
  bookings: EvBooking[]
}

const STATUS_LABEL: Record<EvBooking['status'], string> = {
  queued: '대기 중',
  reserved: '예약 확정',
  notified: '체크인 대기',
  active: '충전 중',
  fulfilled: '완료',
  cancelled: '취소',
  expired: '만료',
}

const STATUS_TONE: Record<EvBooking['status'], string> = {
  queued: 'bg-[#FFFBEB] text-[#B45309]',
  reserved: 'bg-[#EFF6FF] text-[#1D4ED8]',
  notified: 'bg-[#ECFDF5] text-[#047857]',
  active: 'bg-[#ECFDF5] text-[#047857]',
  fulfilled: 'bg-[#F1F5F9] text-[#475569]',
  cancelled: 'bg-[#F1F5F9] text-[#94A3B8]',
  expired: 'bg-[#FEF2F2] text-[#B91C1C]',
}

const fmtDayTime = (iso?: string) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—'
}

const OPEN_STATUSES: EvBooking['status'][] = ['queued', 'reserved', 'notified', 'active']

/** EV 충전 예약·대기열 관제 — 충전소별 슬롯 점유·전력 부하·대기열을 실시간 모니터링한다. */
export default function AdminEv() {
  const [state, setState] = useState<EvState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [statusFilter, setStatusFilter] = useState<'open' | 'all' | EvBooking['status']>('open')
  const [stationFilter, setStationFilter] = useState('')
  const [slotEdit, setSlotEdit] = useState<Record<string, { slots: string; powerKw: string }>>({})

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/ev', { headers: adminHeaders(), cache: 'no-store' }).catch(() => null)
    const data = (await res?.json().catch(() => null)) as EvState | null
    if (data?.stations) {
      setState(data)
      setSlotEdit((prev) => {
        const next = { ...prev }
        for (const row of data.stations) {
          if (!next[row.station.id]) {
            next[row.station.id] = { slots: String(row.station.slots), powerKw: row.station.powerKw ? String(row.station.powerKw) : '' }
          }
        }
        return next
      })
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const say = (message: string, isError = false) => {
    setError(isError ? message : '')
    setNotice(isError ? '' : message)
    if (!isError) window.setTimeout(() => setNotice(''), 3000)
  }

  const act = async (key: string, body: Record<string, unknown>, done: string) => {
    setBusyKey(key)
    try {
      const res = await fetch('/api/admin/ev', {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error || '처리에 실패했습니다.')
      say(done)
      await load()
    } catch (err) {
      say(err instanceof Error ? err.message : '처리에 실패했습니다.', true)
    } finally {
      setBusyKey('')
    }
  }

  const bookings = (state?.bookings ?? []).filter((row) => {
    if (stationFilter && row.stationId !== stationFilter) return false
    if (statusFilter === 'all') return true
    if (statusFilter === 'open') return OPEN_STATUSES.includes(row.status)
    return row.status === statusFilter
  })

  const totals = (state?.stations ?? []).reduce(
    (acc, row) => ({
      slots: acc.slots + row.station.slots,
      occupied: acc.occupied + row.occupiedNow,
      queue: acc.queue + row.queueDepth,
      kw: acc.kw + row.chargingKw,
    }),
    { slots: 0, occupied: 0, queue: 0, kw: 0 },
  )

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-black text-[#0F172A]">EV 충전 예약 · 대기열 관제</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${state?.network === 'mainnet' ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#FFFBEB] text-[#B45309]'}`}>
          {state?.network === 'mainnet' ? '메인넷' : '테스트넷'} 장부 스코프
        </span>
        {notice ? <span className="text-xs font-black text-[#15803D]">{notice}</span> : null}
        {error ? <span className="text-xs font-black text-[#B91C1C]">{error}</span> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: '점유 슬롯', value: `${totals.occupied}/${totals.slots}` },
          { label: '대기열', value: `${totals.queue}명` },
          { label: '충전 부하', value: `${totals.kw.toFixed(1)} kW` },
          { label: '진행 중 예약', value: `${bookings.filter((b) => OPEN_STATUSES.includes(b.status)).length}건` },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border-2 border-[#BFDBFE] bg-[#F5F9FF] p-3.5">
            <p className="text-[10px] font-black text-[#4A82B8]">{card.label}</p>
            <p className="mt-1 text-xl font-black text-[#0F172A]">{card.value}</p>
          </div>
        ))}
      </div>

      {/* 충전소별 부하 카드 + 슬롯 설정 */}
      <div className="grid gap-3 md:grid-cols-2">
        {(state?.stations ?? []).map((row) => {
          const edit = slotEdit[row.station.id] ?? { slots: String(row.station.slots), powerKw: '' }
          const full = row.occupiedNow >= row.station.slots
          return (
            <div key={row.station.id} className={`rounded-2xl border-2 p-3.5 ${full ? 'border-[#FCA5A5] bg-[#FFF7F7]' : 'border-[#BBF7D0] bg-[#F8FFFB]'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-black text-[#0F172A]">{row.station.name}</p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${full ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#ECFDF5] text-[#047857]'}`}>
                  슬롯 {row.occupiedNow}/{row.station.slots}
                </span>
              </div>
              <p className="mt-0.5 font-mono text-[10px] font-bold text-[#94A3B8]">{row.station.id}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black">
                <span className="rounded-full bg-white px-2 py-0.5 text-[#B45309] ring-1 ring-[#FDE68A]">
                  <ListOrdered className="mr-0.5 inline h-3 w-3" /> 대기 {row.queueDepth}
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[#1D4ED8] ring-1 ring-[#BFDBFE]">
                  <Zap className="mr-0.5 inline h-3 w-3" /> {row.chargingKw.toFixed(1)} kW
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[#475569] ring-1 ring-[#E2E8F0]">24h 예약 {row.reservedNext24h}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[#475569] ring-1 ring-[#E2E8F0]">
                  오늘 {row.today.created}건 · 완료 {row.today.fulfilled} · 만료 {row.today.expired} · 취소 {row.today.cancelled}
                </span>
              </div>
              <div className="mt-2.5 flex items-end gap-2">
                <label className="text-[10px] font-black text-[#64748B]">
                  슬롯 수
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={edit.slots}
                    onChange={(e) => setSlotEdit((prev) => ({ ...prev, [row.station.id]: { ...edit, slots: e.target.value } }))}
                    className="mt-0.5 block w-16 rounded-lg border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-bold text-[#0F172A]"
                  />
                </label>
                <label className="text-[10px] font-black text-[#64748B]">
                  슬롯 출력(kW)
                  <input
                    type="number"
                    min={1}
                    value={edit.powerKw}
                    placeholder="—"
                    onChange={(e) => setSlotEdit((prev) => ({ ...prev, [row.station.id]: { ...edit, powerKw: e.target.value } }))}
                    className="mt-0.5 block w-20 rounded-lg border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-bold text-[#0F172A]"
                  />
                </label>
                <button
                  type="button"
                  disabled={busyKey === `st-${row.station.id}`}
                  onClick={() =>
                    act(
                      `st-${row.station.id}`,
                      { action: 'station', stationId: row.station.id, name: row.station.name, slots: Number(edit.slots), powerKw: Number(edit.powerKw) || undefined },
                      '충전소 설정을 저장했습니다',
                    )
                  }
                  className="ml-auto rounded-lg bg-[#4A82B8] px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-60"
                >
                  저장
                </button>
              </div>
            </div>
          )
        })}
        {state && !state.stations.length ? (
          <p className="rounded-2xl border-2 border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-6 text-center text-xs font-bold text-[#94A3B8] md:col-span-2">
            등록된 충전소가 없습니다 — 첫 예약 또는 충전 세션이 생기면 자동 등록됩니다.
          </p>
        ) : null}
      </div>

      {/* 예약 목록 */}
      <div className="rounded-2xl border-2 border-[#E2E8F0] bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-[#E2E8F0] p-3">
          <p className="text-sm font-black text-[#0F172A]">예약 현황</p>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="ml-auto rounded-lg border border-[#CBD5E1] px-2 py-1 text-xs font-bold text-[#0F172A]"
          >
            <option value="open">진행 중</option>
            <option value="all">전체</option>
            {Object.entries(STATUS_LABEL).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <select
            value={stationFilter}
            onChange={(e) => setStationFilter(e.target.value)}
            className="rounded-lg border border-[#CBD5E1] px-2 py-1 text-xs font-bold text-[#0F172A]"
          >
            <option value="">모든 충전소</option>
            {(state?.stations ?? []).map((row) => (
              <option key={row.station.id} value={row.station.id}>{row.station.name}</option>
            ))}
          </select>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#F8FAFC] text-[10px] font-black uppercase text-[#64748B]">
              <tr>
                <th className="px-3 py-2">충전소</th>
                <th className="px-3 py-2">이용자</th>
                <th className="px-3 py-2">시작 · 시간</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">순번/체크인</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {bookings.map((row) => (
                <tr key={row.id} className="border-t border-[#F1F5F9]">
                  <td className="px-3 py-2 font-bold text-[#0F172A]">{row.stationName}</td>
                  <td className="max-w-[120px] truncate px-3 py-2 font-mono text-[10px] text-[#64748B]">{row.userUid || row.userId}</td>
                  <td className="px-3 py-2 font-bold text-[#475569]">
                    {row.flexible ? '즉시' : fmtDayTime(row.startAt)} · {row.durationMin}분
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${STATUS_TONE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                  </td>
                  <td className="px-3 py-2 font-bold text-[#64748B]">
                    {row.status === 'queued' ? `#${row.queuePos ?? '—'}${row.estStartAt ? ` · ${fmtDayTime(row.estStartAt)}` : ''}` : ''}
                    {row.status === 'notified' && row.checkInBy ? `${fmtDayTime(row.checkInBy)}까지` : ''}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {OPEN_STATUSES.includes(row.status) ? (
                      <button
                        type="button"
                        disabled={busyKey === row.id}
                        onClick={() => {
                          if (!window.confirm(`'${row.stationName}' 예약을 강제 취소할까요? 대기열이 승격됩니다.`)) return
                          void act(row.id, { action: 'cancel', bookingId: row.id }, '예약을 취소했습니다')
                        }}
                        className="rounded-lg border border-[#FCA5A5] bg-white px-2 py-1 text-[10px] font-black text-[#B91C1C] disabled:opacity-60"
                      >
                        취소
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!bookings.length ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center font-bold text-[#94A3B8]">
                    {loading ? '불러오는 중…' : '표시할 예약이 없습니다'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[10px] font-bold leading-4 text-[#94A3B8]">
        <BatteryCharging className="mr-1 inline h-3 w-3" />
        슬롯 점유는 예약 윈도우와 진행 중 충전 세션(최대 3시간)으로 계산됩니다. 차례 알림은 웹 푸시로 발송되며,
        체크인 기한(즉시 10분·예약 시작 후 15분)이 지나면 자동 만료되고 다음 대기자에게 넘어갑니다.
      </p>
    </div>
  )
}
