import { NextResponse } from 'next/server'
import { driverEarningsStats } from '@/lib/escrow-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const driverId = new URL(request.url).searchParams.get('driverId')?.trim() || ''
  if (!driverId) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  return NextResponse.json({ ok: true, stats: driverEarningsStats(driverId) })
}
