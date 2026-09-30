import { NextResponse } from 'next/server'
import { completeAssignedRide, ensureRideForCompletion, getPublicRide, toPublicRide } from '@/lib/dispatch-engine'
import { releaseEscrow, toPublicEscrow } from '@/lib/escrow-engine'
import { archiveRideComms } from '@/lib/comms-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function point(value: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown } | undefined) {
  const lat = Number(value?.lat)
  const lng = Number(value?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined
  return {
    lat,
    lng,
    address: typeof value?.address === 'string' ? value.address : undefined,
    label: typeof value?.label === 'string' ? value.label : undefined,
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as {
    driverId?: unknown
    ride?: {
      passengerId?: unknown
      pickup?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }
      dest?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }
      estimatedFare?: unknown
      kind?: unknown
      boardedAt?: unknown
      readyToSettleAt?: unknown
      escrow?: { status?: unknown; lockTxid?: unknown; lockPaymentId?: unknown }
    }
  } | null
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  if (!driverId) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  const snapshot = body?.ride
  ensureRideForCompletion(id, driverId, {
    passengerId: typeof snapshot?.passengerId === 'string' ? snapshot.passengerId : undefined,
    pickup: point(snapshot?.pickup),
    dest: point(snapshot?.dest),
    estimatedFare: typeof snapshot?.estimatedFare === 'number' ? snapshot.estimatedFare : undefined,
    kind: snapshot?.kind === 'daeri' ? 'daeri' : 'taxi',
    boardedAt: typeof snapshot?.boardedAt === 'string' ? snapshot.boardedAt : null,
    readyToSettleAt: typeof snapshot?.readyToSettleAt === 'string' ? snapshot.readyToSettleAt : null,
  })
  try {
    const escrowProof = snapshot?.escrow
    const result = await releaseEscrow(id, driverId, {
      status: typeof escrowProof?.status === 'string' ? escrowProof.status : null,
      lockTxid: typeof escrowProof?.lockTxid === 'string' ? escrowProof.lockTxid : null,
      lockPaymentId: typeof escrowProof?.lockPaymentId === 'string' ? escrowProof.lockPaymentId : null,
    })
    if (!result.ok) {
      const error = result.error === 'passenger_not_ready'
        ? '승객이 탑승을 확인하고 목적지에 도착한 뒤에만 정산할 수 있어요.'
        : result.error === 'escrow_not_held'
          ? '승객 에스크로가 잠긴 뒤에 정산할 수 있어요.'
          : result.error
      const message = result.error === 'not_found' ? '완료할 운행을 찾지 못했어요.' : error
      return NextResponse.json(
        { error: message, escrow: toPublicEscrow(result.escrow) },
        { status: 409 },
      )
    }
    const finished = completeAssignedRide(id, driverId)
    await archiveRideComms(id, 'completed').catch(() => undefined)
    const ride = getPublicRide(id) ?? (finished ? toPublicRide(finished) : null)
    if (!ride) return NextResponse.json({ error: '이용 완료 결과를 만들지 못했어요.' }, { status: 500 })
    return NextResponse.json({
      ok: true,
      ride,
      escrow: toPublicEscrow(result.escrow),
      receipt: result.receipt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'settlement failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
