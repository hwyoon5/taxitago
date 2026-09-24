import { NextResponse } from 'next/server'
import { cancelRide, toPublicRide } from '@/lib/dispatch-engine'
import { settlePassengerCancelFee } from '@/lib/escrow-engine'
import { getRide } from '@/lib/dispatch-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { passengerId?: unknown; settleFee?: unknown } | null
  const passengerId = typeof body?.passengerId === 'string' ? body.passengerId : undefined
  const settleFee = body?.settleFee === true
  try {
    const current = getRide(id)
    if (settleFee && current?.status === 'assigned' && current.assignedDriverId) {
      if (passengerId && current.passengerId !== passengerId) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      }
      await settlePassengerCancelFee(id)
    }
    const ride = cancelRide(id, passengerId)
    if (!ride) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ ok: true, ride: toPublicRide(ride) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cancel settlement failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
