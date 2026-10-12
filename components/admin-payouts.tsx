'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import type { PayoutRequest, PayoutStatus } from '@/lib/payout-request-store'

const FILTERS: { id: PayoutStatus | 'all'; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'pending', label: '대기 중' },
  { id: 'approved', label: '승인 완료' },
  { id: 'rejected', label: '반려됨' },
  { id: 'failed', label: '송금 실패' },
]

const STATUS_META: Record<PayoutStatus, { label: string; cls: string }> = {
  pending: { label: '대기 중', cls: 'bg-[#FEF3C7] text-[#92400E]' },
  approved: { label: '승인 완료', cls: 'bg-[#DCFCE7] text-[#15803D]' },
  rejected: { label: '반려됨', cls: 'bg-[#FEE2E2] text-[#B91C1C]' },
  failed: { label: '송금 실패', cls: 'bg-[#F1F5F9] text-[#64748B]' },
}

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

/** 기사·파트너 수익 출금 신청 심사 — 상태 필터 + 승인(체인 송금)/반려. */
export default function AdminPayouts() {
  const [requests, setRequests] = useState<PayoutRequest[]>([])
  const [filter, setFilter] = useState<PayoutStatus | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [rejectFor, setRejectFor] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const res = await fetch('/api/admin/payouts', { headers: adminHeaders(), cache: 'no-store' }).catch(() => null)
    const data = (await res?.json().catch(() => null)) as { requests?: PayoutRequest[] } | null
    if (data?.requests) setRequests(data.requests)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(true), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const decide = async (id: string, action: 'approve' | 'reject', reason = '') => {
    setBusyId(id)
    setError('')
    try {
      const res = await fetch('/api/admin/payouts', {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id, reason }),
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; request?: PayoutRequest; error?: string } | null
      if (!res.ok || !data?.ok || !data.request) throw new Error(data?.error || '처리에 실패했습니다.')
      setRequests((prev) => prev.map((entry) => (entry.id === id ? data.request! : entry)))
      setRejectFor(null)
      setRejectReason('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '처리에 실패했습니다.')
    } finally {
      setBusyId('')
    }
  }

  const counts = FILTERS.map((f) => ({ ...f, n: f.id === 'all' ? requests.length : requests.filter((r) => r.status === f.id).length }))
  const filtered = filter === 'all' ? requests : requests.filter((entry) => entry.status === filter)

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-[#0F172A]">수익 출금 신청 심사</h2>
          <p className="mt-0.5 text-[11px] font-bold text-[#94A3B8]">기사·파트너의 출금 신청을 검토하고 승인 시 즉시 송금됩니다 · 15초마다 자동 갱신</p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-full bg-[#4A82B8] px-3 py-2 text-xs font-black text-white shadow-[0_6px_14px_rgba(74,130,184,0.28)]">
          새로고침
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {counts.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-black ${filter === f.id ? 'bg-[#4A82B8] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
          >
            {f.label} {f.n}
          </button>
        ))}
      </div>

      {error ? <p className="rounded-2xl border-2 border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-xs font-bold text-[#B91C1C]">{error}</p> : null}
      {loading ? <p className="rounded-2xl bg-[#F1F5F9] px-4 py-6 text-center text-xs font-bold text-[#64748B]">출금 신청 내역을 불러오는 중…</p> : null}

      {!loading && !filtered.length ? (
        <p className="rounded-2xl border-2 border-dashed border-[#CBD5E1] bg-white px-4 py-8 text-center text-xs font-bold text-[#94A3B8]">
          {filter === 'all' ? '접수된 출금 신청이 없습니다.' : '해당 상태의 신청이 없습니다.'}
        </p>
      ) : null}

      <ul className="space-y-2">
        {filtered.map((entry) => {
          const meta = STATUS_META[entry.status]
          const rejecting = rejectFor === entry.id
          return (
            <li key={entry.id} className="rounded-2xl border-2 border-[#E2E8F0] bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${entry.role === 'partner' ? 'bg-[#FEF3E2] text-[#D97706]' : 'bg-[#E6F7F4] text-[#0D9488]'}`}>
                    {entry.role === 'partner' ? '파트너' : '기사'}
                  </span>
                  <p className="text-sm font-black text-[#0F172A]">{entry.applicantName || entry.applicantId}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${meta.cls}`}>{meta.label}</span>
              </div>
              <p className="mt-2 text-lg font-black text-[#0F172A]">{entry.amount.toFixed(7)} <span className="text-xs font-bold text-[#64748B]">Pi</span></p>
              <div className="mt-1.5 space-y-0.5 text-[11px] font-bold text-[#64748B]">
                <p className="truncate" title={entry.wallet}>지갑 {entry.wallet}</p>
                <p>신청 {fmtDate(entry.createdAt)} · 신청자 ID {entry.applicantId.slice(0, 14)}</p>
                {entry.memo ? <p>메모: {entry.memo}</p> : null}
                {entry.decidedAt ? <p>처리 {fmtDate(entry.decidedAt)}{entry.decidedByName ? ` · ${entry.decidedByName}` : ''}</p> : null}
                {entry.txid ? <p className="truncate" title={entry.txid}>txid {entry.txid}</p> : null}
              </div>
              {entry.rejectReason ? <p className="mt-2 rounded-xl bg-[#FEF2F2] px-3 py-2 text-[11px] font-bold text-[#B91C1C]">반려 사유: {entry.rejectReason}</p> : null}
              {entry.error ? <p className="mt-2 rounded-xl bg-[#FFF7ED] px-3 py-2 text-[11px] font-bold text-[#B45309]">송금 오류: {entry.error}</p> : null}

              {entry.status === 'pending' ? (
                <div className="mt-3 border-t border-[#F1F5F9] pt-3">
                  {rejecting ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={rejectReason}
                        onChange={(event) => setRejectReason(event.target.value)}
                        placeholder="반려 사유를 입력해 주세요 (신청자에게 표시됩니다)"
                        className="w-full rounded-xl border-2 border-[#FCA5A5] bg-white px-3 py-2.5 text-xs font-bold outline-none focus:border-[#DC2626]"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busyId === entry.id || !rejectReason.trim()}
                          onClick={() => void decide(entry.id, 'reject', rejectReason.trim())}
                          className="flex-1 rounded-xl bg-[#DC2626] py-2.5 text-xs font-black text-white disabled:opacity-50"
                        >
                          {busyId === entry.id ? '처리 중…' : '반려 확정'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRejectFor(null)
                            setRejectReason('')
                          }}
                          className="rounded-xl bg-[#F1F5F9] px-4 py-2.5 text-xs font-black text-[#475569]"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busyId === entry.id}
                        onClick={() => void decide(entry.id, 'approve')}
                        className="flex-1 rounded-xl bg-[#15803D] py-2.5 text-xs font-black text-white shadow-[0_6px_14px_rgba(21,128,61,0.25)] disabled:opacity-50"
                      >
                        {busyId === entry.id ? '송금 중…' : '승인 · 즉시 송금'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === entry.id}
                        onClick={() => {
                          setRejectFor(entry.id)
                          setRejectReason('')
                        }}
                        className="flex-1 rounded-xl border-2 border-[#FCA5A5] bg-[#FEF2F2] py-2.5 text-xs font-black text-[#B91C1C] disabled:opacity-50"
                      >
                        반려
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
