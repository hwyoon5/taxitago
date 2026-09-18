import { NextResponse } from 'next/server'
import { approvePiPayment, completePiPayment } from '@/lib/pi-platform'

function errorStatus(message: string) {
  return message.includes('PI_API_KEY') ? 500 : 502
}

export async function handlePiApprove(request: Request) {
  const body = (await request.json().catch(() => null)) as { paymentId?: unknown } | null
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  if (!paymentId) {
    return NextResponse.json({ error: 'paymentId required' }, { status: 400 })
  }

  try {
    const payment = await approvePiPayment(paymentId)
    return NextResponse.json({ ok: true, payment })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'approve failed'
    return NextResponse.json({ error: message }, { status: errorStatus(message) })
  }
}

export async function handlePiComplete(request: Request) {
  const body = (await request.json().catch(() => null)) as { paymentId?: unknown; txid?: unknown } | null
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  const txid = typeof body?.txid === 'string' ? body.txid.trim() : ''
  if (!paymentId || !txid) {
    return NextResponse.json({ error: 'paymentId and txid required' }, { status: 400 })
  }

  try {
    const payment = await completePiPayment(paymentId, txid)
    return NextResponse.json({ ok: true, payment })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'complete failed'
    return NextResponse.json({ error: message }, { status: errorStatus(message) })
  }
}
