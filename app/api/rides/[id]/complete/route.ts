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
      const error = result.error === 'passenger_not_ready'
        ? '승객이 탑승을 확인하고 목적지에 도착한 뒤에만 정산할 수 있어요.'
        : result.error
      return NextResponse.json(
        { error, escrow: toPublicEscrow(result.escrow) },
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
