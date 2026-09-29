import { NextResponse } from 'next/server'
import { acceptDeliveryDispatch, publicDelivery } from '@/lib/delivery-dispatch'

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
  return NextResponse.json({ ok: true, job: publicDelivery(result.job, driverId) })
}
