'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/app-origin'
import { describePiUserMessage, isPiBrowser, PI_SANDBOX, startPiCheckout } from '@/components/pi-checkout'

type ManualPayPublic = {
  id: string
  driverName: string
  amount: number
  memo: string
  status: 'pending' | 'paid' | 'manual' | 'cancelled'
  createdAt: string
}

type ViewState = 'loading' | 'ready' | 'paying' | 'done' | 'closed' | 'missing'

/** 승객이 기사의 QR/링크로 여는 현장 수동 결제 화면 — 본인 Pi 지갑으로 직접 결제한다. */
export default function ManualPayCheckout({ manualId }: { manualId: string }) {
  const [record, setRecord] = useState<ManualPayPublic | null>(null)
  const [view, setView] = useState<ViewState>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    apiFetch(`/api/manual-pay/?id=${encodeURIComponent(manualId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { record?: ManualPayPublic } | null
        if (cancelled) return
        if (!res.ok || !data?.record) {
          setView('missing')
          return
        }
        setRecord(data.record)
        setView(data.record.status === 'pending' ? 'ready' : data.record.status === 'paid' || data.record.status === 'manual' ? 'done' : 'closed')
      })
      .catch(() => {
        if (!cancelled) setView('missing')
      })
    return () => {
      cancelled = true
    }
  }, [manualId])

  const pay = () => {
    if (!record || view !== 'ready') return
    // 일반 브라우저에서는 authenticate가 열리지 않아 세션 오류로 오인된다 —
    // 메인넷이면 Pi Browser 안내를 바로 보여주고, 테스트넷은 모의 결제가 처리한다.
    if (!isPiBrowser() && !PI_SANDBOX) {
      setError('Pi 결제는 Pi Browser 안에서만 진행할 수 있습니다. 이 결제 링크를 Pi Browser에서 열어 주세요.')
      return
    }
    setView('paying')
    setError('')
    void startPiCheckout({
      amount: record.amount,
      memo: `TaxiTago 현장 결제`.slice(0, 25),
      metadata: { kind: 'manual-settle', manualId: record.id, label: '현장 수동 결제' },
      strictCompletion: true,
    })
      .then(() => setView('done'))
      .catch((payError) => {
        setError(describePiUserMessage(payError))
        setView('ready')
      })
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center bg-[#F8FAFC] px-6 text-[#0F172A]">
      <p className="text-xs font-black text-[#4C1FB8]">TaxiTago 현장 결제</p>
      {view === 'loading' ? (
        <p className="mt-4 text-sm font-bold text-[#64748B]">결제 정보를 불러오는 중…</p>
      ) : null}
      {view === 'missing' ? (
        <>
          <h1 className="mt-1 text-2xl font-black">결제 요청을 찾을 수 없어요</h1>
          <p className="mt-2 text-sm font-bold text-[#64748B]">링크가 만료되었거나 잘못되었습니다. 기사에게 새 결제 요청을 받아 주세요.</p>
        </>
      ) : null}
      {view === 'closed' ? (
        <>
          <h1 className="mt-1 text-2xl font-black">취소된 결제입니다</h1>
          <p className="mt-2 text-sm font-bold text-[#64748B]">기사가 이 결제 요청을 취소했습니다.</p>
        </>
      ) : null}
      {view === 'done' ? (
        <>
          <h1 className="mt-1 text-2xl font-black">결제가 완료되었습니다</h1>
          <p className="mt-2 text-sm font-bold text-[#64748B]">
            {record ? `${record.driverName || '기사'}님에게 ${record.amount.toFixed(7)} Pi가 전달되었습니다.` : '정산이 완료되었습니다.'}
          </p>
        </>
      ) : null}
      {(view === 'ready' || view === 'paying') && record ? (
        <>
          <h1 className="mt-1 text-2xl font-black">{record.driverName || '기사'}님에게 결제</h1>
          {record.memo ? <p className="mt-1 text-sm font-bold text-[#64748B]">{record.memo}</p> : null}
          <div className="mt-4 rounded-2xl border-2 border-[#E0D4FF] bg-white p-5 text-center shadow-sm">
            <p className="text-xs font-black text-[#64748B]">결제 금액</p>
            <p className="mt-1 text-3xl font-black text-[#4C1FB8]">{record.amount.toFixed(7)} Pi</p>
          </div>
          {error ? <p className="mt-2 text-xs font-black text-[#DC2626]">{error}</p> : null}
          <button
            type="button"
            disabled={view === 'paying'}
            onClick={pay}
            className="mt-4 w-full rounded-2xl bg-[#4C1FB8] py-3.5 text-sm font-black text-white disabled:opacity-60"
          >
            {view === 'paying' ? 'Pi 지갑에서 승인 중…' : 'Pi 지갑으로 결제하기'}
          </button>
          {isPiBrowser() ? (
            <p className="mt-2 text-center text-[11px] font-bold text-[#94A3B8]">Pi Browser에서 결제 시트가 열립니다.</p>
          ) : (
            <p className="mt-2 text-center text-[11px] font-bold leading-5 text-[#B45309]">
              {PI_SANDBOX
                ? '일반 브라우저입니다. 테스트넷 환경에서는 모의 결제로 진행됩니다. 실제 결제는 Pi Browser에서 열어 주세요.'
                : '일반 브라우저에서는 결제가 시작되지 않습니다. 이 링크를 Pi Browser에서 열어 주세요.'}
            </p>
          )}
        </>
      ) : null}
    </main>
  )
}
