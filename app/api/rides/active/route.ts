import { NextResponse } from 'next/server'
import { getDriverActiveRide, toPublicRide } from '@/lib/dispatch-engine'
import { getPassengerActiveRide } from '@/lib/ride-machine'
import { hydrateDispatchFromKv } from '@/lib/dispatch-store'
import { hydrateEscrowFromKv } from '@/lib/escrow-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Canonical "my current ride" lookup shared by passenger and driver mode. */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const actorId = url.searchParams.get('actorId')?.trim() || ''
  const role = url.searchParams.get('role') === 'driver' ? 'driver' : 'passenger'
  if (!actorId) return NextResponse.json({ error: 'actorId required' }, { status: 400 })
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv()])
  const ride =
    role === 'driver'
      ? getDriverActiveRide(actorId)
      : (() => {
          const active = getPassengerActiveRide(actorId)
          return active ? toPublicRide(active) : null
        })()
  return NextResponse.json({ ok: true, ride })
}
