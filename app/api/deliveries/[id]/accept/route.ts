import { NextResponse } from 'next/server'
import { acceptDeliveryDispatch, publicDelivery } from '@/lib/delivery-dispatch'
import { recordSettlement } from '@/lib/settlement-store'
import { driverPayoutTarget } from '@/lib/escrow-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  const vehicle = typeof body?.vehicle === 'string' ? body.vehicle.trim() : ''
  const plate = typeof body?.plate === 'string' ? body.plate.trim() : ''
  if (!driverId || !vehicle || !plate) {
    return NextResponse.json({ error: 'driverId, vehicle, and plate required' }, { status: 400 })
  }
  const result = acceptDeliveryDispatch(id, {
    driverId,
    name: typeof body?.name === 'string' ? body.name : '기사',
    vehicle,
    plate,
  })
  if (!result.ok || !result.job) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'not_found' ? 404 : 409 })
  }
  const job = result.job
  await recordSettlement({
    refId: `delivery:${job.id}`,
    service: 'delivery',
    driverId,
    driverName: job.driverName || '기사',
    memo: `${job.packageLabel} · ${job.pickupAddress} → ${job.destAddress}`,
    gross: job.fare,
    driverWallet: driverPayoutTarget(driverId).wallet,
  }).catch(() => null)
  return NextResponse.json({ ok: true, job: publicDelivery(job, driverId) })
}
