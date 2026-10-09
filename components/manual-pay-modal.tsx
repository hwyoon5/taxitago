'use client'

import { useEffect, useRef, useState } from 'react'
import { toDataURL as qrToDataURL } from 'qrcode'
import { apiFetch } from '@/lib/app-origin'

type ManualPayPublic = {
  id: string
  driverName: string
  amount: number
  memo: string
  status: 'pending' | 'paid' | 'manual' | 'cancelled'
  createdAt: string
}

type Step = 'form' | 'qr' | 'done'

/**
 * 기사/파트너 화면의 현장 수동 결제 모달.
 * 1) 금액+메모로 결제 요청을 만들어 승객이 QR/링크로 본인 지갑에서 Pi 결제하거나
 * 2) 현장에서 직접 받았다고 확정(수동 정산)해 정산 장부에 바로 기록한다.
 */
export default function ManualPayModal({
  driverId,
  driverName,
  driverWallet,
  onSettled,
  onClose,
  onNotice,
}: {
  driverId: string
  driverName: string
  driverWallet: string
  onSettled: (record: ManualPayPublic) => void
  onClose: () => void
  onNotice: (message: string) => void
}) {
  const [step, setStep] = useState<Step>('form')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [record, setRecord] = useState<ManualPayPublic | null>(null)
  const [qrUrl, setQrUrl] = useState('')
  const [payUrl, setPayUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const settledRef = useRef(false)

  const markSettled = (next: ManualPayPublic) => {
    if (settledRef.current) return
    settledRef.current = true
    setStep('done')
    onSettled(next)
  }

  // pending 요청 건은 승객 결제 완료를 폴링으로 감시한다.
  useEffect(() => {
    if (step !== 'qr' || !record) return
    let stopped = false
    const tick = async () => {
      try {
        const res = await apiFetch(`/api/manual-pay/?id=${encodeURIComponent(record.id)}`, { cache: 'no-store' })
        const data = (await res.json().catch(() => null)) as { record?: ManualPayPublic } | null
        if (stopped || !data?.record) return
        if (data.record.status === 'paid' || data.record.status === 'manual') markSettled(data.record)
        else if (data.record.status === 'cancelled') setStep('form')
      } catch {
        undefined
      }
    }
    const timer = window.setInterval(() => void tick(), 2500)
    void tick()
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, record?.id])

  const createRequest = () => {
    const value = Number(amount)
    if (!driverId || busy) return
    if (!Number.isFinite(value) || value <= 0 || value > 10_000) {
      setError('결제 금액을 올바르게 입력해 주세요. (0 초과)')
      return
    }
    setBusy(true)
    setError('')
    void apiFetch('/api/manual-pay/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId, driverName, driverWallet, amount: value, memo: memo.trim() }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { record?: ManualPayPublic; error?: string } | null
        if (!res.ok || !data?.record) throw new Error(data?.error || 'create_failed')
        setRecord(data.record)
        const url = `${window.location.origin}/pay/manual/${data.record.id}`
        setPayUrl(url)
        const qr = await qrToDataURL(url, { margin: 1, width: 220 }).catch(() => '')
        setQrUrl(qr)
        setStep('qr')
      })
      .catch(() => setError('결제 요청을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.'))
      .finally(() => setBusy(false))
  }

  const settleDirectly = () => {
    const value = Number(amount)
    if (!driverId || busy) return
    if (!Number.isFinite(value) || value <= 0) {
      setError('정산할 금액을 먼저 입력해 주세요.')
      return
    }
    setBusy(true)
    setError('')
    const finish = (rec: ManualPayPublic) => {
      markSettled(rec)
      onNotice(`수동 정산 ${rec.amount.toFixed(7)} Pi가 오늘의 수익에 반영되었습니다.`)
    }
    const fail = () => setError('수동 정산에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    const settleExisting = record
      ? apiFetch('/api/manual-pay/', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: record.id, driverId, action: 'settle' }),
        }).then(async (res) => {
          const data = (await res.json().catch(() => null)) as { record?: ManualPayPublic } | null
          if (!res.ok || !data?.record) throw new Error('settle_failed')
          return data.record
        })
      : apiFetch('/api/manual-pay/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId, driverName, driverWallet, amount: value, memo: memo.trim() }),
        })
          .then(async (res) => {
            const data = (await res.json().catch(() => null)) as { record?: ManualPayPublic } | null
            if (!res.ok || !data?.record) throw new Error('create_failed')
            return apiFetch('/api/manual-pay/', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: data.record.id, driverId, action: 'settle' }),
            })
          })
          .then(async (res) => {
            const data = (await res.json().catch(() => null)) as { record?: ManualPayPublic } | null
            if (!res.ok || !data?.record) throw new Error('settle_failed')
            return data.record
          })
    void settleExisting.then(finish).catch(fail).finally(() => setBusy(false))
  }

  const cancelRequest = () => {
    if (!record || busy) return
    setBusy(true)
    void apiFetch('/api/manual-pay/', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: record.id, driverId, action: 'cancel' }),
    })
      .catch(() => undefined)
      .finally(() => {
        setBusy(false)
        setRecord(null)
        setStep('form')
      })
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-[24px] bg-white p-5 shadow-2xl">
        {step === 'form' ? (
          <>
            <p className="text-xs font-black text-[#4C1FB8]">현장 수동 결제 · 수동 정산</p>
            <h2 className="mt-1 text-xl font-black text-[#0F172A]">승객에게 받을 금액</h2>
            <div className="mt-3 flex items-center gap-2 rounded-2xl border-2 border-[#CBD5E1] px-3 py-3 focus-within:border-[#4C1FB8]">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.0000000"
                className="w-full text-lg font-black outline-none"
              />
              <span className="shrink-0 text-sm font-black text-[#4C1FB8]">Pi</span>
            </div>
            <input
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              placeholder="메모 / 목적지 (선택)"
              maxLength={60}
              className="mt-2 w-full rounded-2xl border-2 border-[#CBD5E1] px-3 py-3 text-sm font-bold outline-none focus:border-[#4C1FB8]"
            />
            {error ? <p className="mt-2 text-xs font-black text-[#DC2626]">{error}</p> : null}
            <button
              type="button"
              disabled={busy}
              onClick={createRequest}
              className="mt-3 w-full rounded-2xl bg-[#4C1FB8] py-3.5 text-sm font-black text-white disabled:opacity-60"
            >
              {busy ? '처리 중…' : 'Pi 결제 요청 생성 (승객 QR/링크)'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={settleDirectly}
              className="mt-2 w-full rounded-2xl border-2 border-[#0F766E] bg-white py-3.5 text-sm font-black text-[#0F766E] disabled:opacity-60"
            >
              현장에서 직접 받음 · 수동 정산
            </button>
            <button type="button" onClick={onClose} className="mt-2 w-full py-2 text-xs font-black text-[#64748B]">
              닫기
            </button>
          </>
        ) : null}
        {step === 'qr' && record ? (
          <>
            <p className="text-xs font-black text-[#4C1FB8]">승객 결제 대기 중</p>
            <h2 className="mt-1 text-xl font-black text-[#0F172A]">{record.amount.toFixed(7)} Pi</h2>
            {record.memo ? <p className="mt-0.5 text-xs font-bold text-[#64748B]">{record.memo}</p> : null}
            <p className="mt-2 text-xs font-bold leading-5 text-[#475569]">
              승객이 아래 QR을 Pi Browser/카메라로 스캔해 결제합니다. 결제가 완료되면 자동으로 정산됩니다.
            </p>
            {qrUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrUrl} alt="승객 결제 QR 코드" className="mx-auto mt-3 h-44 w-44 rounded-2xl border-2 border-[#E0D4FF] p-1" />
            ) : null}
            <p className="mt-2 select-all break-all rounded-xl bg-[#F1F5F9] px-2.5 py-2 text-center text-[10px] font-bold text-[#64748B]">
              {payUrl}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={settleDirectly}
              className="mt-3 w-full rounded-2xl border-2 border-[#0F766E] bg-white py-3 text-sm font-black text-[#0F766E] disabled:opacity-60"
            >
              현장에서 직접 받음 · 수동 정산
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={cancelRequest}
              className="mt-2 w-full py-2 text-xs font-black text-[#DC2626]"
            >
              결제 요청 취소
            </button>
          </>
        ) : null}
        {step === 'done' ? (
          <>
            <p className="text-xs font-black text-[#047857]">정산 완료</p>
            <h2 className="mt-1 text-xl font-black text-[#0F172A]">수익에 반영되었습니다</h2>
            <p className="mt-1 text-sm font-bold text-[#475569]">오늘의 수익과 운행 건수에 합산되었어요.</p>
            <button type="button" onClick={onClose} className="mt-4 w-full rounded-2xl bg-[#4C1FB8] py-3 text-sm font-black text-white">
              확인
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
