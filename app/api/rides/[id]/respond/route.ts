import { NextResponse } from 'next/server'
import { confirmMatchOnDevice, rememberDriverVehicle, respondToOffer, restorePendingOffer, toPublicRide } from '@/lib/dispatch-engine'
import { openRideComms } from '@/lib/comms-engine'
import { hydrateDispatchFromKv } from '@/lib/dispatch-store'
import { hydrateEscrowFromKv } from '@/lib/escrow-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
      dest?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }
      estimatedFare?: unknown
      kind?: unknown
    }
  } | null
  const action = body?.action === 'accept' || body?.action === 'reject' || body?.action === 'device-accept' ? body.action : null
  if (!action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 })
  }
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv()])
  if (action === 'device-accept') {
    const point = (value: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown } | undefined) => {
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
    const result = confirmMatchOnDevice(id, {
      passengerId: typeof body?.ride?.passengerId === 'string' ? body.ride.passengerId : undefined,
      pickup: point(body?.ride?.pickup),
      dest: point(body?.ride?.dest),
      estimatedFare: typeof body?.ride?.estimatedFare === 'number' ? body.ride.estimatedFare : undefined,
      kind: body?.ride?.kind === 'daeri' ? 'daeri' : 'taxi',
    })
    if (!result.ride) return NextResponse.json({ error: result.error }, { status: 404 })
    if (!result.ok) return NextResponse.json({ error: result.error, ride: toPublicRide(result.ride) }, { status: 409 })
    await openRideComms(id).catch(() => null)
    return NextResponse.json({ ok: true, ride: toPublicRide(result.ride) })
  }
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  if (!driverId) {
    return NextResponse.json({ error: 'driverId and action required' }, { status: 400 })
  }
  const point = (value: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown } | undefined) => {
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
  if (action === 'accept') {
    rememberDriverVehicle(driverId, {
      name: typeof body?.name === 'string' ? body.name : undefined,
      vehicle: typeof body?.vehicle === 'string' ? body.vehicle : undefined,
      plate: typeof body?.plate === 'string' ? body.plate : undefined,
    })
  }
  let result = respondToOffer(id, driverId, action)
  if (!result.ok && result.error === 'not_found' && action === 'accept') {
    const snapshot = body?.ride
    const restored = restorePendingOffer(id, driverId, {
      passengerId: typeof snapshot?.passengerId === 'string' ? snapshot.passengerId : undefined,
      pickup: point(snapshot?.pickup),
      dest: point(snapshot?.dest),
      estimatedFare: typeof snapshot?.estimatedFare === 'number' ? snapshot.estimatedFare : undefined,
      kind: snapshot?.kind === 'daeri' ? 'daeri' : 'taxi',
    })
    if (restored) result = respondToOffer(id, driverId, action)
  }
  if (!result.ride) return NextResponse.json({ error: result.error }, { status: 404 })
  if (!result.ok) return NextResponse.json({ error: result.error, ride: toPublicRide(result.ride) }, { status: 409 })
  if (result.ride.assignedDriverId) await openRideComms(id).catch(() => null)
  return NextResponse.json({ ok: true, ride: toPublicRide(result.ride) })
}
