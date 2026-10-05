import { NextResponse } from 'next/server'
import { rideTransitionErrorMessage, transitionRide } from '@/lib/ride-machine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as {
    driverId?: unknown
    ride?: {
      passengerId?: unknown
      pickup?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }
      waypoints?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }[]
      dest?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }
      estimatedFare?: unknown
      expectedMinutes?: unknown
      kind?: unknown
      boardedAt?: unknown
      readyToSettleAt?: unknown
      escrow?: { status?: unknown; lockTxid?: unknown; lockPaymentId?: unknown }
    }
  } | null
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  if (!driverId) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  try {
    const escrowProof = body?.ride?.escrow
    const result = await transitionRide({
      rideId: id,
      action: 'complete',
      driverId,
      snapshot: body?.ride,
      proof: escrowProof
        ? {
            status: typeof escrowProof.status === 'string' ? escrowProof.status : null,
            lockTxid: typeof escrowProof.lockTxid === 'string' ? escrowProof.lockTxid : null,
            lockPaymentId: typeof escrowProof.lockPaymentId === 'string' ? escrowProof.lockPaymentId : null,
          }
        : undefined,
    })
    if (!result.ok) {
      return NextResponse.json(
        { error: rideTransitionErrorMessage(result.error), escrow: result.ride?.escrow ?? null },
        { status: result.error === 'not_found' ? 404 : 409 },
      )
    }
    if (!result.ride) return NextResponse.json({ error: '이용 완료 결과를 만들지 못했어요.' }, { status: 500 })
    return NextResponse.json({
      ok: true,
      ride: result.ride,
      escrow: result.escrow,
      receipt: result.receipt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'settlement failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
