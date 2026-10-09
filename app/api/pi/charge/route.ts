import { NextResponse } from 'next/server'
import { isPiSandboxRequest, parseChargeAmount } from '@/lib/pi-sandbox'
import { creditUserDeposit } from '@/lib/user-credit-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!isPiSandboxRequest(request)) {
    return NextResponse.json(
      { error: 'mainnet charge must complete window.Pi.createPayment first' },
      { status: 403 },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    amount?: unknown
    memo?: unknown
    uid?: unknown
    wallet?: unknown
  } | null
  const amount = parseChargeAmount(body?.amount)
  if (amount == null) {
    return NextResponse.json({ error: 'valid amount required' }, { status: 400 })
  }

  const paymentId = `sandbox-charge-${Date.now()}`
  const txid = `demo-txid-${Math.random().toString(36).slice(2, 12)}`
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const wallet = typeof body?.wallet === 'string' ? body.wallet.trim() : ''
  // 테스트넷 모의 충전도 서버 크레딧 장부에 귀속한다 — 없으면 앱 잔액 결제의
  // spendable이 0이라 잔액 결제가 테스트넷에서 영구 실패한다(txid 멱등).
  if (uid || wallet) {
    await creditUserDeposit({ txid, wallet, uid, amount, source: 'manual' }).catch((error) => {
      console.error('[Pi] /api/pi/charge sandbox credit failed', { txid, uid, error })
    })
  }
  console.log('[Pi] /api/pi/charge sandbox credit', { amount, paymentId, txid, uid: uid || '(none)' })

  return NextResponse.json({
    ok: true,
    sandbox: true,
    amount,
    paymentId,
    txid,
    memo: typeof body?.memo === 'string' ? body.memo : 'TaxiTago sandbox charge',
  })
}
