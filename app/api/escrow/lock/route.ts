import { NextResponse } from 'next/server'
import { getPublicRide } from '@/lib/dispatch-engine'
import { lockEscrow, toPublicEscrow } from '@/lib/escrow-engine'
import { hydrateDispatchFromKv } from '@/lib/dispatch-store'
import { flushEscrowPersist, hydrateEscrowFromKv } from '@/lib/escrow-store'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const rideId = typeof body?.rideId === 'string' ? body.rideId.trim() : ''
  const passengerId = typeof body?.passengerId === 'string' ? body.passengerId.trim() : ''
  const txid = typeof body?.txid === 'string' ? body.txid.trim() : ''
  if (!rideId || !passengerId) {
    return NextResponse.json({ error: 'rideId and passengerId required' }, { status: 400 })
  }
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv()])
  // 클라이언트가 보낸 txid는 서버가 /api/pi/complete(또는 테스트넷 mock-pay)로
  // 검증·기록한 결제만 인정 — 임의 문자열로 에스크로를 열어 정산을 빼가는
  // 경로를 차단한다.
  if (txid) {
    const { paymentKindOf } = await import('@/lib/payment-kind-store')
    const verifiedKind = await paymentKindOf(txid).catch(() => '')
    if (!verifiedKind) {
      return NextResponse.json({ error: 'payment not verified by this server' }, { status: 409 })
    }
  }
  const result = lockEscrow({
    rideId,
    passengerId,
    paymentId: typeof body?.paymentId === 'string' ? body.paymentId : undefined,
    txid: txid || undefined,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error, escrow: toPublicEscrow(result.escrow) }, { status: result.error === 'not_found' ? 404 : 409 })
  }
  await flushEscrowPersist().catch(() => undefined)
  return NextResponse.json({
    ok: true,
    escrow: toPublicEscrow(result.escrow),
    ride: getPublicRide(rideId),
  })
}

