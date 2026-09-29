import { NextResponse } from 'next/server'
import { createDeliveryDispatch, listOpenDeliveries, publicDelivery } from '@/lib/delivery-dispatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ ok: true, jobs: listOpenDeliveries().map((job) => publicDelivery(job)) })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const pickupAddress = typeof body?.pickupAddress === 'string' ? body.pickupAddress.trim() : ''
  const destAddress = typeof body?.destAddress === 'string' ? body.destAddress.trim() : ''
  if (!pickupAddress || !destAddress) {
    return NextResponse.json({ error: 'pickupAddress and destAddress required' }, { status: 400 })
  }
  const createdAt = new Date().toISOString()
  const job = createDeliveryDispatch({
    id: typeof body?.id === 'string' && body.id.trim() ? body.id.trim() : crypto.randomUUID(),
    pickupAddress,
    destAddress,
    packageLabel: typeof body?.packageLabel === 'string' ? body.packageLabel : '택배',
    fare: Number.isFinite(Number(body?.fare)) ? Number(body?.fare) : 0,
    senderPhone: typeof body?.senderPhone === 'string' ? body.senderPhone : '',
    recipientPhone: typeof body?.recipientPhone === 'string' ? body.recipientPhone : '',
    createdAt,
  })
  return NextResponse.json({ ok: true, job: publicDelivery(job) })
}
