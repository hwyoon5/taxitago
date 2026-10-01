import { NextResponse } from 'next/server'
import { abandonAssignedRide, toPublicRide } from '@/lib/dispatch-engine'
import { hydrateDispatchFromKv } from '@/lib/dispatch-store'
import { hydrateEscrowFromKv } from '@/lib/escrow-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { driverId?: unknown } | null
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  if (!driverId) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv()])
  const result = abandonAssignedRide(id, driverId)
  if (!result.ok || !result.ride) {
    const message =
      result.error === 'completed'
        ? '이미 완료된 운행이에요.'
        : result.error === 'cancelled'
          ? '이미 취소된 운행이에요.'
          : result.error === 'forbidden'
            ? '내게 배정된 운행이 아니에요.'
            : result.error === 'not_found'
              ? '취소할 운행을 찾지 못했어요.'
              : '배차를 취소하지 못했어요.'
    return NextResponse.json({ error: message }, { status: result.error === 'not_found' ? 404 : 409 })
  }
  return NextResponse.json({ ok: true, ride: toPublicRide(result.ride) })
}
