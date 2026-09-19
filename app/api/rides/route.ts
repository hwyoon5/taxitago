import { NextResponse } from 'next/server'
import { estimateTaxiFarePi, haversineKm } from '@/lib/dispatch-geo'
import { createRideAndMatch, toPublicRide } from '@/lib/dispatch-engine'
import { ensureSeedDrivers } from '@/lib/dispatch-store'
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

export async function POST(request: Request) {
  ensureSeedDrivers()
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const pickup = asPoint(body?.pickupLat, body?.pickupLng, { address: body?.pickupAddress })
  const dest = asPoint(body?.destLat, body?.destLng, { address: body?.destAddress, label: body?.destLabel })
  const passengerId = typeof body?.passengerId === 'string' ? body.passengerId.trim() : ''
  if (!pickup || !dest || !passengerId) {
    return NextResponse.json({ error: 'passengerId, pickup, dest required' }, { status: 400 })
  }
  const quoted =
    typeof body?.estimatedFare === 'number' && Number.isFinite(body.estimatedFare)
      ? Math.round(body.estimatedFare * 100) / 100
      : estimateTaxiFarePi(haversineKm(pickup, dest))
  const ride = createRideAndMatch({
    id: crypto.randomUUID(),
    passengerId,
    pickup,
    dest,
    estimatedFare: quoted,
  })
  return NextResponse.json({ ok: true, ride: toPublicRide(ride) })
}
