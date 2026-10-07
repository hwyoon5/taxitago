'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { ShieldAlert } from 'lucide-react'
import { adminHeaders } from '@/lib/admin-key'
import { useAdminAuth } from '@/components/admin-guard'
import { isPiWalletAddress, piWalletError } from '@/lib/pi-wallet'
import type { WithdrawalRequest } from '@/lib/withdrawal-queue'

type Props = {
  /** Currently configured platform wallet — shown for context only. */
  adminWallet?: string
  /** Called after a successful withdrawal so the parent can refresh balances/audit. */
  onChanged?: () => void
}

/** 최종 확인 대상 — 신규 송금이거나 마스터 승인 대상 */
type ConfirmTarget =
  | { kind: 'send'; recipient: string; amount: number; memo: string }
  | { kind: 'approve'; request: WithdrawalRequest }

const STATUS_LABEL: Record<WithdrawalRequest['status'], string> = {
  pending: '승인 대기',
  approved: '승인·전송 완료',
  rejected: '거절됨',
  failed: '전송 실패',
}

const STATUS_TONE: Record<WithdrawalRequest['status'], string> = {
  pending: 'bg-[#FEF3C7] text-[#B45309]',
  approved: 'bg-[#DCFCE7] text-[#15803D]',
  rejected: 'bg-[#FEE2E2] text-[#B91C1C]',
  failed: 'bg-[#FEE2E2] text-[#B91C1C]',
}

