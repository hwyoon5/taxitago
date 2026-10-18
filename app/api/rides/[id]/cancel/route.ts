import { NextResponse } from 'next/server'
import { rideTransitionErrorMessage, transitionRide } from '@/lib/ride-machine'
import { recordFdsSignal } from '@/lib/fds-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { passengerId?: unknown; settleFee?: unknown; denyBoard?: unknown } | null
  const passengerId = typeof body?.passengerId === 'string' ? body.passengerId : undefined
  const settleFee = body?.settleFee === true
  const denyBoard = body?.denyBoard === true
  try {
    const result = await transitionRide({ rideId: id, action: 'cancel', passengerId, settleFee, denyBoard })
    if (!result.ok) {
      return NextResponse.json(
        { error: rideTransitionErrorMessage(result.error) },
        { status: result.error === 'forbidden' ? 403 : 409 },
      )
    }
    if (!result.ride) return NextResponse.json({ ok: true, missing: true, ride: null })
    // FDS 시그널 — 연속 취소 패턴과, 배차된 상태에서의 취소는 동일
    // 기사-승객 허위 매칭(churn)으로도 집계한다.
    if (passengerId) {
      void recordFdsSignal('cancel-streak', { actorId: passengerId, refId: id }).catch(() => undefined)
      const driverId = result.ride.assignedDriver?.id
      if (driverId) {
        void recordFdsSignal('match-churn', {
          actorId: passengerId,
          groupId: `pair:${driverId}|${passengerId}`,
          refId: id,
          detail: `배차 후 취소 · 기사 ${driverId}`,
        }).catch(() => undefined)
      }
    }
    return NextResponse.json({ ok: true, ride: result.ride })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cancel settlement failed'
    console.error('[cancel] failed', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
