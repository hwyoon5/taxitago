import { NextResponse } from 'next/server'
import { upsertDriverPresence } from '@/lib/dispatch-engine'
import { ensureSeedDrivers } from '@/lib/dispatch-store'
import { isUsableCoord } from '@/lib/ride-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  ensureSeedDrivers()
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  const lat = body?.lat
  const lng = body?.lng
  const online = body?.online !== false && body?.status !== 'offline'
  if (!driverId || !isUsableCoord(lat, lng)) {
    return NextResponse.json({ error: 'driverId and coordinates required' }, { status: 400 })
  }
  const driver = upsertDriverPresence({
    id: driverId,
    lat: Number(lat),
    lng: Number(lng),
    status: online ? 'online' : 'offline',
    name: typeof body?.name === 'string' ? body.name : undefined,
    vehicle: typeof body?.vehicle === 'string' ? body.vehicle : undefined,
    plate: typeof body?.plate === 'string' ? body.plate : undefined,
    wallet: typeof body?.wallet === 'string' ? body.wallet : undefined,
    piUid: typeof body?.piUid === 'string' ? body.piUid : undefined,
  })
  return NextResponse.json({ ok: true, driver })
}
