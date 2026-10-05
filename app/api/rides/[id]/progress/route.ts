import { NextResponse } from 'next/server'
import { rideTransitionErrorMessage, transitionRide } from '@/lib/ride-machine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as {
    passengerId?: unknown
    step?: unknown
    ride?: {
      pickup?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }
      waypoints?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }[]
      dest?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }
      estimatedFare?: unknown
      expectedMinutes?: unknown
      kind?: unknown
      boardedAt?: unknown
      driverId?: unknown
    }
  } | null
  const passengerId = typeof body?.passengerId === 'string' ? body.passengerId.trim() : ''
  const step = body?.step === 'boarded' || body?.step === 'arrived' ? body.step : null
  if (!passengerId || !step) return NextResponse.json({ error: 'passengerId and step required' }, { status: 400 })
  const result = await transitionRide({
    rideId: id,
    action: step === 'boarded' ? 'board' : 'arrive',
    passengerId,
    snapshot: body?.ride,
  })
  if (!result.ok) {
    return NextResponse.json(
      { error: rideTransitionErrorMessage(result.error) },
      { status: result.error === 'not_found' ? 404 : 409 },
    )
  }
  return NextResponse.json({ ok: true, ride: result.ride })
}
