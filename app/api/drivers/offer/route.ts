import { NextResponse } from 'next/server'
import { getDriverActiveRide, getDriverOffer } from '@/lib/dispatch-engine'
import { ensureSeedDrivers, hydrateDispatchFromKv } from '@/lib/dispatch-store'
import { hydrateEscrowFromKv } from '@/lib/escrow-store'
import { driverEarningsStats } from '@/lib/escrow-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  ensureSeedDrivers()
  const driverId = new URL(request.url).searchParams.get('driverId')?.trim() || ''
  if (!driverId) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv()])
  const pending = getDriverOffer(driverId)
  return NextResponse.json({
    ok: true,
    ride: pending?.ride ?? null,
    offer: pending?.offer ?? null,
    active: getDriverActiveRide(driverId),
    earnings: driverEarningsStats(driverId),
  })
}
