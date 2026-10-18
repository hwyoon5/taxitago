import { NextResponse } from 'next/server'
import { getDriver, getRide, hydrateDispatchFromKv, listRides, syncDispatchFromDisk } from '@/lib/dispatch-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function pointPayload(point: { lat: number; lng: number; address?: string; label?: string }) {
  return {
    lat: point.lat,
    lng: point.lng,
    address: point.address || '',
    label: point.label || '',
  }
}

/**
 * 안심귀가 공유 페이지의 공개 읽기 엔드포인트 — 토큰만으로 조회한다.
 * 승객 식별자·연락처·결제 정보는 일절보내지 않고, 차량 실시간 위치는
 * 운행이 진행 중일 때만 포함한다(종료/취소 후에는 마지막 상태만 보인다).
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const key = typeof token === 'string' ? token.trim() : ''
  if (!key || key.length < 24) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  syncDispatchFromDisk()
  await hydrateDispatchFromKv()
  const ride = listRides().find((item) => item.shareToken === key)
  if (!ride) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const driver = ride.assignedDriverId ? getDriver(ride.assignedDriverId) : null
  // 배정된 동안은 픽업 접근부터 운행까지 차량 위치를 계속 흘려보낸다 —
  // 지인이 '차가 오고 있다/이동 중이다'를 모두 확인할 수 있어야 한다.
  const live = ride.status === 'assigned'
  return NextResponse.json({
    ok: true,
    ride: {
      kind: ride.kind,
      status: ride.status,
      pickup: pointPayload(ride.pickup),
      dest: pointPayload(ride.dest),
      waypoints: (ride.waypoints ?? []).map(pointPayload),
      boardedAt: ride.boardedAt ?? null,
      readyToSettleAt: ride.readyToSettleAt ?? null,
      driver: driver
        ? { name: driver.name, vehicle: driver.vehicle, plate: driver.plate }
        : null,
      vehicle:
        live && driver
          ? { lat: driver.lat, lng: driver.lng, heading: driver.heading ?? 0, at: driver.lastSeenAt }
          : null,
      updatedAt: ride.updatedAt,
    },
  })
}
