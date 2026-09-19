import { NextResponse } from 'next/server'
import { getPublicRide } from '@/lib/dispatch-engine'
import { lockEscrow, toPublicEscrow } from '@/lib/escrow-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const rideId = typeof body?.rideId === 'string' ? body.rideId.trim() : ''
  const passengerId = typeof body?.passengerId === 'string' ? body.passengerId.trim() : ''
  if (!rideId || !passengerId) {
    return NextResponse.json({ error: 'rideId and passengerId required' }, { status: 400 })
  }
  const result = lockEscrow({
    rideId,
    passengerId,
    paymentId: typeof body?.paymentId === 'string' ? body.paymentId : undefined,
    txid: typeof body?.txid === 'string' ? body.txid : undefined,
    sandbox: body?.sandbox === true,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error, escrow: toPublicEscrow(result.escrow) }, { status: result.error === 'not_found' ? 404 : 409 })
  }
  return NextResponse.json({
    ok: true,
    escrow: toPublicEscrow(result.escrow),
    ride: getPublicRide(rideId),
  })
}

