'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { ShieldAlert } from 'lucide-react'
import { adminHeaders } from '@/lib/admin-key'
import { useAdminAuth } from '@/components/admin-guard'
import { isPiWalletAddress, piWalletError } from '@/lib/pi-wallet'
import type { WithdrawalRequest } from '@/lib/withdrawal-queue'
import { PaginationBar, PageSizeSelect } from '@/components/admin-pagination'
import { AdminDetailModal } from '@/components/admin-detail-modal'
import { AdminExportButton } from '@/components/admin-export-button'

type Props = {
  /** Currently configured platform wallet — shown for context only. */
  adminWallet?: string
  /** Called after a successful withdrawal so the parent can refresh balances/audit. */
  onChanged?: () => void
}

/** 최종 확인 대상 — 신규 송금이거나 마스터 승인 대상 */
type ConfirmTarget =
  | { kind: 'send'; recipient: string; amount: number; memo: string; reason: string }
  | { kind: 'approve'; request: WithdrawalRequest }

const STATUS_LABEL: Record<WithdrawalRequest['status'], string> = {
  pending: '승인 대기',
  approved: '승인·전송 완료',
  rejected: '거절됨',
  sent: '즉시 전송',
  failed: '전송 실패',
}

const STATUS_TONE: Record<WithdrawalRequest['status'], string> = {
  pending: 'bg-[#FEF3C7] text-[#B45309]',
  approved: 'bg-[#DCFCE7] text-[#15803D]',
  rejected: 'bg-[#FEE2E2] text-[#B91C1C]',
  sent: 'bg-[#DBEAFE] text-[#1D4ED8]',
  failed: 'bg-[#FEE2E2] text-[#B91C1C]',
}

