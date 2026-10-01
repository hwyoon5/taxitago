import { NextResponse } from 'next/server'
import { rideTransitionErrorMessage, transitionRide } from '@/lib/ride-machine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { passengerId?: unknown; settleFee?: unknown } | null
  const passengerId = typeof body?.passengerId === 'string' ? body.passengerId : undefined
  const settleFee = body?.settleFee === true
  try {
    const result = await transitionRide({ rideId: id, action: 'cancel', passengerId, settleFee })
    if (!result.ok) {
      return NextResponse.json(
        { error: rideTransitionErrorMessage(result.error) },
        { status: result.error === 'forbidden' ? 403 : 409 },
      )
    }
    if (!result.ride) return NextResponse.json({ ok: true, missing: true, ride: null })
    return NextResponse.json({ ok: true, ride: result.ride })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cancel settlement failed'
    console.error('[cancel] failed', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
