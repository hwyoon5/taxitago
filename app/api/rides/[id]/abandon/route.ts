import { NextResponse } from 'next/server'
import { rideTransitionErrorMessage, transitionRide } from '@/lib/ride-machine'
import { recordFdsSignal } from '@/lib/fds-store'

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
  // FDS 시그널 — 기사의 배차 후 포기도 쌍 단위 churn과 연속 취소로 집계한다.
  void recordFdsSignal('cancel-streak', { actorId: driverId, refId: id, detail: '기사 배차 후 포기' }).catch(() => undefined)
  const passengerId = result.ride?.passengerId
  if (passengerId) {
    void recordFdsSignal('match-churn', {
      actorId: driverId,
      groupId: `pair:${driverId}|${passengerId}`,
      refId: id,
      detail: `기사 배차 후 포기 · 승객 ${passengerId}`,
    }).catch(() => undefined)
  }
  return NextResponse.json({ ok: true, ride: result.ride })
}
