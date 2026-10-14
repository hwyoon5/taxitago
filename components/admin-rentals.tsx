'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import { PageSizeSelect, PaginationBar, usePagination } from '@/components/admin-pagination'

type AdminRental = {
  id: string
  deviceId: string
  type: string
  model: string
  address: string
  ownerUid: string
  ownerName: string
  renterId: string
  rentedAt: string
  returnedAt: string | null
  status: 'rented' | 'returned'
}

const STATUS_META: Record<AdminRental['status'], { label: string; cls: string }> = {
  rented: { label: '대여 중', cls: 'bg-[#DCFCE7] text-[#15803D]' },
  returned: { label: '반납 완료', cls: 'bg-[#F1F5F9] text-[#64748B]' },
}

const KIND_LABEL: Record<string, string> = { bicycle: '자전거', kickboard: '킥보드' }

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

const fmtDuration = (start: string, end: string | null) => {
  if (!end) return ''
  const mins = Math.round((Date.parse(end) - Date.parse(start)) / 60000)
  if (!Number.isFinite(mins) || mins < 0) return ''
  return mins < 60 ? ` · ${mins}분 이용` : ` · ${Math.floor(mins / 60)}시간 ${mins % 60}분 이용`
}

/** 공유 모빌리티 대여 이력 검색 — 대여 현황 카드 하단에 붙는 이력 조회 영역. */
export default function AdminRentals() {
  const [items, setItems] = useState<AdminRental[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (status) params.set('status', status)
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/api/admin/rentals?${params.toString()}`, { headers: adminHeaders(), cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as { items?: AdminRental[]; error?: string } | null
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

  // 진입 시 전체 이력 로드 + 30초 자동 갱신.
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const pagination = usePagination(items, 10, [from, to, status, q])

  return (
    <div className="mt-3 border-t border-[#E2E8F0] pt-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-black text-[#334155]">대여 이력 검색</p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1 text-[11px] font-black text-[#475569] disabled:opacity-50"
        >
          {loading ? '조회 중…' : '새로고침'}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
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
          <option value="rented">대여 중</option>
          <option value="returned">반납 완료</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void load() }}
          placeholder="기기·주소·파트너·대여자 검색"
          className="rounded-lg border border-[#CBD5E1] bg-white px-2 py-1.5 text-[11px] font-bold text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
        />
      </div>
      <button type="button" onClick={() => void load()} className="mt-2 w-full rounded-xl bg-[#4A82B8] py-2 text-xs font-black text-white">
        조회
      </button>
      {error ? <p className="mt-2 text-[11px] font-bold text-[#DC2626]">{error}</p> : null}

      <div className="mt-3 space-y-2">
        {pagination.paged.map((row) => {
          const meta = STATUS_META[row.status] ?? STATUS_META.returned
          return (
            <div key={row.id} className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <p className="min-w-0 flex-1 truncate text-[12px] font-black text-[#0F172A]">
                  {row.deviceId}
                  {row.model ? ` · ${row.model}` : ''}
                  <span className="font-bold text-[#64748B]">{row.address ? ` · ${row.address}` : ''}</span>
                </p>
                <span className="shrink-0 rounded-full bg-[#E8F1FA] px-2 py-0.5 text-[10px] font-black text-[#4A82B8]">
                  {KIND_LABEL[row.type] ?? row.type}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${meta.cls}`}>{meta.label}</span>
              </div>
              <p className="mt-1 text-[10px] font-bold text-[#64748B]">
                대여 {fmt(row.rentedAt)} → 반납 {fmt(row.returnedAt)}{fmtDuration(row.rentedAt, row.returnedAt)}
                {row.ownerName ? ` · 파트너 ${row.ownerName}` : ''}
                {row.renterId ? ` · 대여자 ${row.renterId.slice(0, 12)}` : ''}
              </p>
            </div>
          )
        })}
        {!loading && !items.length ? (
          <p className="rounded-xl bg-[#F8FAFC] px-3 py-4 text-center text-[11px] font-bold text-[#94A3B8]">
            조건에 맞는 대여 이력이 없습니다.
          </p>
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
    </div>
  )
}
