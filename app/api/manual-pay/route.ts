import { NextResponse } from 'next/server'
import { cancelManualPay, createManualPay, getManualPay, settleManualPayByDriver } from '@/lib/manual-pay-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_AMOUNT_PI = 10_000

function publicRecord(record: Awaited<ReturnType<typeof getManualPay>>) {
  if (!record) return null
  return {
    id: record.id,
    driverName: record.driverName,
    amount: record.amount,
    memo: record.memo,
    status: record.status,
    createdAt: record.createdAt,
  }
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')?.trim() || ''
  const record = await getManualPay(id)
  if (!record) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, record: publicRecord(record) })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    driverId?: unknown
    driverName?: unknown
    driverWallet?: unknown
    amount?: unknown
    memo?: unknown
  } | null
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  const amount = Number(body?.amount)
  if (!driverId) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT_PI) {
    return NextResponse.json({ error: 'invalid_amount' }, { status: 400 })
  }
  const record = await createManualPay({
    driverId,
    driverName: typeof body?.driverName === 'string' ? body.driverName.trim() : '',
    driverWallet: typeof body?.driverWallet === 'string' ? body.driverWallet.trim() : '',
    amount,
    memo: typeof body?.memo === 'string' ? body.memo.trim() : '',
  })
  return NextResponse.json({ ok: true, record: publicRecord(record) })
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    id?: unknown
    driverId?: unknown
    action?: unknown
  } | null
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  const action = typeof body?.action === 'string' ? body.action.trim() : ''
  if (!id || !driverId) return NextResponse.json({ error: 'id and driverId required' }, { status: 400 })

  if (action === 'settle') {
    const result = await settleManualPayByDriver(id, driverId)
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 409
      return NextResponse.json({ error: result.error }, { status })
    }
    return NextResponse.json({ ok: true, record: publicRecord(result.record) })
  }
  if (action === 'cancel') {
    const result = await cancelManualPay(id, driverId)
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : 409
      return NextResponse.json({ error: result.error }, { status })
    }
    return NextResponse.json({ ok: true, record: publicRecord(result.record) })
  }
  return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
}
