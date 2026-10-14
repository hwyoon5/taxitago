import { NextResponse } from 'next/server'
import { assignNextDriver, toPublicRide } from '@/lib/dispatch-engine'
import { flushDispatchPersist, getRide, hydrateDispatchFromKv, nowIso, publishDriverLive, publishRideLive, saveRide, syncDispatchFromDisk } from '@/lib/dispatch-store'
import { piRound } from '@/lib/pi-format'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 미배차 호출의 요금 수동 상향 — 택배 '요금 올리기'와 같은 규칙:
 * 본인 소유 + searching/offered/unmatched + 현재보다 높은 금액만 허용한다.
 * 상향된 견적은 진행 중인 기사 오퍼와 실시간 리스트에 즉시 반영된다.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { passengerId?: string; fare?: unknown } | null
  const passengerId = typeof body?.passengerId === 'string' ? body.passengerId.trim() : ''
  const fare = Number(body?.fare)
  if (!passengerId) return NextResponse.json({ error: 'passengerId required' }, { status: 400 })
  if (!Number.isFinite(fare) || fare <= 0 || fare > 10_000) {
    return NextResponse.json({ error: 'invalid fare' }, { status: 400 })
  }
  syncDispatchFromDisk()
  await hydrateDispatchFromKv()
  const ride = getRide(id)
  if (!ride) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (ride.passengerId !== passengerId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (ride.status !== 'searching' && ride.status !== 'offered' && ride.status !== 'unmatched') {
    return NextResponse.json({ error: 'already_assigned' }, { status: 409 })
  }
  if (fare <= ride.estimatedFare) {
    return NextResponse.json({ error: 'fare_must_exceed_current', ride: toPublicRide(ride) }, { status: 409 })
  }
  ride.estimatedFare = piRound(fare)
  ride.updatedAt = nowIso()
  saveRide(ride)
  // unmatched 상태에서 요금이 오르면 같은 콜로 배차를 다시 시도한다 —
  // 명시 거절한 기사는 계속 제외하고, 응답 없이 타임아웃된 기사는 새 요금으로 재오퍼한다.
  if (ride.status === 'unmatched') {
    ride.status = 'searching'
    ride.currentOffer = null
    ride.timedOutDriverIds = []
    saveRide(ride)
    assignNextDriver(ride.id)
  }
  // 오퍼를 받는 중인 기사에게도 즉시 재계산된 요금을 푸시한다.
  if (ride.currentOffer?.decision === 'pending') publishDriverLive(ride.currentOffer.driverId)
  publishRideLive(ride.id)
  await flushDispatchPersist().catch(() => undefined)
  return NextResponse.json({ ok: true, ride: toPublicRide(getRide(id) ?? ride) })
}
