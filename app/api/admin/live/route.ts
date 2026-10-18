import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { presenceCounts, presenceDetails } from '@/lib/presence-store'
import { ensureSeedDrivers, getDriver, hydrateDispatchFromKv, listDrivers, listRides } from '@/lib/dispatch-store'
import { listDevices } from '@/lib/device-store'
import { listAllDeliveries } from '@/lib/delivery-dispatch'
import { DRIVER_STALE_MS } from '@/lib/dispatch-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 매칭 파이프라인에 아직 살아 있는 운행 상태 — 이외(완료·취소·미배정 종료)는 현황에서 제외. */
const ACTIVE_STATUSES = new Set(['searching', 'offered', 'assigned'])

export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  await hydrateDispatchFromKv().catch(() => undefined)
  ensureSeedDrivers()
  const [presence, devices, riderDetails, partnerDetails] = await Promise.all([
    presenceCounts(),
    listDevices().catch(() => [] as Awaited<ReturnType<typeof listDevices>>),
    presenceDetails('passenger').catch(() => []),
    presenceDetails('partner').catch(() => []),
  ])

  const now = Date.now()
  const activeRides = listRides()
    .filter((ride) => ACTIVE_STATUSES.has(ride.status))
    .sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''))
    .slice(0, 50)

  const rides = activeRides.map((ride) => {
    const driverId = ride.assignedDriverId || (ride.currentOffer?.decision === 'pending' ? ride.currentOffer.driverId : null)
    const driver = driverId ? getDriver(driverId) : null
    return {
      id: ride.id,
      kind: ride.kind === 'daeri' ? 'daeri' : 'taxi',
      status: ride.status,
      passengerId: ride.passengerId,
      pickup: ride.pickup.address || ride.pickup.label || '',
      dest: ride.dest.address || ride.dest.label || '',
      estimatedFare: ride.estimatedFare,
      driver: driver ? { id: driver.id, name: driver.name, vehicle: driver.vehicle, plate: driver.plate } : null,
      // 관제 지도의 경로 폴리라인·선택 상세용 — 활성 건만 목록에 오르므로 좌표 포함.
      driverId,
      pickupPoint: { lat: ride.pickup.lat, lng: ride.pickup.lng },
      destPoint: { lat: ride.dest.lat, lng: ride.dest.lng },
      waypointPoints: (ride.waypoints ?? []).map((point) => ({ lat: point.lat, lng: point.lng })),
      offerExpiresAt: ride.currentOffer?.decision === 'pending' ? ride.currentOffer.expiresAt : null,
      createdAt: ride.createdAt,
      updatedAt: ride.updatedAt,
    }
  })

  const dutyDrivers = listDrivers().filter((driver) => !driver.virtual)
  const fresh = (driver: (typeof dutyDrivers)[number]) => now - Date.parse(driver.lastSeenAt || '') <= DRIVER_STALE_MS
  const matching = {
    searching: activeRides.filter((ride) => ride.status === 'searching').length,
    offered: activeRides.filter((ride) => ride.status === 'offered').length,
    assigned: activeRides.filter((ride) => ride.status === 'assigned').length,
    driversOnline: dutyDrivers.filter((driver) => driver.status === 'online' && fresh(driver)).length,
    driversBusy: dutyDrivers.filter((driver) => driver.status === 'busy' && fresh(driver)).length,
  }

  // 관제 대시보드 — 온라인 기사의 마지막 좌표·영업 상태(운행 건과 연결).
  const rideByDriver = new Map<string, (typeof activeRides)[number]>()
  const rideByPassenger = new Map<string, (typeof activeRides)[number]>()
  for (const ride of activeRides) {
    const dId = ride.assignedDriverId || (ride.currentOffer?.decision === 'pending' ? ride.currentOffer.driverId : null)
    if (dId && !rideByDriver.has(dId)) rideByDriver.set(dId, ride)
    if (ride.passengerId && !rideByPassenger.has(ride.passengerId)) rideByPassenger.set(ride.passengerId, ride)
  }
  const trackingDrivers = dutyDrivers
    .filter((driver) => driver.status !== 'offline' && fresh(driver))
    .map((driver) => {
      const ride = rideByDriver.get(driver.id) ?? null
      return {
        id: driver.id,
        name: driver.name || driver.id,
        vehicle: driver.vehicle || '',
        plate: driver.plate || '',
        duty: driver.status,
        rideStatus: ride ? ride.status : null,
        rideKind: ride ? ride.kind : null,
        lat: driver.lat,
        lng: driver.lng,
        lastSeenAt: driver.lastSeenAt,
      }
    })
    .sort((a, b) => Date.parse(b.lastSeenAt || '') - Date.parse(a.lastSeenAt || ''))
  const maskId = (id: string) => (id.length > 12 ? `${id.slice(0, 10)}…` : id)
  const trackingUsers = [
    ...riderDetails.map((d) => ({ ...d, role: 'passenger' as const })),
    ...partnerDetails.map((d) => ({ ...d, role: 'partner' as const })),
  ]
    .map((detail) => {
      const ride = rideByPassenger.get(detail.id) ?? null
      return {
        id: maskId(detail.id),
        role: detail.role,
        rideStatus: ride ? ride.status : null,
        rideKind: ride ? ride.kind : null,
        lat: detail.lat ?? null,
        lng: detail.lng ?? null,
        lastSeenAt: new Date(detail.lastSeen).toISOString(),
      }
    })
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))

  // 진행 중 택배(수거 이동·배송 중) — 관제 지도에서 기사 핀 선택 시 수거지→목적지 경로 표시.
  const deliveries = (await listAllDeliveries().catch(() => [] as Awaited<ReturnType<typeof listAllDeliveries>>))
    .filter((job) => job.status === 'assigned' || job.status === 'in_transit')
    .map((job) => ({
      id: job.id,
      status: job.status,
      pickup: job.pickupAddress,
      dest: job.destAddress,
      pickupPoint: { lat: job.pickupLat ?? null, lng: job.pickupLng ?? null },
      destPoint: { lat: job.destLat ?? null, lng: job.destLng ?? null },
      driverId: job.driverId,
      driverName: job.driverName,
    }))

  const bucket = () => ({ total: 0, rented: 0, idle: 0, active: 0, other: 0 })
  const mobility: Record<'bicycle' | 'kickboard', ReturnType<typeof bucket>> = { bicycle: bucket(), kickboard: bucket() }
  for (const device of devices) {
    const type = (typeof device.type === 'string' ? device.type : '').trim().toLowerCase()
    if (type !== 'bicycle' && type !== 'kickboard') continue
    const row = mobility[type]
    row.total += 1
    if (device.status === 'rented') row.rented += 1
    else if (device.status === 'idle') row.idle += 1
    else if (device.status === 'active') row.active += 1
    else row.other += 1
  }

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    presence,
    matching,
    rides,
    deliveries,
    tracking: { drivers: trackingDrivers, users: trackingUsers },
    mobility,
    presenceWindowMs: 90_000,
  })
}
