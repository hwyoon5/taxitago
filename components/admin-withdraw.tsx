'use client'

import { useState, type FormEvent } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import { isPiWalletAddress, piWalletError } from '@/lib/pi-wallet'

type Props = {
  /** Currently configured platform wallet — shown for context only. */
  adminWallet?: string
  /** Called after a successful withdrawal so the parent can refresh balances/audit. */
  onChanged?: () => void
}

export default function AdminWithdraw({ adminWallet = '', onChanged }: Props) {
  const [form, setForm] = useState({ recipient: '', amount: '', memo: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const tell = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 6000)
  }

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
    // Irreversible on-chain transfer — require explicit confirmation.
    const ok = window.confirm(
      `관리자 지갑에서 아래 주소로 ${amount} Pi를 출금합니다.\n\n${recipient}\n\n실행하면 되돌릴 수 없습니다. 진행할까요?`,
    )
    if (!ok) return
    setBusy(true)
    setError('')
    void fetch('/api/admin/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ recipientAddress: recipient, amount, memo: form.memo }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { txid?: string; error?: string } | null
        if (!res.ok) throw new Error(data?.error || 'withdraw_failed')
        return data
      })
      .then((data) => {
        tell(`출금 완료 — txid ${data?.txid ? `${data.txid.slice(0, 16)}…` : '(해시 없음)'}`)
        setForm({ recipient: '', amount: '', memo: '' })
        onChanged?.()
      })
      .catch((err) => setError(err instanceof Error ? err.message : '출금에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

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
    </section>
  )
}