export default function AdminWithdraw({ adminWallet = '', onChanged }: Props) {
  const { actor } = useAdminAuth()
  const isMaster = actor?.role === 'master'
  const [form, setForm] = useState({ recipient: '', amount: '', memo: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null)
  const [requests, setRequests] = useState<WithdrawalRequest[]>([])
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [detail, setDetail] = useState<WithdrawalRequest | null>(null)
  const [threshold, setThreshold] = useState(10)
  const [available, setAvailable] = useState<number | null>(null)

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
          available?: number
        } | null
        if (!res.ok) return
        setRequests(data?.requests ?? [])
        if (typeof data?.approvalThreshold === 'number') setThreshold(data.approvalThreshold)
        if (typeof data?.available === 'number') setAvailable(data.available)
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
    if (!isMaster && available !== null && amount > available) {
      setError(`정산 가능 수수료 잔액(${available.toFixed(4)} Pi)을 초과하는 금액은 출금할 수 없습니다.`)
      return
    }
    setError('')
    // 온체인 송금은 되돌릴 수 없으므로 주소·금액 재확인 모달을 거친다.
    setConfirmTarget({ kind: 'send', recipient, amount, memo: form.memo.trim(), reason: form.reason.trim() })
  }

  const executeSend = (target: Extract<ConfirmTarget, { kind: 'send' }>) => {
    setConfirmTarget(null)
    setBusy(true)
    setError('')
    void fetch('/api/admin/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ recipientAddress: target.recipient, amount: target.amount, memo: target.memo, reason: target.reason }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as {
          txid?: string
          pending?: boolean
          flag?: string
          error?: string
        } | null
        if (!res.ok) throw new Error(data?.error || 'withdraw_failed')
        return data
      })
      .then((data) => {
        if (data?.pending) {
          tell(`승인 대기로 등록되었습니다${data.flag ? ` (${data.flag})` : ''} — 최고 관리자 승인 후 전송됩니다.`)
        } else {
          tell(`출금 완료 — txid ${data?.txid ? `${data.txid.slice(0, 16)}…` : '(해시 없음)'}`)
        }
        setForm({ recipient: '', amount: '', memo: '', reason: '' })
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
  const totalPages = Math.max(1, Math.ceil(requests.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const paged = requests.slice(safePage * pageSize, safePage * pageSize + pageSize)
  const pageButtons = (() => {
    const span = 2
    const start = Math.max(0, Math.min(safePage - span, totalPages - span * 2 - 1))
    const end = Math.min(totalPages, start + span * 2 + 1)
    return Array.from({ length: end - start }, (_, i) => start + i + 1)
  })()

  return (
    <section className="rounded-2xl border-2 border-[#FDE68A] bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-black">수수료 출금 (관리자 지갑 → 외부)</p>
        <div className="flex items-center gap-1">
          <span className="rounded-full bg-[#FEE2E2] px-2 py-0.5 text-[10px] font-black text-[#B91C1C]">출금·지출 OUT</span>
          <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10px] font-black text-[#B45309]">주의</span>
        </div>
      </div>
      {available !== null ? (
        <p className="mt-1 text-[10px] font-black text-[#047857]">
          정산 가능 수수료 잔액: {available.toFixed(7)} Pi{isMaster ? '' : ' — 이 잔액을 초과한 출금은 불가합니다.'}
        </p>
      ) : null}
      <p className="mt-1 text-[10px] font-bold leading-4 text-[#94A3B8]">
        등록된 관리자 지갑에서 외부 주소로 Pi를 전송합니다. 전송은 되돌릴 수 없으며 네트워크 수수료(0.01 Pi)가 추가로 차감됩니다.
        {isPiWalletAddress(adminWallet) ? ` 출금 지갑: ${adminWallet.slice(0, 12)}…` : ' 관리자 지갑 주소가 아직 등록되지 않았습니다.'}
      </p>
      {!isMaster ? (
        <p className="mt-1.5 flex items-center gap-1 rounded-lg bg-[#FFFBEB] px-2 py-1.5 text-[10px] font-black text-[#B45309]">
          <ShieldAlert size={12} /> 직원 계정은 {threshold} Pi 초과 송금, 24시간 누적 한도 초과, 또는 1시간 내 반복 송금 시 최고 관리자 승인 후 전송됩니다.
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
            <span className="text-[10px] font-black text-[#64748B]">온체인 메모 (선택 · 28바이트)</span>
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
        <label className="block">
          <span className="text-[10px] font-black text-[#64748B]">처리 사유·메모 (선택 — 지갑 내역·업무 처리 기록에 저장됩니다)</span>
          <input
            type="text"
            value={form.reason}
            onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
            placeholder="예: OO기사 특별 정산분, 운영비 이체 등"
            className="mt-0.5 w-full rounded-lg border-2 border-[#D8CCF5] bg-[#F8F5FF] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
          />
        </label>
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
          <div className="flex items-center justify-between gap-2 text-xs font-black text-[#B45309]">
            <span>출금 승인·집행 내역{pendingCount ? ` · 대기 ${pendingCount}건` : ''}</span>
            <span className="flex items-center gap-2">
              <AdminExportButton
                filename="taxitago-withdrawals"
                headers={['상태', '금액(Pi)', '수신 지갑', 'txid', '요청자', '처리자', '온체인 메모', '사유', '플래그', '오류', '요청 일시', 'ID']}
                rows={requests.map((row) => [
                  STATUS_LABEL[row.status],
                  row.amount.toFixed(7),
                  row.recipient,
                  row.txid || '',
                  row.requestedByName || row.requestedBy,
                  row.decidedByName || row.decidedBy || '',
                  row.memo || '',
                  row.reason || '',
                  row.flag || '',
                  row.error || '',
                  row.createdAt,
                  row.id,
                ])}
              />
              <PageSizeSelect pageSize={pageSize} onChange={(size) => { setPageSize(size); setPage(0) }} />
              <button
                type="button"
                onClick={loadRequests}
                className="rounded-full border border-[#FDE68A] bg-white px-2 py-0.5 text-[10px] font-black text-[#B45309]"
              >
                새로고침
              </button>
            </span>
          </div>
          <div className="mt-2 space-y-2">
            {paged.map((row) => (
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => setDetail(row)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setDetail(row) }}
                className="cursor-pointer rounded-xl border-2 border-[#FDE68A] bg-[#FFFBEB] p-2.5 transition hover:border-[#4A82B8]"
              >
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
                  {row.reason ? ` · 사유: ${row.reason}` : ''}
                  {row.decidedBy ? ` · 처리: ${row.decidedByName || row.decidedBy}` : ''}
                  {row.txid ? ` · txid ${row.txid.slice(0, 12)}…` : ''}
                </p>
                {row.flag ? <p className="mt-0.5 text-[10px] font-black text-[#B45309]">사유: {row.flag}</p> : null}
                {row.error ? <p className="mt-0.5 text-[10px] font-black text-[#DC2626]">전송 오류: {row.error}</p> : null}
                {row.status === 'pending' && isMaster ? (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(event) => { event.stopPropagation(); setConfirmTarget({ kind: 'approve', request: row }) }}
                      className="flex-1 rounded-lg bg-[#15803D] py-1.5 text-[10px] font-black text-white disabled:opacity-50"
                    >
                      승인 후 전송
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(event) => { event.stopPropagation(); rejectRequest(row) }}
                      className="flex-1 rounded-lg border-2 border-[#FCA5A5] bg-white py-1.5 text-[10px] font-black text-[#DC2626] disabled:opacity-50"
                    >
                      거절
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {requests.length > 0 ? (
            <PaginationBar
              total={requests.length}
              rangeStart={safePage * pageSize + 1}
              rangeEnd={Math.min(requests.length, (safePage + 1) * pageSize)}
              page={safePage + 1}
              totalPages={totalPages}
              pageButtons={pageButtons}
              onPage={(p) => setPage(p - 1)}
            />
          ) : null}
        </div>
      ) : null}

      {detail ? (
        <AdminDetailModal
          title="출금 상세 내역"
          eyebrow="WITHDRAWAL DETAIL"
          hero={`-${detail.amount.toFixed(7)} Pi`}
          heroNote={new Date(detail.createdAt).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          badges={
            <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-black ${STATUS_TONE[detail.status]}`}>{STATUS_LABEL[detail.status]}</span>
          }
          onClose={() => setDetail(null)}
          rows={[
            { label: '수신 지갑', value: detail.recipient, copy: true },
            { label: '트랜잭션 ID (txid)', value: detail.txid || '(없음)', copy: Boolean(detail.txid) },
            { label: '요청자', value: `${detail.requestedByName || detail.requestedBy} (${detail.requestedBy})`, copy: true },
            { label: '처리자', value: detail.decidedBy ? `${detail.decidedByName || detail.decidedBy} (${detail.decidedBy})` : '(없음)', copy: Boolean(detail.decidedBy) },
            { label: '온체인 메모', value: detail.memo || '(없음)' },
            { label: '처리 사유', value: detail.reason || '(없음)' },
            ...(detail.flag ? [{ label: '승인 보류 사유', value: detail.flag }] : []),
            ...(detail.error ? [{ label: '전송 오류', value: detail.error }] : []),
            { label: '요청 ID', value: detail.id, copy: true },
          ]}
        />
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
              {confirmTarget.kind === 'send' && (confirmTarget.memo || confirmTarget.reason) ? (
                <p className="mt-1 text-[10px] font-bold text-[#94A3B8]">
                  {confirmTarget.memo ? `온체인 메모: ${confirmTarget.memo}` : ''}
                  {confirmTarget.memo && confirmTarget.reason ? ' · ' : ''}
                  {confirmTarget.reason ? `사유: ${confirmTarget.reason}` : ''}
                </p>
              ) : null}
              {confirmTarget.kind === 'approve' ? (
                <p className="mt-1 text-[10px] font-bold text-[#94A3B8]">
                  요청자: {confirmTarget.request.requestedByName || confirmTarget.request.requestedBy}
                  {confirmTarget.request.reason ? ` · 사유: ${confirmTarget.request.reason}` : ''}
                  {confirmTarget.request.memo ? ` · 메모: ${confirmTarget.request.memo}` : ''}
                </p>
              ) : null}
              <p className="mt-1 text-[10px] font-bold text-[#94A3B8]">네트워크 수수료 0.01 Pi가 별도로 차감됩니다.</p>
              {available !== null && confirmAmount > available ? (
                <p className="mt-1.5 rounded-lg bg-[#FEE2E2] px-2 py-1.5 text-[10px] font-black text-[#B91C1C]">
                  정산 가능 수수료 잔액({available.toFixed(4)} Pi)을 초과하는 송금입니다.
                </p>
              ) : null}
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
