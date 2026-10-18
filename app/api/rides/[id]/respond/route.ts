import { NextResponse } from 'next/server'
import { confirmMatchOnDevice, rememberDriverVehicle, toPublicRide } from '@/lib/dispatch-engine'
import { openRideComms } from '@/lib/comms-engine'
import { driverPenaltyInfo, flushDispatchPersist, hydrateDispatchFromKv } from '@/lib/dispatch-store'
import { flushEscrowPersist, hydrateEscrowFromKv } from '@/lib/escrow-store'
import { hydrateAvoidFromKv } from '@/lib/avoid-zone-store'
import { rideTransitionErrorMessage, transitionRide } from '@/lib/ride-machine'
import { normalizeRideTier } from '@/lib/ride-tiers'
import { getRegistryUser } from '@/lib/user-registry'
import { complianceGate } from '@/lib/compliance-store'

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

function points(value: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }[] | undefined) {
  if (!Array.isArray(value)) return undefined
  const list = value
    .slice(0, 2)
    .map((item) => point(item))
    .filter((item): item is NonNullable<typeof item> => item != null)
  return list.length ? list : undefined
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as {
    driverId?: unknown
    action?: unknown
    name?: unknown
    vehicle?: unknown
    plate?: unknown
    ride?: {
      passengerId?: unknown
      pickup?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }
      waypoints?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }[]
      dest?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }
      estimatedFare?: unknown
      tollPi?: unknown
      tollKrw?: unknown
      expectedMinutes?: unknown
      kind?: unknown
      tier?: unknown
    }
  } | null
  const action = body?.action === 'accept' || body?.action === 'reject' || body?.action === 'device-accept' ? body.action : null
  if (!action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 })
  }
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv(), hydrateAvoidFromKv()])
  // 자격 인증 게이트 — 미승인·반려 계정은 presence가 막히기 직전의 오퍼도
  // 수락하지 못한다(45초 stale 윈도우 방어). 미등록 테스트넷 단말은 허용.
  const acceptDriverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  if ((action === 'accept' || action === 'device-accept') && acceptDriverId) {
    const regUser = await getRegistryUser(acceptDriverId).catch(() => null)
    if (regUser && !regUser.withdrawnAt) {
      const gate = await complianceGate(regUser).catch(() => null)
      if (gate && !gate.ok) {
        return NextResponse.json(
          { error: '자격 인증이 완료돼야 콜을 수락할 수 있습니다.', complianceRequired: true },
          { status: 403 },
        )
      }
    }
  }
  if (action === 'device-accept') {
    const result = confirmMatchOnDevice(
      id,
      {
        passengerId: typeof body?.ride?.passengerId === 'string' ? body.ride.passengerId : undefined,
        pickup: point(body?.ride?.pickup),
        waypoints: points(body?.ride?.waypoints),
        dest: point(body?.ride?.dest),
        estimatedFare: typeof body?.ride?.estimatedFare === 'number' ? body.ride.estimatedFare : undefined,
        tollPi: typeof body?.ride?.tollPi === 'number' ? body.ride.tollPi : undefined,
        tollKrw: typeof body?.ride?.tollKrw === 'number' ? body.ride.tollKrw : undefined,
        expectedMinutes: typeof body?.ride?.expectedMinutes === 'number' ? body.ride.expectedMinutes : undefined,
        kind: body?.ride?.kind === 'daeri' ? 'daeri' : 'taxi',
        tier: normalizeRideTier(body?.ride?.tier),
      },
      typeof body?.driverId === 'string' ? body.driverId.trim() : undefined,
    )
    if (!result.ride) return NextResponse.json({ error: result.error }, { status: 404 })
    if (!result.ok) return NextResponse.json({ error: result.error, ride: toPublicRide(result.ride) }, { status: 409 })
    await Promise.all([flushDispatchPersist(), flushEscrowPersist(), openRideComms(id)]).catch(() => null)
    return NextResponse.json({ ok: true, ride: toPublicRide(result.ride) })
  }
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  if (!driverId) {
    return NextResponse.json({ error: 'driverId and action required' }, { status: 400 })
  }
  if (action === 'accept') {
    rememberDriverVehicle(driverId, {
      name: typeof body?.name === 'string' ? body.name : undefined,
      vehicle: typeof body?.vehicle === 'string' ? body.vehicle : undefined,
      plate: typeof body?.plate === 'string' ? body.plate : undefined,
    })
  }
  const result = await transitionRide({
    rideId: id,
    action,
    driverId,
    snapshot: body?.ride
      ? {
          passengerId: body.ride.passengerId,
          pickup: body.ride.pickup,
          waypoints: body.ride.waypoints,
          dest: body.ride.dest,
          estimatedFare: body.ride.estimatedFare,
          tollPi: body.ride.tollPi,
          tollKrw: body.ride.tollKrw,
          expectedMinutes: body.ride.expectedMinutes,
          kind: body.ride.kind,
          tier: body.ride.tier,
        }
      : undefined,
  })
  if (!result.ride) return NextResponse.json({ error: result.ok ? 'not_found' : result.error }, { status: 404 })
  if (!result.ok) {
    return NextResponse.json({ error: rideTransitionErrorMessage(result.error), ride: result.ride }, { status: 409 })
  }
  return NextResponse.json({
    ok: true,
    ride: result.ride,
    penalty: action === 'reject' ? driverPenaltyInfo(driverId) : null,
  })
}
