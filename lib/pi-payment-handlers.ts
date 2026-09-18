import { NextResponse } from 'next/server'
import { approvePiPayment, completePiPayment } from '@/lib/pi-platform'
import { isPiSandboxEnv } from '@/lib/pi-sandbox'

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
    console.error('[Pi] /api/pi/approve error', { paymentId, message })
    return NextResponse.json({ error: message }, { status: errorStatus(message) })
  }
}

export async function handlePiComplete(request: Request) {
  const body = (await request.json().catch(() => null)) as { paymentId?: unknown; txid?: unknown } | null
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  const txid = typeof body?.txid === 'string' ? body.txid.trim() : ''
  console.log('[Pi] /api/pi/complete incoming', { paymentId: paymentId || '(empty)', txid: txid || '(empty)', sandbox: isPiSandboxEnv() })
  if (!paymentId || !txid) {
    console.error('[Pi] /api/pi/complete rejected: paymentId and txid required')
    return NextResponse.json({ error: 'paymentId and txid required' }, { status: 400 })
  }

  try {
    const payment = await completePiPayment(paymentId, txid)
    console.log('[Pi] /api/pi/complete ok', { paymentId, txid })
    return NextResponse.json({ ok: true, payment })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'complete failed'
    if (isPiSandboxEnv()) return sandboxOk('complete', paymentId, { txid })
    console.error('[Pi] /api/pi/complete error', { paymentId, txid, message })
    return NextResponse.json({ error: message }, { status: errorStatus(message) })
  }
}
