import { NextResponse } from 'next/server'
import { completeAssignedRide, getPublicRide } from '@/lib/dispatch-engine'
import { releaseEscrow, toPublicEscrow } from '@/lib/escrow-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { driverId?: unknown } | null
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  if (!driverId) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  try {
    const result = await releaseEscrow(id, driverId)
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, escrow: toPublicEscrow(result.escrow) },
        { status: result.error === 'not_found' ? 404 : 409 },
      )
    }
    completeAssignedRide(id, driverId)
    return NextResponse.json({
      ok: true,
      ride: getPublicRide(id),
      escrow: toPublicEscrow(result.escrow),
      receipt: result.receipt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'settlement failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
