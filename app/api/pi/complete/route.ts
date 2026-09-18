import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PI_PAYMENTS_URL = 'https://api.minepi.com/v2/payments'

function piApiKey() {
  const key = (process.env.PI_API_KEY || '').trim()
  if (!key) {
    throw new Error('PI_API_KEY is not configured')
  }
  return key
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { paymentId?: unknown; txid?: unknown } | null
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  const txid = typeof body?.txid === 'string' ? body.txid.trim() : ''
  if (!paymentId || !txid) {
    return NextResponse.json({ error: 'paymentId and txid required' }, { status: 400 })
  }

  const url = `${PI_PAYMENTS_URL}/${encodeURIComponent(paymentId)}/complete`
  console.log('[Pi] complete →', url)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Key ${piApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ txid }),
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
          ? payload.message
          : `Pi complete failed (${response.status})`
      console.error('[Pi] complete error', { paymentId, txid, status: response.status, message })
      return NextResponse.json({ error: message }, { status: 502 })
    }

    console.log('[Pi] complete ok', { paymentId, txid, status: response.status })
    return NextResponse.json({ ok: true, payment: payload })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'complete failed'
    console.error('[Pi] complete error', { paymentId, txid, message })
    const status = message.includes('PI_API_KEY') ? 500 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
