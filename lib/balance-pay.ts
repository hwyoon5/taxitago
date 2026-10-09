'use client'

import { apiFetch } from '@/lib/app-origin'
import { loadPiIdentity } from '@/lib/partner-account'
import { PI_SANDBOX } from '@/components/pi-checkout'

export type BalancePayResult = { paymentId: string; txid: string; amount: number }

/**
 * 앱 내 잔액 결제 — Pi SDK 팝업 없이 서버 장부(충전 크레딧−지출)에서 즉시 차감한다.
 * 서버가 잔액 검증·차감·정산(기사 장부/수수료)을 한 요청으로 처리하며,
 * Pi SDK는 충전(입금)·출금(A2U) 경로에서만 사용된다.
 */
export async function payFromBalance(input: {
  purpose: 'ride' | 'manual' | 'service'
  /** 'manual'은 서버의 결제 요청 레코드 금액이 권위라 생략 가능. */
  amount?: number
  rideId?: string
  manualId?: string
  label?: string
  place?: string
  service?: string
  partnerId?: string
  partnerName?: string
  /** 클라이언트 멱등키 — 생략 시 생성. 같은 결제의 재시도는 같은 키를 써야 한다. */
  requestId?: string
}): Promise<BalancePayResult> {
  const identity = loadPiIdentity()
  const uid = identity?.uid?.trim() || ''
  if (!uid) throw new Error('Pi 계정 연동 후 결제할 수 있습니다.')
  const requestId = input.requestId || crypto.randomUUID()
  const res = await apiFetch('/api/wallet/spend/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(identity?.accessToken ? { 'x-pi-access-token': identity.accessToken } : {}),
    },
    body: JSON.stringify({
      uid,
      wallet: identity?.wallet || '',
      amount: input.amount,
      requestId,
      purpose: input.purpose,
      rideId: input.rideId,
      manualId: input.manualId,
      label: input.label,
      place: input.place,
      service: input.service,
      partnerId: input.partnerId,
      partnerName: input.partnerName,
      accessToken: identity?.accessToken || undefined,
      sandbox: PI_SANDBOX,
    }),
    keepalive: true,
    signal: AbortSignal.timeout(25_000),
  })
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean
    txid?: string
    paymentId?: string
    amount?: number
    error?: string
  } | null
  if (!res.ok || !data?.ok) throw new Error(data?.error || '결제를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  const txid = typeof data.txid === 'string' && data.txid ? data.txid : `balance-${requestId}`
  return {
    paymentId: typeof data.paymentId === 'string' && data.paymentId ? data.paymentId : txid,
    txid,
    amount: Number.isFinite(data.amount) ? Number(data.amount) : input.amount ?? 0,
  }
}
