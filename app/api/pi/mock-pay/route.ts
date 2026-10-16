import { NextResponse } from 'next/server'
import { isPiSandboxRequest, parseChargeAmount } from '@/lib/pi-sandbox'
import { handlePiCorsPreflight, lockRideEscrowFromPayment, PI_CORS_HEADERS } from '@/lib/pi-payment-handlers'
import { handleServicePaymentComplete } from '@/lib/service-settlement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Testnet mock payment: used when window.Pi is unavailable (PC web, missing
 * SDK). Books the same escrow lock / settlement records a real completion
 * would so the admin ledger and driver earnings stay consistent.
 *
 * 실제 Pi 전송 없이 '결제 완료'와 동일한 장부를 쓰는 경로이므로 fail-closed:
 * testnet 호스트 + 명시적 PI_MOCK_PAY=1 env 둘 다 필요. 모의 기록은
 * metadata.__mock 태그를 따라 정산 메모에 '[모의결제]'로 표시되고 txid는
 * demo-txid-* 접두사라 관리자 장부에서 실결제와 구분된다.
 */
export const OPTIONS = handlePiCorsPreflight

function mockPayEnabled() {
  const flag = (process.env.PI_MOCK_PAY || '').trim().toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'yes'
}

export async function POST(request: Request) {
  if (!isPiSandboxRequest(request)) {
    return NextResponse.json({ error: 'mock payment is testnet-only' }, { status: 403, headers: PI_CORS_HEADERS })
  }
  if (!mockPayEnabled()) {
    return NextResponse.json({ error: 'mock payment is disabled (PI_MOCK_PAY not set)' }, { status: 403, headers: PI_CORS_HEADERS })
  }

  const body = (await request.json().catch(() => null)) as {
    amount?: unknown
    memo?: unknown
    metadata?: unknown
  } | null
  const amount = parseChargeAmount(body?.amount)
  if (amount == null) {
    return NextResponse.json({ error: 'valid amount required' }, { status: 400, headers: PI_CORS_HEADERS })
  }
  const baseMetadata =
    body?.metadata && typeof body.metadata === 'object' ? (body.metadata as Record<string, unknown>) : {}
  const metadata: Record<string, unknown> = { ...baseMetadata, __mock: true }

  const paymentId = `sandbox-pay-${Date.now()}`
  const txid = `demo-txid-${Math.random().toString(36).slice(2, 12)}`
  console.log('[Pi] /api/pi/mock-pay sandbox payment', { amount, paymentId, txid, memo: body?.memo })

  const { recordPiEvent } = await import('@/lib/pi-audit')
  void recordPiEvent({
    kind: 'complete',
    stage: 'ok',
    paymentId,
    network: 'testnet',
    message: 'mock payment (PI_MOCK_PAY; no on-chain transaction)',
  }).catch(() => undefined)

  // 모의 결제도 서버가 '검증한' 결제로 기록해 둬야 에스크로 잠금이 인정된다.
  const metaKind = typeof metadata?.kind === 'string' ? metadata.kind.trim() : ''
  if (metaKind) {
    const { markPaymentKind } = await import('@/lib/payment-kind-store')
    await markPaymentKind(txid, metaKind).catch(() => undefined)
  }
  await lockRideEscrowFromPayment(paymentId, txid, metadata).catch((error) => {
    console.error('[Pi] mock-pay escrow lock failed', { paymentId, error })
  })
  await handleServicePaymentComplete({ paymentId, txid, amount, metadata }).catch((error) => {
    console.error('[Pi] mock-pay settlement record failed', { paymentId, error })
  })
  // 수동 결제(manual-settle)도 실제 완료 콜백과 동일하게 기사 요청 건을 마감한다.
  if (metadata?.kind === 'manual-settle') {
    const { handleManualPayComplete } = await import('@/lib/manual-pay-store')
    await handleManualPayComplete({ paymentId, txid, metadata }).catch((error) => {
      console.error('[Pi] mock-pay manual-pay settle failed', { paymentId, error })
    })
  }

  return NextResponse.json({ ok: true, mock: true, sandbox: true, amount, paymentId, txid }, { headers: PI_CORS_HEADERS })
}
