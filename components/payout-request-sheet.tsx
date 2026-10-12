'use client'

import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { PayoutRequest } from '@/lib/payout-request-store'

const STATUS_META: Record<PayoutRequest['status'], { label: string; cls: string }> = {
  pending: { label: '심사 대기', cls: 'bg-[#FEF3C7] text-[#92400E]' },
  approved: { label: '지급 완료', cls: 'bg-[#DCFCE7] text-[#15803D]' },
  rejected: { label: '반려됨', cls: 'bg-[#FEE2E2] text-[#B91C1C]' },
  failed: { label: '송금 실패', cls: 'bg-[#F1F5F9] text-[#64748B]' },
}

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

/** 기사·파트너 수익 출금 신청 시트 — 신청 폼 + 내 신청 내역·처리 상태. */
export default function PayoutRequestSheet({
  applicantId,
  aliasIds = [],
  role = 'driver',
  name,
  wallet,
  onClose,
  onNotice,
}: {
  applicantId: string
  aliasIds?: string[]
  role?: 'driver' | 'partner'
  name?: string
  wallet?: string
  onClose: () => void
  onNotice?: (message: string) => void
}) {
  const [available, setAvailable] = useState<number | null>(null)
  const [requests, setRequests] = useState<PayoutRequest[]>([])
  const [amount, setAmount] = useState('')
  const [walletInput, setWalletInput] = useState(wallet ?? '')
  const [memo, setMemo] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!applicantId) return
    const params = new URLSearchParams({ driverId: applicantId })
    for (const alias of aliasIds) params.append('altDriverId', alias)
    const res = await fetch(`/api/payout-requests?${params}`, { cache: 'no-store' }).catch(() => null)
    const data = (await res?.json().catch(() => null)) as { requests?: PayoutRequest[]; available?: number } | null
    if (data) {
      setRequests(Array.isArray(data.requests) ? data.requests : [])
      if (typeof data.available === 'number') setAvailable(data.available)
    }
  }, [applicantId, aliasIds])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const submit = async () => {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setError('출금 금액을 입력해 주세요.')
      return
    }
    if (available != null && value > available) {
      setError(`출금 가능 수익(${available.toFixed(7)} Pi)을 초과했습니다.`)
      return
    }
    if (!walletInput.trim()) {
      setError('정산 받을 지갑 주소를 입력해 주세요.')
      return
    }
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/payout-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId: applicantId, altDriverId: aliasIds, role, name, amount: value, wallet: walletInput.trim(), memo }),
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; available?: number; error?: string } | null
      if (!res.ok || !data?.ok) throw new Error(data?.error || '신청에 실패했습니다.')
      setAmount('')
      setMemo('')
      if (typeof data.available === 'number') setAvailable(data.available)
      await load()
      onNotice?.('출금 신청이 접수되었습니다. 관리자 승인 후 지급됩니다.')
    } catch (err) {
      setError(err instanceof Error ? err.message : '신청에 실패했습니다.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-slate-900/45 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-[32px] bg-white shadow-2xl sm:rounded-[32px]" onClick={(event) => event.stopPropagation()}>
        <div className="px-5 pt-4">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#4A82B8]">수익 출금</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">출금 신청</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">
                출금 가능 수익 <span className="text-[#4A82B8]">{available != null ? `${available.toFixed(7)} Pi` : '…'}</span> · 관리자 승인 후 지갑으로 지급됩니다
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full bg-slate-100 p-2 text-slate-600" aria-label="출금 신청 닫기">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          <div className="space-y-2.5 rounded-2xl border-2 border-[#E2E8F0] bg-[#F8FAFC] p-4">
            <div>
              <label className="text-[11px] font-black text-slate-600">출금 금액 (Pi)</label>
              <div className="mt-1 flex gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.0000001"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.0000000"
                  className="min-w-0 flex-1 rounded-xl border-2 border-[#E2E8F0] bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4A82B8]"
                />
                <button
                  type="button"
                  onClick={() => available != null && setAmount(String(available))}
                  className="shrink-0 rounded-xl bg-[#E8F1FA] px-3 text-xs font-black text-[#4A82B8]"
                >
                  전액
                </button>
              </div>
            </div>
            <div>
              <label className="text-[11px] font-black text-slate-600">정산 지갑 주소</label>
              <input
                type="text"
                value={walletInput}
                onChange={(event) => setWalletInput(event.target.value)}
                placeholder="G로 시작하는 Pi 지갑 주소"
                className="mt-1 w-full rounded-xl border-2 border-[#E2E8F0] bg-white px-3 py-2.5 text-xs font-bold outline-none focus:border-[#4A82B8]"
              />
            </div>
            <div>
              <label className="text-[11px] font-black text-slate-600">메모 (선택)</label>
              <input
                type="text"
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                maxLength={60}
                placeholder="정산 요청 메모"
                className="mt-1 w-full rounded-xl border-2 border-[#E2E8F0] bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4A82B8]"
              />
            </div>
            {error ? <p className="rounded-xl bg-[#FEF2F2] px-3 py-2 text-xs font-bold text-[#B91C1C]">{error}</p> : null}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={sending || !applicantId}
              className="w-full rounded-xl bg-[#4A82B8] py-3 text-sm font-black text-white shadow-[0_8px_16px_rgba(74,130,184,0.28)] disabled:opacity-60"
            >
              {sending ? '신청 중…' : '출금 신청하기'}
            </button>
          </div>

          <p className="mt-4 text-xs font-black text-slate-600">내 신청 내역</p>
          <ul className="mt-2 space-y-2">
            {!requests.length ? (
              <li className="rounded-2xl border-2 border-dashed border-[#E2E8F0] px-3 py-4 text-center text-xs font-bold text-slate-400">
                아직 출금 신청 내역이 없습니다
              </li>
            ) : (
              requests.map((entry) => {
                const meta = STATUS_META[entry.status]
                return (
                  <li key={entry.id} className="rounded-2xl border border-[#E2E8F0] bg-white px-3.5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-black text-slate-900">{entry.amount.toFixed(7)} Pi</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${meta.cls}`}>{meta.label}</span>
                    </div>
                    <p className="mt-1 truncate text-[11px] font-bold text-slate-500" title={entry.wallet}>{entry.wallet}</p>
                    <p className="mt-0.5 text-[10px] font-bold text-slate-400">
                      {fmtDate(entry.createdAt)}
                      {entry.decidedByName ? ` · 처리 ${entry.decidedByName}` : ''}
                      {entry.txid ? ` · txid ${entry.txid.slice(0, 12)}…` : ''}
                    </p>
                    {entry.rejectReason ? <p className="mt-1 rounded-lg bg-[#FEF2F2] px-2 py-1 text-[11px] font-bold text-[#B91C1C]">반려 사유: {entry.rejectReason}</p> : null}
                    {entry.error ? <p className="mt-1 rounded-lg bg-[#FFF7ED] px-2 py-1 text-[11px] font-bold text-[#B45309]">송금 오류: {entry.error}</p> : null}
                  </li>
                )
              })
            )}
          </ul>
        </div>
      </section>
    </div>
  )
}
