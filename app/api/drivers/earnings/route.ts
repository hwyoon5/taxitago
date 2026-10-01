import { NextResponse } from 'next/server'
import { driverEarningsStats } from '@/lib/escrow-engine'
import { hydrateDispatchFromKv } from '@/lib/dispatch-store'
import { hydrateEscrowFromKv } from '@/lib/escrow-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const driverId = params.get('driverId')?.trim() || ''
  if (!driverId) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  const aliases = params.getAll('altDriverId').map((id) => id.trim()).filter((id) => id && id !== driverId)
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv()])
  return NextResponse.json({ ok: true, stats: await driverEarningsStats(driverId, aliases) })
}
