import { NextResponse } from 'next/server'
import { isPiSandboxRequest, parseChargeAmount } from '@/lib/pi-sandbox'
import { lockRideEscrowFromPayment } from '@/lib/pi-payment-handlers'
import { handleServicePaymentComplete } from '@/lib/service-settlement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Testnet mock payment: used when window.Pi is unavailable (PC web, missing
 * SDK). Books the same escrow lock / settlement records a real completion
 * would so the admin ledger and driver earnings stay consistent.
 */
export async function POST(request: Request) {
  if (!isPiSandboxRequest(request)) {
    return NextResponse.json({ error: 'mock payment is testnet-only' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as {
    amount?: unknown
    memo?: unknown
    metadata?: unknown
  } | null
  const amount = parseChargeAmount(body?.amount)
  if (amount == null) {
    return NextResponse.json({ error: 'valid amount required' }, { status: 400 })
  }
  const metadata =
    body?.metadata && typeof body.metadata === 'object' ? (body.metadata as Record<string, unknown>) : null

  const paymentId = `sandbox-pay-${Date.now()}`
  const txid = `demo-txid-${Math.random().toString(36).slice(2, 12)}`
  console.log('[Pi] /api/pi/mock-pay sandbox payment', { amount, paymentId, txid, memo: body?.memo })

  await lockRideEscrowFromPayment(paymentId, txid, metadata).catch((error) => {
    console.error('[Pi] mock-pay escrow lock failed', { paymentId, error })
  })
  await handleServicePaymentComplete({ paymentId, txid, amount, metadata }).catch((error) => {
    console.error('[Pi] mock-pay settlement record failed', { paymentId, error })
  })

  return NextResponse.json({ ok: true, sandbox: true, amount, paymentId, txid })
}
