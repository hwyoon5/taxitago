import { NextResponse } from 'next/server'
import { approvePiPayment, completePiPayment, describeError } from '@/lib/pi-platform'
import { isPiSandboxEnv } from '@/lib/pi-sandbox'
import { handleServicePaymentComplete } from '@/lib/service-settlement'
import { ensureSettlementEscrow } from '@/lib/escrow-engine'
import { getRide, hydrateDispatchFromKv } from '@/lib/dispatch-store'
import { hydrateEscrowFromKv } from '@/lib/escrow-store'

/** Lock the ride escrow as soon as a funding payment completes, so either side can settle later. */
export async function lockRideEscrowFromPayment(
  paymentId: string,
  txid: string,
  metadata: Record<string, unknown> | null | undefined,
) {
  if (!metadata || metadata.kind !== 'escrow-lock') return
  const rideId = typeof metadata.rideId === 'string' ? metadata.rideId.trim() : ''
  if (!rideId) return
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv()])
  const ride = getRide(rideId)
  if (!ride?.assignedDriverId) return
  ensureSettlementEscrow(rideId, ride.assignedDriverId, {
    status: 'held',
    lockTxid: txid,
    lockPaymentId: paymentId,
  })
}

function errorStatus(message: string) {
  return message.includes('PI_API_KEY') ? 500 : 502
}

function sandboxOk(kind: 'approve' | 'complete', paymentId: string, extra?: Record<string, string>) {
  console.warn(`[Pi] /api/pi/${kind} sandbox fallback`, { paymentId, ...extra })
  return NextResponse.json({
    ok: true,
    sandbox: true,
    payment: { identifier: paymentId, ...extra },
  })
}

export async function handlePiApprove(request: Request) {
  const body = (await request.json().catch(() => null)) as { paymentId?: unknown } | null
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  console.log('[Pi] /api/pi/approve incoming', { paymentId: paymentId || '(empty)', sandbox: isPiSandboxEnv() })
  if (!paymentId) {
    console.error('[Pi] /api/pi/approve rejected: paymentId required')
    return NextResponse.json({ error: 'paymentId required' }, { status: 400 })
  }

  try {
    const payment = await approvePiPayment(paymentId)
    console.log('[Pi] /api/pi/approve ok', { paymentId })
    return NextResponse.json({ ok: true, payment })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'approve failed'
    if (isPiSandboxEnv()) return sandboxOk('approve', paymentId)
    console.error('[Pi] /api/pi/approve error', { paymentId, message, ...describeError(error) })
    return NextResponse.json({ error: message }, { status: errorStatus(message) })
  }
}

export async function handlePiComplete(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    paymentId?: unknown
    txid?: unknown
    amount?: unknown
    metadata?: unknown
  } | null
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  const txid = typeof body?.txid === 'string' ? body.txid.trim() : ''
  console.log('[Pi] /api/pi/complete incoming', { paymentId: paymentId || '(empty)', txid: txid || '(empty)', sandbox: isPiSandboxEnv() })
  if (!paymentId || !txid) {
    console.error('[Pi] /api/pi/complete rejected: paymentId and txid required')
    return NextResponse.json({ error: 'paymentId and txid required' }, { status: 400 })
  }
  const fallbackAmount = typeof body?.amount === 'number' ? body.amount : null
  const fallbackMetadata =
    body?.metadata && typeof body.metadata === 'object' ? (body.metadata as Record<string, unknown>) : null

  try {
    const { payment, info } = await completePiPayment(paymentId, txid)
    console.log('[Pi] /api/pi/complete ok', { paymentId, txid })
    await lockRideEscrowFromPayment(paymentId, txid, info?.metadata ?? fallbackMetadata).catch((lockError) => {
      console.error('[Pi] /api/pi/complete escrow lock failed', { paymentId, lockError })
    })
    await handleServicePaymentComplete({
      paymentId,
      txid,
      amount: typeof info?.amount === 'number' ? info.amount : fallbackAmount,
      metadata: info?.metadata ?? fallbackMetadata,
    }).catch((settleError) => {
      console.error('[Pi] /api/pi/complete settlement record failed', { paymentId, settleError })
    })
    return NextResponse.json({ ok: true, payment })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'complete failed'
    if (isPiSandboxEnv()) {
      await lockRideEscrowFromPayment(paymentId, txid, fallbackMetadata).catch(() => null)
      await handleServicePaymentComplete({ paymentId, txid, amount: fallbackAmount, metadata: fallbackMetadata }).catch(
        () => null,
      )
      return sandboxOk('complete', paymentId, { txid })
    }
    console.error('[Pi] /api/pi/complete error', { paymentId, txid, message, ...describeError(error) })
    return NextResponse.json({ error: message }, { status: errorStatus(message) })
  }
}
