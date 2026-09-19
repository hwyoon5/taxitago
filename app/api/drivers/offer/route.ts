import { NextResponse } from 'next/server'
import { getDriverOffer } from '@/lib/dispatch-engine'
import { ensureSeedDrivers } from '@/lib/dispatch-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  ensureSeedDrivers()
  const driverId = new URL(request.url).searchParams.get('driverId')?.trim() || ''
  if (!driverId) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  const pending = getDriverOffer(driverId)
  return NextResponse.json({
    ok: true,
    ride: pending?.ride ?? null,
    offer: pending?.offer ?? null,
  })
}