export default function AdminWithdraw({ adminWallet = '', onChanged }: Props) {
  const { actor } = useAdminAuth()
  const isMaster = actor?.role === 'master'
  const [form, setForm] = useState({ recipient: '', amount: '', memo: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null)
  const [requests, setRequests] = useState<WithdrawalRequest[]>([])
  const [threshold, setThreshold] = useState(10)

  const tell = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 6000)
  }

  const loadRequests = () => {
    void fetch('/api/admin/withdraw', { headers: adminHeaders(), cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as {
          requests?: WithdrawalRequest[]
          approvalThreshold?: number
        } | null
        if (!res.ok) return
        setRequests(data?.requests ?? [])
        if (typeof data?.approvalThreshold === 'number') setThreshold(data.approvalThreshold)
      })
      .catch(() => undefined)
  }

  useEffect(() => {
    loadRequests()
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const recipient = form.recipient.trim()
    const amount = Number(form.amount)
    if (!isPiWalletAddress(recipient)) {
      setError(piWalletError(recipient) ?? '수신 지갑 주소가 올바르지 않습니다.')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('출금 금액을 확인해 주세요.')
      return
    }
    setError('')
    // 온체인 송금은 되돌릴 수 없으므로 주소·금액 재확인 모달을 거친다.
    setConfirmTarget({ kind: 'send', recipient, amount, memo: form.memo.trim() })
  }

  const executeSend = (target: Extract<ConfirmTarget, { kind: 'send' }>) => {
    setConfirmTarget(null)
    setBusy(true)
    setError('')
    void fetch('/api/admin/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ recipientAddress: target.recipient, amount: target.amount, memo: target.memo }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as {
          txid?: string
          pending?: boolean
          error?: string
        } | null
        if (!res.ok) throw new Error(data?.error || 'withdraw_failed')
        return data
      })
      .then((data) => {
        if (data?.pending) {
          tell(`승인 대기로 등록되었습니다. ${threshold} Pi를 초과하는 직원 출금은 최고 관리자 승인 후 전송됩니다.`)
        } else {
          tell(`출금 완료 — txid ${data?.txid ? `${data.txid.slice(0, 16)}…` : '(해시 없음)'}`)
        }
        setForm({ recipient: '', amount: '', memo: '' })
        loadRequests()
        onChanged?.()
      })
      .catch((err) => setError(err instanceof Error ? err.message : '출금에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const executeApprove = (request: WithdrawalRequest) => {
    setConfirmTarget(null)
    setBusy(true)
    setError('')
    void fetch('/api/admin/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ action: 'approve', id: request.id }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { txid?: string; error?: string } | null
        if (!res.ok) throw new Error(data?.error || 'approve_failed')
        return data
      })
      .then((data) => {
        tell(`승인 완료 — 전송됨 txid ${data?.txid ? `${data.txid.slice(0, 16)}…` : ''}`)
        loadRequests()
        onChanged?.()
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '승인 처리에 실패했습니다.')
        loadRequests()
      })
      .finally(() => setBusy(false))
  }

  const rejectRequest = (request: WithdrawalRequest) => {
    if (busy) return
    setBusy(true)
    setError('')
    void fetch('/api/admin/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ action: 'reject', id: request.id }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        if (!res.ok) throw new Error(data?.error || 'reject_failed')
      })
      .then(() => {
        tell('출금 요청을 거절했습니다.')
        loadRequests()
      })
      .catch((err) => setError(err instanceof Error ? err.message : '거절 처리에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const confirmRecipient = confirmTarget?.kind === 'send' ? confirmTarget.recipient : confirmTarget?.request.recipient ?? ''
  const confirmAmount = confirmTarget?.kind === 'send' ? confirmTarget.amount : confirmTarget?.request.amount ?? 0

  const pendingCount = requests.filter((row) => row.status === 'pending').length

  return (
    <section className="rounded-2xl border-2 border-[#FDE68A] bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-black">수수료 출금 (관리자 지갑 → 외부)</p>
        <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10px] font-black text-[#B45309]">주의</span>
      </div>
      <p className="mt-1 text-[10px] font-bold leading-4 text-[#94A3B8]">
        등록된 관리자 지갑에서 외부 주소로 Pi를 전송합니다. 전송은 되돌릴 수 없으며 네트워크 수수료(0.01 Pi)가 추가로 차감됩니다.
        {isPiWalletAddress(adminWallet) ? ` 출금 지갑: ${adminWallet.slice(0, 12)}…` : ' 관리자 지갑 주소가 아직 등록되지 않았습니다.'}
      </p>
      {!isMaster ? (
        <p className="mt-1.5 flex items-center gap-1 rounded-lg bg-[#FFFBEB] px-2 py-1.5 text-[10px] font-black text-[#B45309]">
          <ShieldAlert size={12} /> 직원 계정은 {threshold} Pi 초과 송금 시 최고 관리자 승인 후 전송됩니다.
        </p>
      ) : null}
      <form onSubmit={submit} className="mt-3 space-y-2">
        <label className="block">
          <span className="text-[10px] font-black text-[#64748B]">받는 지갑 주소</span>
          <input
            type="text"
            required
            value={form.recipient}
            onChange={(event) => setForm((prev) => ({ ...prev, recipient: event.target.value }))}
            placeholder="G로 시작하는 56자리 주소"
            className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] font-black text-[#64748B]">출금 금액 (Pi)</span>
            <input
              type="number"
              required
              min={0}
              step={0.0000001}
              value={form.amount}
              onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
              placeholder="10"
              className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-black text-[#64748B]">메모 (선택)</span>
            <input
              type="text"
              maxLength={28}
              value={form.memo}
              onChange={(event) => setForm((prev) => ({ ...prev, memo: event.target.value }))}
              placeholder="예: 10월 수수료 출금"
              className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
            />
          </label>
        </div>
        {error ? <p className="text-xs font-black text-[#DC2626]">{error}</p> : null}
        {notice ? <p className="text-xs font-black text-[#047857]">{notice}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-[#B45309] py-2 text-xs font-black text-white disabled:opacity-50"
        >
          {busy ? '전송 중…' : '출금 실행'}
        </button>
      </form>

      {requests.length ? (
        <div className="mt-4 border-t-2 border-dashed border-[#E2E8F0] pt-3">
          <p className="flex items-center justify-between text-xs font-black text-[#B45309]">
            <span>출금 승인 요청{pendingCount ? ` · 대기 ${pendingCount}건` : ''}</span>
            <button
              type="button"
              onClick={loadRequests}
              className="rounded-full border border-[#FDE68A] bg-white px-2 py-0.5 text-[10px] font-black text-[#B45309]"
            >
              새로고침
            </button>
          </p>
          <div className="mt-2 space-y-2">
            {requests.slice(0, 10).map((row) => (
              <div key={row.id} className="rounded-xl border-2 border-[#FDE68A] bg-[#FFFBEB] p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-black text-[#0F172A]">
                    {row.amount.toFixed(7)} Pi
                    <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-black ${STATUS_TONE[row.status]}`}>
                      {STATUS_LABEL[row.status]}
                    </span>
                  </p>
                  <span className="text-[10px] font-bold text-[#94A3B8]">
                    {new Date(row.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="mt-1 break-all text-[10px] font-bold text-[#64748B]">→ {row.recipient}</p>
                <p className="mt-0.5 text-[10px] font-bold text-[#94A3B8]">
                  요청: {row.requestedByName || row.requestedBy}({row.requestedBy})
                  {row.memo ? ` · 메모: ${row.memo}` : ''}
                  {row.decidedBy ? ` · 처리: ${row.decidedByName || row.decidedBy}` : ''}
                  {row.txid ? ` · txid ${row.txid.slice(0, 12)}…` : ''}
                </p>
                {row.error ? <p className="mt-0.5 text-[10px] font-black text-[#DC2626]">전송 오류: {row.error}</p> : null}
                {row.status === 'pending' && isMaster ? (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmTarget({ kind: 'approve', request: row })}
                      className="flex-1 rounded-lg bg-[#15803D] py-1.5 text-[10px] font-black text-white disabled:opacity-50"
                    >
                      승인 후 전송
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => rejectRequest(row)}
                      className="flex-1 rounded-lg border-2 border-[#FCA5A5] bg-white py-1.5 text-[10px] font-black text-[#DC2626] disabled:opacity-50"
                    >
                      거절
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {confirmTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6">
          <div className="w-full max-w-sm rounded-[24px] bg-white p-5 shadow-2xl">
            <p className="flex items-center gap-1.5 text-sm font-black text-[#B45309]">
              <ShieldAlert size={16} />
              {confirmTarget.kind === 'approve' ? '승인·송금 최종 확인' : '송금 최종 확인'}
            </p>
            <p className="mt-1 text-xs font-bold text-[#64748B]">
              {confirmTarget.kind === 'approve'
                ? '아래 출금 요청을 승인하면 즉시 블록체인으로 전송됩니다.'
                : '아래 내용을 확인한 뒤 송금을 진행해 주세요. 실행 후에는 되돌릴 수 없습니다.'}
            </p>
            <div className="mt-3 rounded-2xl bg-[#F8FAFC] p-3">
              <p className="text-[10px] font-black text-[#64748B]">받는 주소</p>
              <p className="mt-0.5 break-all text-xs font-black text-[#0F172A]">{confirmRecipient}</p>
              <p className="mt-2 text-[10px] font-black text-[#64748B]">송금 금액</p>
              <p className="mt-0.5 text-lg font-black text-[#B45309]">{confirmAmount.toFixed(7)} Pi</p>
              {confirmTarget.kind === 'approve' ? (
                <p className="mt-1 text-[10px] font-bold text-[#94A3B8]">
                  요청자: {confirmTarget.request.requestedByName || confirmTarget.request.requestedBy}
                </p>
              ) : null}
              <p className="mt-1 text-[10px] font-bold text-[#94A3B8]">네트워크 수수료 0.01 Pi가 별도로 차감됩니다.</p>
            </div>
            <p className="mt-3 text-center text-xs font-black text-[#0F172A]">정말 송금하시겠습니까?</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                className="flex-1 rounded-xl border-2 border-[#CBD5E1] bg-white py-2.5 text-xs font-black text-[#64748B]"
              >
                취소
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  confirmTarget.kind === 'send' ? executeSend(confirmTarget) : executeApprove(confirmTarget.request)
                }
                className="flex-1 rounded-xl bg-[#B45309] py-2.5 text-xs font-black text-white disabled:opacity-50"
              >
                {confirmTarget.kind === 'approve' ? '승인하고 송금' : '송금 확인'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
