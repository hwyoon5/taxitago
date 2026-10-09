import { NextResponse } from 'next/server'
import { upsertDriverPresence } from '@/lib/dispatch-engine'
import { ensureSeedDrivers, flushDispatchPersist } from '@/lib/dispatch-store'
import { isUsableCoord } from '@/lib/ride-session'
import { isUserLocked } from '@/lib/user-registry'

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
  // 이용 정지(Lock) 기사는 온라인 전환을 차단한다 — 오프라인 전환은 허용.
  if (online && (await isUserLocked(driverId).catch(() => false))) {
    return NextResponse.json({ error: '관리자에 의해 이용이 정지된 계정입니다.' }, { status: 403 })
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
    altDriverId: typeof body?.altDriverId === 'string' ? body.altDriverId.trim() : undefined,
  })
  await flushDispatchPersist()
  return NextResponse.json({ ok: true, driver })
}
