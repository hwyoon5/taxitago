import { NextResponse } from 'next/server'
import { isPiSandboxEnv, parseChargeAmount } from '@/lib/pi-sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!isPiSandboxEnv()) {
    return NextResponse.json(
      { error: 'mainnet charge must complete window.Pi.createPayment first' },
      { status: 403 },
    )
  }

  const body = (await request.json().catch(() => null)) as { amount?: unknown; memo?: unknown } | null
  const amount = parseChargeAmount(body?.amount)
  if (amount == null) {
    return NextResponse.json({ error: 'valid amount required' }, { status: 400 })
  }

  const paymentId = `sandbox-charge-${Date.now()}`
  const txid = `demo-txid-${Math.random().toString(36).slice(2, 12)}`
  console.log('[Pi] /api/pi/charge sandbox credit', { amount, paymentId, txid })

  return NextResponse.json({
    ok: true,
    sandbox: true,
    amount,
    paymentId,
    txid,
    memo: typeof body?.memo === 'string' ? body.memo : 'TaxiTago sandbox charge',
  })
}
