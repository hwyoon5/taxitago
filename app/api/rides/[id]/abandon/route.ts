import { NextResponse } from 'next/server'
import { rideTransitionErrorMessage, transitionRide } from '@/lib/ride-machine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { driverId?: unknown } | null
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  if (!driverId) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  const result = await transitionRide({ rideId: id, action: 'abandon', driverId })
  if (!result.ok) {
    return NextResponse.json(
      { error: rideTransitionErrorMessage(result.error) },
      { status: result.error === 'not_found' ? 404 : 409 },
    )
  }
  return NextResponse.json({ ok: true, ride: result.ride })
}
