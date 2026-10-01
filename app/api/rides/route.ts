import { NextResponse } from 'next/server'
import { estimateTaxiFarePi, haversineKm } from '@/lib/dispatch-geo'
import { createRideAndMatch, toPublicRide } from '@/lib/dispatch-engine'
import { ensureSeedDrivers, flushDispatchPersist, hydrateDispatchFromKv, listRides, syncDispatchFromDisk } from '@/lib/dispatch-store'
import { hydrateEscrowFromKv } from '@/lib/escrow-store'
import { isUsableCoord } from '@/lib/ride-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asPoint(lat: unknown, lng: unknown, extra?: { address?: unknown; label?: unknown }) {
  if (!isUsableCoord(lat, lng)) return null
  return {
    lat: Number(lat),
    lng: Number(lng),
    address: typeof extra?.address === 'string' ? extra.address : undefined,
    label: typeof extra?.label === 'string' ? extra.label : undefined,
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const actorId = url.searchParams.get('actorId')?.trim() || ''
  const role = url.searchParams.get('role')
  if (!actorId) return NextResponse.json({ error: 'actorId required' }, { status: 400 })
  syncDispatchFromDisk()
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv()])
  const rides = listRides()
    .filter((ride) => (role === 'driver' ? ride.assignedDriverId === actorId : ride.passengerId === actorId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 30)
    .map(toPublicRide)
  return NextResponse.json({ ok: true, rides })
}

export async function POST(request: Request) {
  ensureSeedDrivers()
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const pickup = asPoint(body?.pickupLat, body?.pickupLng, { address: body?.pickupAddress })
  const dest = asPoint(body?.destLat, body?.destLng, { address: body?.destAddress, label: body?.destLabel })
  const passengerId = typeof body?.passengerId === 'string' ? body.passengerId.trim() : ''
  if (!pickup || !dest || !passengerId) {
    return NextResponse.json({ error: 'passengerId, pickup, dest required' }, { status: 400 })
  }
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv()])
  const existing = listRides().find(
    (ride) =>
      ride.passengerId === passengerId &&
      (ride.status === 'searching' || ride.status === 'offered' || ride.status === 'assigned'),
  )
  if (existing) return NextResponse.json({ ok: true, ride: toPublicRide(existing), deduped: true })
  const quoted =
    typeof body?.estimatedFare === 'number' && Number.isFinite(body.estimatedFare)
      ? Math.round(body.estimatedFare * 100) / 100
      : estimateTaxiFarePi(haversineKm(pickup, dest))
  const kind = body?.kind === 'daeri' ? 'daeri' : 'taxi'
  const ride = createRideAndMatch({
    id: crypto.randomUUID(),
    kind,
    passengerId,
    pickup,
    dest,
    estimatedFare: quoted,
  })
  // Flush before responding so the pending offer is visible to other
  // serverless instances (the driver's offer poll) immediately.
  await flushDispatchPersist().catch(() => undefined)
  return NextResponse.json({ ok: true, ride: toPublicRide(ride) })
}
