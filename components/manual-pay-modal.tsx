'use client'

import { useEffect, useRef, useState } from 'react'
import { toDataURL as qrToDataURL } from 'qrcode'
import { apiFetch } from '@/lib/app-origin'
import { MANUAL_PAY_MAX_PI, manualPayAmountError, sanitizeManualPayAmount } from '@/lib/manual-pay-limits'

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
  rideId,
  initialAmount,
  initialMemo,
  onSettled,
  onClose,
  onNotice,
}: {
  driverId: string
  driverName: string
  driverWallet: string
  /** 배차 운행에 붙는 현장 결제면 ride id를 넘겨 완료 처리와 연결한다. */
  rideId?: string
  initialAmount?: string
  initialMemo?: string
  onSettled: (record: ManualPayPublic) => void
  onClose: () => void
  onNotice: (message: string) => void
}) {
  const [step, setStep] = useState<Step>('form')
  const [amount, setAmount] = useState(initialAmount ?? '')
  const [memo, setMemo] = useState(initialMemo ?? '')
  const [record, setRecord] = useState<ManualPayPublic | null>(null)
  const [qrUrl, setQrUrl] = useState('')
  const [payUrl, setPayUrl] = useState('')
  const [deepLink, setDeepLink] = useState('')
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
        const data = (await res.json().catch(() => null)) as { record?: ManualPayPublic; error?: string } | null
        if (stopped) return
        if (res.status === 410 || data?.error === 'expired') {
          setRecord(null)
          setError('결제 요청이 만료되었습니다. 새 QR을 생성해 주세요.')
          setStep('form')
          return
        }
        if (!data?.record) return
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

  const amountValue = Number(amount)
  const amountTooLarge = amount.trim() !== '' && Number.isFinite(amountValue) && amountValue > MANUAL_PAY_MAX_PI
  const amountErrorText = (reason: 'invalid' | 'too_large' | 'too_precise' | null) =>
    reason === 'too_large'
      ? `결제 금액은 최대 ${MANUAL_PAY_MAX_PI} Pi까지 입력할 수 있습니다.`
      : `결제 금액을 올바르게 입력해 주세요. (0 초과 ~ ${MANUAL_PAY_MAX_PI} Pi)`

  const createRequest = () => {
    const value = Number(amount)
    if (!driverId || busy) return
    const invalid = manualPayAmountError(value)
    if (invalid) {
      setError(amountErrorText(invalid))
      return
    }
    setBusy(true)
    setError('')
    void apiFetch('/api/manual-pay/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId, driverName, driverWallet, amount: value, memo: memo.trim(), rideId }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { record?: ManualPayPublic; error?: string } | null
        if (!res.ok || !data?.record) throw new Error(data?.error || 'create_failed')
        setRecord(data.record)
        const path = `/pay/manual/${data.record.id}?pay=auto`
        // Pi Browser 스캐너는 pi:// 딥링크 QR만 인증된 형식으로 받아들인다.
        // 스캔하면 Pi Browser가 이 앱의 결제 페이지를 열고, pay=auto가
        // window.Pi.createPayment 결제 승인 시트를 곧바로 띄운다.
        const link = `pi://${window.location.host}${path}`
        setDeepLink(link)
        setPayUrl(`${window.location.origin}${path}`)
        const qr = await qrToDataURL(link, { margin: 1, width: 220 }).catch(() => '')
        setQrUrl(qr)
        setStep('qr')
      })
      .catch(() => setError('결제 요청을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.'))
      .finally(() => setBusy(false))
  }

  const settleDirectly = () => {
    const value = Number(amount)
    if (!driverId || busy) return
    const invalid = manualPayAmountError(value)
    if (invalid) {
      setError(amountErrorText(invalid))
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
          body: JSON.stringify({ driverId, driverName, driverWallet, amount: value, memo: memo.trim(), rideId }),
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
                max={MANUAL_PAY_MAX_PI}
                step="0.1"
                value={amount}
                onChange={(event) => {
                  // 숫자·소수점 하나·소수부 7자리만 통과시켜 비정상 입력을 차단한다.
                  setAmount(sanitizeManualPayAmount(event.target.value))
                  if (error) setError('')
                }}
                placeholder="0.0000000"
                className="w-full text-lg font-black outline-none"
              />
              <span className="shrink-0 text-sm font-black text-[#4C1FB8]">Pi</span>
            </div>
            {amountTooLarge ? (
              <p className="mt-1.5 text-xs font-black text-[#DC2626]">
                {amountErrorText('too_large')}
              </p>
            ) : null}
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
              승객이 Pi Browser의 스캔(카메라)으로 QR을 비추면 결제 승인창이 바로 열립니다. 결제가 완료되면 자동으로 정산됩니다.
            </p>
            {qrUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrUrl} alt="승객 결제 QR 코드" className="mx-auto mt-3 h-44 w-44 rounded-2xl border-2 border-[#E0D4FF] p-1" />
            ) : null}
            <p className="mt-2 select-all break-all rounded-xl bg-[#F1F5F9] px-2.5 py-2 text-center text-[10px] font-bold text-[#64748B]">
              {deepLink}
            </p>
            <p className="mt-1.5 select-all break-all text-center text-[10px] font-bold leading-4 text-[#94A3B8]">
              Pi Browser가 아니면 이 링크로 결제 페이지를 열 수 있어요: {payUrl}
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
