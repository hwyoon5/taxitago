'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import { PageSizeSelect, PaginationBar, usePagination } from '@/components/admin-pagination'

type AdminReceivable = {
  id: string
  userId: string
  wallet: string
  phone: string
  service: string
  serviceKey: string
  partnerId: string
  partnerName: string
  deviceId: string
  place: string
  amount: number
  reason: string
  detail: string
  status: 'open' | 'settled' | 'void'
  attempts: number
  createdAt: string
  settledAt: string | null
  settledBy: string
  settleNote: string
}

const STATUS_META: Record<AdminReceivable['status'], { label: string; cls: string }> = {
  open: { label: '미수', cls: 'bg-[#FEF3C7] text-[#B45309]' },
  settled: { label: '정산 완료', cls: 'bg-[#DCFCE7] text-[#15803D]' },
  void: { label: '무효', cls: 'bg-[#F1F5F9] text-[#64748B]' },
}

const REASON_LABEL: Record<string, string> = {
  insufficient: '잔액 부족',
  cancelled: '사용자 취소',
  failed: '결제 실패',
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

/**
 * 미수금 관리 장부 — 셀프·무인 서비스의 결제 실패 건을 실시간으로 조회하고
 * 수동 정산 완료/무효 처리한다. 이용자 Pi 지갑·가입 전화번호·최종 이용내역을
 * 한 행에 보여 운영자가 곧바로 연락·후속 조치를 취할 수 있게 한다.
 */
export default function AdminReceivables() {
  const [items, setItems] = useState<AdminReceivable[]>([])
  const [openTotal, setOpenTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('open')
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/api/admin/receivables?${params.toString()}`, { headers: adminHeaders(), cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as { items?: AdminReceivable[]; openTotal?: number; error?: string } | null
      if (!res.ok || !data?.items) {
        setError(data?.error || '조회에 실패했습니다.')
        if (!silent) setItems([])
        return
      }
      setItems(data.items)
      setOpenTotal(typeof data.openTotal === 'number' ? data.openTotal : 0)
    } catch {
      if (!silent) {
        setError('네트워크 오류')
        setItems([])
      }
    } finally {
      setLoading(false)
    }
  }, [status, q])

  // 진입 시 로드 + 15초 자동 갱신 — 결제 실패가 실시간으로 올라온다.
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(true), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const resolve = async (row: AdminReceivable, action: 'settle' | 'void') => {
    if (busyId) return
    const note = window.prompt(
      action === 'settle'
        ? `미수금 ${row.amount} Pi를 수동 정산 완료 처리합니다.\n처리 메모(계좌이체 확인 등)를 입력해 주세요.`
        : `미수금 ${row.amount} Pi를 무효 처리합니다.\n사유를 입력해 주세요.`,
      '',
    )
    if (note === null) return
    setBusyId(row.id)
    try {
      const res = await fetch('/api/admin/receivables', {
        method: 'PATCH',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, action, note }),
      })
      const data = (await res.json().catch(() => null)) as { receivable?: AdminReceivable; error?: string } | null
      if (!res.ok || !data?.receivable) {
        setError(data?.error || '처리에 실패했습니다.')
        return
      }
      setItems((prev) => prev.map((item) => (item.id === row.id ? data.receivable! : item)))
      if (status === 'open' && data.receivable.status !== 'open') {
        setItems((prev) => prev.filter((item) => item.id !== row.id))
      }
    } catch {
      setError('네트워크 오류')
    } finally {
      setBusyId('')
    }
  }

  const pagination = usePagination(items, 10, [status, q])

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-black text-[#334155]">
          미수금 장부 · 미수 합계 <span className="text-[#B45309]">{openTotal.toFixed(7)} Pi</span>
        </p>
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
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-[#CBD5E1] bg-white px-2 py-1.5 text-[11px] font-bold text-[#0F172A] outline-none">
          <option value="">전체 상태</option>
          <option value="open">미수</option>
          <option value="settled">정산 완료</option>
          <option value="void">무효</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void load() }}
          placeholder="이용자·지갑·전화번호·기기 검색"
          className="rounded-lg border border-[#CBD5E1] bg-white px-2 py-1.5 text-[11px] font-bold text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
        />
      </div>
      <button type="button" onClick={() => void load()} className="mt-2 w-full rounded-xl bg-[#4A82B8] py-2 text-xs font-black text-white">
        조회
      </button>
      {error ? <p className="mt-2 text-[11px] font-bold text-[#DC2626]">{error}</p> : null}

      <div className="mt-3 space-y-2">
        {pagination.paged.map((row) => {
          const meta = STATUS_META[row.status] ?? STATUS_META.open
          return (
            <div key={row.id} className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <p className="min-w-0 flex-1 truncate text-[12px] font-black text-[#0F172A]">
                  {row.service}
                  <span className="font-bold text-[#64748B]">{row.place ? ` · ${row.place}` : ''}</span>
                </p>
                <span className="shrink-0 rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10px] font-black text-[#B45309]">
                  {row.amount.toFixed(4)} Pi
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${meta.cls}`}>{meta.label}</span>
              </div>
              <p className="mt-1 text-[10px] font-bold text-[#64748B]">
                {fmt(row.createdAt)} · {REASON_LABEL[row.reason] ?? row.reason}
                {row.attempts > 1 ? ` · 실패 ${row.attempts}회` : ''}
                {row.partnerName ? ` · 제공자 ${row.partnerName}` : ''}
                {row.deviceId ? ` · 기기 ${row.deviceId}` : ''}
              </p>
              <div className="mt-1.5 grid grid-cols-1 gap-1 text-[10px] font-bold">
                <p className="truncate text-[#475569]">
                  이용자 {row.userId || '—'}
                  {row.phone ? <a href={`tel:${row.phone}`} className="ml-1 text-[#4A82B8] underline">📞 {row.phone}</a> : <span className="text-[#94A3B8]"> · 전화 미등록</span>}
                </p>
                {row.wallet ? (
                  <p className="truncate font-mono text-[9px] text-[#64748B]" title={row.wallet}>
                    지갑 {row.wallet}
                  </p>
                ) : null}
                {row.detail ? <p className="truncate text-[#94A3B8]">사유 {row.detail}</p> : null}
                {row.status !== 'open' && row.settleNote ? (
                  <p className="text-[#15803D]">처리 {fmt(row.settledAt)} · {row.settledBy} · {row.settleNote}</p>
                ) : null}
              </div>
              {row.status === 'open' ? (
                <div className="mt-2 flex gap-1.5">
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void resolve(row, 'settle')}
                    className="flex-1 rounded-lg bg-[#15803D] py-1.5 text-[11px] font-black text-white disabled:opacity-50"
                  >
                    수동 정산 완료
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void resolve(row, 'void')}
                    className="rounded-lg bg-[#F1F5F9] px-3 py-1.5 text-[11px] font-black text-[#64748B] disabled:opacity-50"
                  >
                    무효
                  </button>
                </div>
              ) : null}
            </div>
          )
        })}
        {!loading && !items.length ? (
          <p className="rounded-xl bg-[#F8FAFC] px-3 py-4 text-center text-[11px] font-bold text-[#94A3B8]">
            조건에 맞는 미수금이 없습니다.
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
