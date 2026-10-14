'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import { PageSizeSelect, PaginationBar, usePagination } from '@/components/admin-pagination'

type AdminRide = {
  id: string
  kind: 'taxi' | 'daeri'
  status: string
  passengerId: string
  passengerPhone: string
  pickup: string
  dest: string
  waypoints: string[]
  estimatedFare: number
  waitMinutes: number | null
  boardedAt: string | null
  readyToSettleAt: string | null
  driver: { id: string; name: string; vehicle: string; plate: string; phone: string } | null
  createdAt: string
  updatedAt: string
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  searching: { label: '매칭 대기', cls: 'bg-[#FEF3C7] text-[#92400E]' },
  offered: { label: '배차 제안 중', cls: 'bg-[#DBEAFE] text-[#1D4ED8]' },
  assigned: { label: '이용 중', cls: 'bg-[#DCFCE7] text-[#15803D]' },
  unmatched: { label: '미배차 종료', cls: 'bg-[#FEE2E2] text-[#B91C1C]' },
  cancelled: { label: '취소', cls: 'bg-[#F1F5F9] text-[#64748B]' },
  completed: { label: '완료', cls: 'bg-[#D1FAE5] text-[#047857]' },
}

const STATUS_OPTIONS = [
  { value: '', label: '전체 상태' },
  { value: 'searching', label: '매칭 대기' },
  { value: 'offered', label: '배차 제안 중' },
  { value: 'assigned', label: '이용 중' },
  { value: 'completed', label: '완료' },
  { value: 'unmatched', label: '미배차 종료' },
  { value: 'cancelled', label: '취소' },
]

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

const statusOf = (ride: AdminRide) =>
  ride.status === 'assigned'
    ? ride.readyToSettleAt
      ? '도착·정산 대기'
      : ride.boardedAt
        ? '운행 중'
        : '픽업 이동 중'
    : (STATUS_META[ride.status]?.label ?? ride.status)

