import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { getDriver, hydrateDispatchFromKv, listRides, syncDispatchFromDisk } from '@/lib/dispatch-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 관리자 택시·대리 호출 이력 조회 — 상태 무관하게 전체 콜을 날짜/상태/검색어로 필터한다.
 * kind: taxi|daeri|all (기본 all), from·to: YYYY-MM-DD (KST 하루 경계),
 * status: searching|offered|assigned|unmatched|cancelled|completed,
 * q: 주소·승객 id·연락처·기사명·차량번호·ride id 부분 일치.
 */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const params = new URL(request.url).searchParams
  const kind = params.get('kind')?.trim() || ''
  const from = params.get('from')?.trim() || ''
  const to = params.get('to')?.trim() || ''
  const status = params.get('status')?.trim() || ''
  const q = (params.get('q') || '').trim().toLowerCase()

  const fromMs = /^\d{4}-\d{2}-\d{2}$/.test(from) ? Date.parse(`${from}T00:00:00+09:00`) : -Infinity
  const toMs = /^\d{4}-\d{2}-\d{2}$/.test(to) ? Date.parse(`${to}T23:59:59.999+09:00`) : Infinity

  syncDispatchFromDisk()
  await hydrateDispatchFromKv()

  const items = listRides()
    .filter((ride) => {
      const rideKind = ride.kind === 'daeri' ? 'daeri' : 'taxi'
      if (kind && kind !== 'all' && rideKind !== kind) return false
      const at = Date.parse(ride.createdAt)
      if (Number.isFinite(fromMs) && at < fromMs) return false
      if (Number.isFinite(toMs) && at > toMs) return false
      if (status && ride.status !== status) return false
      if (q) {
        const driver = ride.assignedDriverId ? getDriver(ride.assignedDriverId) : null
        const hay = [
          ride.id,
          ride.passengerId,
          ride.passengerPhone,
          ride.pickup.address,
          ride.pickup.label,
          ride.dest.address,
          ride.dest.label,
          driver?.name,
          driver?.plate,
          driver?.vehicle,
          driver?.phone,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 500)
    .map((ride) => {
      const driver = ride.assignedDriverId ? getDriver(ride.assignedDriverId) : null
      return {
        id: ride.id,
        kind: ride.kind === 'daeri' ? 'daeri' : 'taxi',
        status: ride.status,
        passengerId: ride.passengerId,
        passengerPhone: ride.passengerPhone ?? '',
        pickup: ride.pickup.address || ride.pickup.label || '',
        dest: ride.dest.address || ride.dest.label || '',
        waypoints: (ride.waypoints ?? []).map((point) => point.address || point.label || '').filter(Boolean),
        estimatedFare: ride.estimatedFare,
        waitMinutes: ride.waitMinutes ?? null,
        boardedAt: ride.boardedAt ?? null,
        readyToSettleAt: ride.readyToSettleAt ?? null,
        driver: driver
          ? { id: driver.id, name: driver.name, vehicle: driver.vehicle, plate: driver.plate, phone: driver.phone ?? '' }
          : null,
        createdAt: ride.createdAt,
        updatedAt: ride.updatedAt,
      }
    })

  return NextResponse.json({ ok: true, total: items.length, generatedAt: new Date().toISOString(), items })
}
