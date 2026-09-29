import { NextResponse } from 'next/server'
import { rememberDriverVehicle } from '@/lib/dispatch-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    driverId?: unknown
    name?: unknown
    vehicle?: unknown
    plate?: unknown
  } | null
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  if (!driverId) {
    return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  }
  const driver = rememberDriverVehicle(driverId, {
    name: typeof body?.name === 'string' ? body.name : undefined,
    vehicle: typeof body?.vehicle === 'string' ? body.vehicle : undefined,
    plate: typeof body?.plate === 'string' ? body.plate : undefined,
  })
  return NextResponse.json({ ok: true, driver })
}
