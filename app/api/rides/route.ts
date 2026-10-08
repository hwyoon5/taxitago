import { NextResponse } from 'next/server'
import { estimateTaxiFarePi, etaMinutesFromKm, waypointRouteQuote, waypointSurchargePi } from '@/lib/dispatch-geo'
import { drivingRouteSummaryOnServer } from '@/lib/server-directions'
import { createRideAndMatch, toPublicRide } from '@/lib/dispatch-engine'
import { ensureSeedDrivers, flushDispatchPersist, hydrateDispatchFromKv, listRides, syncDispatchFromDisk } from '@/lib/dispatch-store'
import { hydrateEscrowFromKv } from '@/lib/escrow-store'
import { avoidSurchargePi, avoidZoneScore, hydrateAvoidFromKv } from '@/lib/avoid-zone-store'
import { isUsableCoord } from '@/lib/ride-session'
import { getFareConfig } from '@/lib/fare-config-server'
import { piRound } from '@/lib/pi-format'
import { verifyPiAccessToken } from '@/lib/pi-platform'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asPoint(lat: unknown, lng: unknown, extra?: { address?: unknown; label?: unknown }) {
  if (!isUsableCoord(lat, lng)) return null
  return {
    lat: Number(lat),
    lng: Number(lng),
    address: typeof extra?.address === 'string' ? extra.address : undefined,
    label: typeof extra?.label === 'string' ? extra.label : undefined,
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const actorId = url.searchParams.get('actorId')?.trim() || ''
  const role = url.searchParams.get('role')
  if (!actorId) return NextResponse.json({ error: 'actorId required' }, { status: 400 })
  syncDispatchFromDisk()
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv()])
  const rides = listRides()
    .filter((ride) => (role === 'driver' ? ride.assignedDriverId === actorId : ride.passengerId === actorId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 30)
    .map(toPublicRide)
  return NextResponse.json({ ok: true, rides })
}

export async function POST(request: Request) {
  ensureSeedDrivers()
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  // 비회원 호출 원천 차단 — 세션의 Pi uid + accessToken을 /v2/me로 재검증한다.
  // 개발용 샌드박스 세션은 테스트넷 환경에서만 토큰 없이 통과한다.
  const piUid =
    request.headers.get('x-pi-uid')?.trim() ||
    (typeof body?.piUid === 'string' ? body.piUid.trim() : '')
  const piToken =
    request.headers.get('x-pi-access-token')?.trim() ||
    (typeof body?.piAccessToken === 'string' ? body.piAccessToken.trim() : '')
  if (!piUid) {
    return NextResponse.json({ error: 'Pi 계정 연동 및 로그인 후 이용해 주세요.' }, { status: 401 })
  }
  const sandboxSession = isPiSandboxRequest(request) && piUid === 'sandbox-uid-taxitago'
  if (!sandboxSession) {
    if (!piToken) {
      return NextResponse.json({ error: 'Pi 계정 연동 및 로그인 후 이용해 주세요.' }, { status: 401 })
    }
    const verifiedUid = await verifyPiAccessToken(piToken)
    if (!verifiedUid || verifiedUid !== piUid) {
      return NextResponse.json({ error: 'Pi 인증이 만료되었거나 확인되지 않았습니다. 다시 로그인해 주세요.' }, { status: 401 })
    }
  }
  const pickup = asPoint(body?.pickupLat, body?.pickupLng, { address: body?.pickupAddress })
  const dest = asPoint(body?.destLat, body?.destLng, { address: body?.destAddress, label: body?.destLabel })
  const passengerId = typeof body?.passengerId === 'string' ? body.passengerId.trim() : ''
  if (!pickup || !dest || !passengerId) {
    return NextResponse.json({ error: 'passengerId, pickup, dest required' }, { status: 400 })
  }
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv(), hydrateAvoidFromKv()])
  const existing = listRides().find(
    (ride) =>
      ride.passengerId === passengerId &&
      (ride.status === 'searching' || ride.status === 'offered' || ride.status === 'assigned'),
  )
  if (existing) return NextResponse.json({ ok: true, ride: toPublicRide(existing), deduped: true })
  const kind = body?.kind === 'daeri' ? 'daeri' : 'taxi'
  const waypoints = (Array.isArray(body?.waypoints) ? (body.waypoints as Record<string, unknown>[]) : [])
    .slice(0, 2)
    .map((wp) => asPoint(wp?.lat, wp?.lng, { address: wp?.address, label: wp?.label }))
    .filter((wp): wp is NonNullable<typeof wp> => wp !== null)
  // 경유지별 우회량을 판별한다: 직행 경로 위(우회 <= epsilon)의 경유지는 추가 요금 0,
  // 우회 경유지는 추가되는 거리·시간에 비례해 surcharge를 붙인다.
  const fareQuote = waypointRouteQuote(pickup, dest, waypoints)
  const config = await getFareConfig()
  const quoted =
    typeof body?.estimatedFare === 'number' && Number.isFinite(body.estimatedFare)
      ? piRound(Math.max(0, body.estimatedFare) + waypointSurchargePi(fareQuote.chargeableDetourKm, config, kind))
      : estimateTaxiFarePi(fareQuote.chargeableKm, config, kind)
  // 기본 예상 소요 시간(분): 길찾기 API duration 우선, 실패 시 거리 기반 ETA.
  // 정체 추가 요금은 정산 시 실제 운행 시간과 이 기준치를 비교해 산정한다.
  const routeSummary = await Promise.race([
    drivingRouteSummaryOnServer(pickup, dest, waypoints),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 6500)),
  ]).catch(() => null)
  const expectedMinutes =
    routeSummary && Number.isFinite(routeSummary.durationMin)
      ? (routeSummary.durationMin as number)
      : etaMinutesFromKm(fareQuote.routeKm)
  // 기피 지역 할증 — 목적지 격자의 누적 거절/타임아웃/미배차율이 임계 이상이면
  // 견적에 할증을 얹어 기사 수락 유인을 만든다.
  const zone = avoidZoneScore(dest)
  const avoidPi = zone?.avoided ? avoidSurchargePi(quoted, zone.rate) : 0
  if (zone?.avoided) {
    console.log('[dispatch] avoided-zone surcharge', {
      zone: zone.key,
      label: zone.label,
      rate: zone.rate,
      samples: zone.samples,
      unmatched: zone.unmatched,
      reason: zone.reason,
      avoidPi,
    })
  }
  const ride = createRideAndMatch({
    id: crypto.randomUUID(),
    kind,
    passengerId,
    pickup,
    waypoints,
    dest,
    estimatedFare: piRound(quoted + avoidPi),
    avoidSurchargePi: avoidPi,
    expectedMinutes,
  })
  // Flush before responding so the pending offer is visible to other
  // serverless instances (the driver's offer poll) immediately.
  await flushDispatchPersist().catch(() => undefined)
  return NextResponse.json({ ok: true, ride: toPublicRide(ride) })
}