/** 택시·대리 호출 현황·이력 — 같은 섹션을 kind만 바꿔 두 번 렌더한다. */
export default function AdminRides({ kind }: { kind: 'taxi' | 'daeri' }) {
  const [items, setItems] = useState<AdminRide[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState<AdminRide | null>(null)

  const title = kind === 'daeri' ? '대리운전 현황 · 이력' : '택시 호출 현황 · 이력'

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ kind })
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (status) params.set('status', status)
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/api/admin/rides?${params.toString()}`, { headers: adminHeaders(), cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as { items?: AdminRide[]; error?: string } | null
      if (!res.ok || !data?.items) {
        setError(data?.error || '조회에 실패했습니다.')
        setItems([])
        return
      }
      setItems(data.items)
    } catch {
      setError('네트워크 오류')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [kind, from, to, status, q])

  // 진입 시 전체 이력 로드 + 30초 자동 갱신.
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const pagination = usePagination(items, 10, [from, to, status, q])
  const emptyLabel = kind === 'daeri' ? '조건에 맞는 대리운전 이력이 없습니다.' : '조건에 맞는 택시 호출 이력이 없습니다.'

  return (
    <section className="rounded-2xl border-2 border-[#E2E8F0] bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black text-[#334155]">{title}</h3>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1 text-[11px] font-black text-[#475569] disabled:opacity-50"
        >
          {loading ? '조회 중…' : '새로고침'}
        </button>
      </div>

      {/* 날짜·상태·검색 필터 — 과거 이력 전체가 조회 대상이다. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-[10px] font-bold text-[#64748B]">
          시작일
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 block w-full rounded-lg border border-[#CBD5E1] bg-white px-2 py-1.5 text-[11px] font-bold text-[#0F172A] outline-none" />
        </label>
        <label className="text-[10px] font-bold text-[#64748B]">
          종료일
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-0.5 block w-full rounded-lg border border-[#CBD5E1] bg-white px-2 py-1.5 text-[11px] font-bold text-[#0F172A] outline-none" />
        </label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-[#CBD5E1] bg-white px-2 py-1.5 text-[11px] font-bold text-[#0F172A] outline-none">
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void load() }}
          placeholder="주소·연락처·기사명 검색"
          className="rounded-lg border border-[#CBD5E1] bg-white px-2 py-1.5 text-[11px] font-bold text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
        />
      </div>
      <button type="button" onClick={() => void load()} className="mt-2 w-full rounded-xl bg-[#4A82B8] py-2 text-xs font-black text-white">
        조회
      </button>
      {error ? <p className="mt-2 text-[11px] font-bold text-[#DC2626]">{error}</p> : null}

      <div className="mt-3 space-y-2">
        {pagination.paged.map((ride) => {
          const meta = STATUS_META[ride.status] ?? { label: ride.status, cls: 'bg-[#F1F5F9] text-[#475569]' }
          return (
            <div key={ride.id} className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <p className="min-w-0 flex-1 truncate text-[12px] font-black text-[#0F172A]">
                  {ride.pickup || '출발지 미상'} → {ride.dest || '목적지 미상'}
                </p>
                <button
                  type="button"
                  onClick={() => setDetail(ride)}
                  className="shrink-0 rounded-lg bg-[#4A82B8] px-2 py-1 text-[10px] font-black text-white"
                >
                  상세보기
                </button>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${meta.cls}`}>{statusOf(ride)}</span>
              </div>
              <p className="mt-1 text-[10px] font-bold text-[#64748B]">
                {fmt(ride.createdAt)} · {ride.estimatedFare.toFixed(2)} Pi
                {ride.waitMinutes ? ` · 대기 ${ride.waitMinutes}분 설정` : ''}
                {ride.driver ? ` · 기사 ${ride.driver.name}${ride.driver.plate ? ` (${ride.driver.plate})` : ''}` : ' · 기사 미배정'}
                {ride.passengerPhone ? ` · 승객 ${ride.passengerPhone}` : ''}
              </p>
            </div>
          )
        })}
        {!loading && !items.length ? (
          <p className="rounded-xl bg-[#F8FAFC] px-3 py-4 text-center text-[11px] font-bold text-[#94A3B8]">{emptyLabel}</p>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <PageSizeSelect pageSize={pagination.pageSize} onChange={pagination.setPageSize} />
      </div>
      <PaginationBar
        total={pagination.total}
        rangeStart={pagination.rangeStart}
        rangeEnd={pagination.rangeEnd}
        page={pagination.page}
        totalPages={pagination.totalPages}
        pageButtons={pagination.pageButtons}
        onPage={pagination.setPage}
      />

      {detail ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4" onClick={() => setDetail(null)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-black text-[#0F172A]">{kind === 'daeri' ? '대리운전' : '택시 호출'} 상세</p>
              <button type="button" onClick={() => setDetail(null)} className="rounded-full bg-[#F1F5F9] px-3 py-1 text-[11px] font-black text-[#475569]">
                닫기
              </button>
            </div>
            <dl className="mt-3 space-y-1.5 text-[11px] font-bold text-[#475569]">
              <p><span className="text-[#94A3B8]">출발지</span> · {detail.pickup || '—'}</p>
              {detail.waypoints.length ? <p><span className="text-[#94A3B8]">경유지</span> · {detail.waypoints.join(' · ')}</p> : null}
              <p><span className="text-[#94A3B8]">목적지</span> · {detail.dest || '—'}</p>
              <p><span className="text-[#94A3B8]">요금</span> · {detail.estimatedFare.toFixed(2)} Pi{detail.waitMinutes ? ` · 기사 응답 대기 ${detail.waitMinutes}분` : ''}</p>
              <p><span className="text-[#94A3B8]">상태</span> · {statusOf(detail)}</p>
              <p><span className="text-[#94A3B8]">승객</span> · {detail.passengerId}{detail.passengerPhone ? ` · ${detail.passengerPhone}` : ''}</p>
              <p>
                <span className="text-[#94A3B8]">기사</span> ·{' '}
                {detail.driver ? `${detail.driver.name} ${detail.driver.vehicle || ''} ${detail.driver.plate || ''}`.trim() : '미배정'}
                {detail.driver?.phone ? ` · ${detail.driver.phone}` : ''}
              </p>
              <p><span className="text-[#94A3B8]">탑승 확인</span> · {fmt(detail.boardedAt)} · <span className="text-[#94A3B8]">도착 확인</span> · {fmt(detail.readyToSettleAt)}</p>
              <p><span className="text-[#94A3B8]">호출</span> · {fmt(detail.createdAt)} · <span className="text-[#94A3B8]">갱신</span> · {fmt(detail.updatedAt)}</p>
              <p className="break-all"><span className="text-[#94A3B8]">ID</span> · {detail.id}</p>
            </dl>
          </div>
        </div>
      ) : null}
    </section>
  )
}
