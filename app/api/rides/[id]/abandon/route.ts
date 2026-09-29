import { NextResponse } from 'next/server'
import { abandonAssignedRide, toPublicRide } from '@/lib/dispatch-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { driverId?: unknown } | null
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  if (!driverId) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  const result = abandonAssignedRide(id, driverId)
  if (!result.ok || !result.ride) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'not_found' ? 404 : 409 })
  }
  return NextResponse.json({ ok: true, ride: toPublicRide(result.ride) })
}
