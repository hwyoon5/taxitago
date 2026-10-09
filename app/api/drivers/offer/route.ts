import { NextResponse } from 'next/server'
import { getDriverActiveRide, getDriverOffer } from '@/lib/dispatch-engine'
import { driverPenaltyInfo, ensureSeedDrivers, hydrateDispatchFromKv } from '@/lib/dispatch-store'
import { hydrateEscrowFromKv } from '@/lib/escrow-store'
import { driverEarningsStats } from '@/lib/escrow-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  ensureSeedDrivers()
  const params = new URL(request.url).searchParams
  const driverId = params.get('driverId')?.trim() || ''
  if (!driverId) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  // Include alias ids (e.g. a device-generated id used before partner login)
  // so history recorded under the old identity still surfaces.
  const ids = [driverId, ...params.getAll('altDriverId').map((id) => id.trim()).filter((id) => id && id !== driverId)]
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv()])
  const pending = ids.map((id) => getDriverOffer(id)).find(Boolean) ?? null
  return NextResponse.json({
    ok: true,
    ride: pending?.ride ?? null,
    offer: pending?.offer ?? null,
    active: ids.map((id) => getDriverActiveRide(id)).find(Boolean) ?? null,
    earnings: await driverEarningsStats(driverId, ids.slice(1)),
    // 거절 누적 패널티 상태 — 오퍼 폴링마다 함께 내려 UI 경고/복귀를 즉시 반영한다.
    penalty: driverPenaltyInfo(pending?.offer?.driverId ?? ids[0]),
  })
}
