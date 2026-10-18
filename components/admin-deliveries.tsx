'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import { PageSizeSelect, PaginationBar, usePagination } from '@/components/admin-pagination'

type AdminDelivery = {
  id: string
  ownerId: string
  pickupAddress: string
  destAddress: string
  packageLabel: string
  vehicle: string | null
  packageSize: string | null
  fare: number
  scheduledAt: string | null
  status: 'requested' | 'assigned' | 'in_transit' | 'completed' | 'expired'
  senderPhone: string
  recipientPhone: string
  driverId: string | null
  driverName: string | null
  driverPhone: string | null
  driverVehicle: string | null
  driverPlate: string | null
  photoCount: number
  paymentMethod: 'prepay_pi' | 'onsite_qr' | null
  paymentTxid: string | null
  paidAt: string | null
  createdAt: string
  updatedAt: string
}

/** 단계 순서 — 현황판 배지와 동일하게 등록→수락→수행→완료. */
const STAGES = ['등록', '수락', '수행', '완료'] as const
const STAGE_INDEX: Record<AdminDelivery['status'], number> = { requested: 0, assigned: 1, in_transit: 2, completed: 3, expired: 0 }
const STAGE_COLORS = [
  'bg-[#DBEAFE] text-[#1D4ED8]',
  'bg-[#E8F1FA] text-[#4A82B8]',
  'bg-[#FEF3C7] text-[#B45309]',
  'bg-[#D1FAE5] text-[#047857]',
] as const

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

export default function AdminDeliveries() {
  const [items, setItems] = useState<AdminDelivery[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [detail, setDetail] = useState<AdminDelivery | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (status) params.set('status', status)
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/api/admin/deliveries?${params.toString()}`, { headers: adminHeaders(), cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as { items?: AdminDelivery[]; error?: string } | null
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
  }, [from, to, status, q])

  // 진입 시 전체 이력 로드 + 30초 자동 갱신(실시간 현황판).
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const pagination = usePagination(items, 10, [from, to, status, q])

  const payLabel = (row: AdminDelivery) =>
    row.paidAt ? '결제 완료' : row.paymentMethod === 'onsite_qr' ? '현장 결제 예정' : row.paymentMethod === 'prepay_pi' ? '선결제 진행' : '미선택'

  return (
    <section className="mt-4 rounded-2xl border-2 border-[#E2E8F0] bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black text-[#334155]">택배 현황 · 이력</h3>
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
          <option value="">전체 상태</option>
          <option value="requested">등록(미배차)</option>
          <option value="assigned">수락(배차 완료)</option>
          <option value="in_transit">수행(배송 중)</option>
          <option value="completed">완료</option>
          <option value="expired">만료</option>
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

      {/* 목록 — 주소 우측에 상세보기, 그 우측에 4단계 박스(현재 단계만 컬러). */}
      <div className="mt-3 space-y-2">
        {pagination.paged.map((row) => {
          const stage = STAGE_INDEX[row.status] ?? 0
          return (
            <div key={row.id} className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <p className="min-w-0 flex-1 truncate text-[12px] font-black text-[#0F172A]">
                  {row.pickupAddress} → {row.destAddress}
                </p>
                <button
                  type="button"
                  onClick={() => setDetail(row)}
                  className="shrink-0 rounded-lg bg-[#4A82B8] px-2 py-1 text-[10px] font-black text-white"
                >
                  상세보기
                </button>
                {row.status === 'expired' ? (
                  <span className="shrink-0 rounded-md bg-[#F1F5F9] px-1.5 py-0.5 text-[9px] font-black text-[#64748B]">만료</span>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    {STAGES.map((label, index) => (
                      <span
                        key={label}
                        className={`rounded-md px-1.5 py-0.5 text-[9px] font-black ${
                          index === stage ? STAGE_COLORS[index] : 'bg-[#F1F5F9] text-[#CBD5E1]'
                        }`}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <p className="mt-1 text-[10px] font-bold text-[#64748B]">
                {fmt(row.createdAt)} · {row.packageLabel} · {row.fare.toFixed(2)} Pi · {payLabel(row)}
                {row.driverName ? ` · ${row.driverName}` : ''}
                {row.photoCount ? ` · 사진 ${row.photoCount}장` : ''}
              </p>
            </div>
          )
        })}
        {!loading && !items.length ? (
          <p className="rounded-xl bg-[#F8FAFC] px-3 py-4 text-center text-[11px] font-bold text-[#94A3B8]">
            조건에 맞는 택배 이력이 없습니다.
          </p>
        ) : null}
      </div>

      {/* 페이지 크기 선택 + 페이지 네비게이션 */}
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
              <p className="text-sm font-black text-[#0F172A]">택배 상세</p>
              <button type="button" onClick={() => setDetail(null)} className="rounded-full bg-[#F1F5F9] px-3 py-1 text-[11px] font-black text-[#475569]">
                닫기
              </button>
            </div>
            <dl className="mt-3 space-y-1.5 text-[11px] font-bold text-[#475569]">
              <p><span className="text-[#94A3B8]">출발지</span> · {detail.pickupAddress}</p>
              <p><span className="text-[#94A3B8]">도착지</span> · {detail.destAddress}</p>
              <p><span className="text-[#94A3B8]">상품</span> · {detail.packageLabel}{detail.vehicle ? ` · ${detail.vehicle}` : ''}</p>
              <p><span className="text-[#94A3B8]">요금</span> · {detail.fare.toFixed(2)} Pi · {payLabel(detail)}{detail.paymentTxid ? ` (${detail.paymentTxid.slice(0, 12)}…)` : ''}</p>
              <p><span className="text-[#94A3B8]">예약</span> · {detail.scheduledAt ? fmt(detail.scheduledAt) : '즉시'}</p>
              <p><span className="text-[#94A3B8]">발신인</span> · {detail.senderPhone || '—'}</p>
              <p><span className="text-[#94A3B8]">수신인</span> · {detail.recipientPhone || '—'}</p>
              <p><span className="text-[#94A3B8]">기사</span> · {detail.driverName ? `${detail.driverName} ${detail.driverVehicle ?? ''} ${detail.driverPlate ?? ''}`.trim() : '미배정'}{detail.driverPhone ? ` · ${detail.driverPhone}` : ''}</p>
              <p><span className="text-[#94A3B8]">사진</span> · {detail.photoCount}장</p>
              <p><span className="text-[#94A3B8]">등록</span> · {fmt(detail.createdAt)} · <span className="text-[#94A3B8]">갱신</span> · {fmt(detail.updatedAt)}</p>
              <p className="break-all"><span className="text-[#94A3B8]">ID</span> · {detail.id} · owner {detail.ownerId || '—'}</p>
            </dl>
            <div className="mt-3 flex items-center gap-1.5">
              {detail.status === 'expired' ? (
                <span className="flex-1 rounded-lg bg-[#F1F5F9] py-1.5 text-center text-[10px] font-black text-[#64748B]">만료 — 기사 매칭 시간 경과</span>
              ) : (
                STAGES.map((label, index) => (
                  <span
                    key={label}
                    className={`flex-1 rounded-lg py-1.5 text-center text-[10px] font-black ${
                      index === STAGE_INDEX[detail.status] ? STAGE_COLORS[index] : 'bg-[#F1F5F9] text-[#CBD5E1]'
                    }`}
                  >
                    {label}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
