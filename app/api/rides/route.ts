import { NextResponse } from 'next/server'
import { estimateTaxiFarePi, etaMinutesFromKm, waypointRouteQuote, waypointSurchargePi } from '@/lib/dispatch-geo'
import { drivingRouteSummaryOnServer } from '@/lib/server-directions'
import { createRideAndMatch, toPublicRide } from '@/lib/dispatch-engine'
import { ensureSeedDrivers, flushDispatchPersist, hydrateDispatchFromKv, listRides, syncDispatchFromDisk } from '@/lib/dispatch-store'
import { hydrateEscrowFromKv } from '@/lib/escrow-store'
import { avoidSurchargePi, avoidZoneScore, hydrateAvoidFromKv } from '@/lib/avoid-zone-store'
import { isUsableCoord } from '@/lib/ride-session'
import { getFareConfig } from '@/lib/fare-config-server'
import { timeSurchargeRate, tollFareToPi } from '@/lib/fare-config'
import { piRound } from '@/lib/pi-format'
import { inspectPiAccessToken } from '@/lib/pi-platform'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'
import { isUserLocked } from '@/lib/user-registry'

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
  const sandbox = isPiSandboxRequest(request)
  // 테스트넷은 /v2/me가 불안정하므로 로그인 계정(uid 존재)이면 토큰 없이도
  // 호출을 허용한다 — 파트너/기사 가입 계정의 승객 호출이 연동 모달로 튀지
  // 않게 한다. 메인넷은 아래에서 토큰을 그대로 fail-closed 검증한다.
  const sandboxSession = sandbox
  if (!sandboxSession) {
    if (!piToken) {
      return NextResponse.json({ error: 'Pi 계정 연동 및 로그인 후 이용해 주세요.' }, { status: 401 })
    }
    // 토큰은 결정된 네트워크의 /v2/me로 검증한다 — 테스트넷 토큰을 메인넷으로
    // 검증하면 정상 토큰도 거절돼 테스트 도메인 로그인이 "세션 끊김"으로 깨진다.
    const inspection = await inspectPiAccessToken(piToken, sandbox)
    const verifiedUid = inspection.status === 'ok' ? inspection.uid : null
    // 테스트넷은 플랫폼 /v2/me가 미구현·불안정할 수 있으므로 sandbox에서는
    // 판정 불가(unreachable)를 통과시킨다. 명시적 거절(invalid)은 그대로 차단.
    // 메인넷은 기존과 동일하게 fail-closed.
    const allowed = verifiedUid === piUid || (sandbox && inspection.status === 'unreachable')
    if (!allowed) {
      return NextResponse.json({ error: 'Pi 인증이 만료되었거나 확인되지 않았습니다. 다시 로그인해 주세요.' }, { status: 401 })
    }
    // 메인넷 KYC 강제 — wallet_address 스코프는 KYC·메인넷 이전을 마친 계정에만
    // 부여된다. 미부여 토큰은 재로그인(새 스코프 동의)으로 해소된다.
    // (이 블록은 !sandbox일 때만 실행된다.)
    if (!inspection.scopes.includes('wallet_address')) {
      return NextResponse.json(
        { error: 'Pi KYC 인증이 완료된 계정만 이용할 수 있습니다. 다시 로그인해 주세요.', kycRequired: true },
        { status: 403 },
      )
    }
  }
  // 이용 정지(Lock) 계정은 호출을 만들 수 없다.
  if (await isUserLocked(piUid).catch(() => false)) {
    return NextResponse.json({ error: '관리자에 의해 이용이 정지된 계정입니다.' }, { status: 403 })
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
  // 승객이 고른 기사 응답 대기 시간 — 5분/10분 선택지만 허용한다.
  const waitMinutesRaw = Number(body?.waitMinutes)
  const waitMinutes = waitMinutesRaw === 5 || waitMinutesRaw === 10 ? waitMinutesRaw : null
  const waypoints = (Array.isArray(body?.waypoints) ? (body.waypoints as Record<string, unknown>[]) : [])
    .slice(0, 2)
    .map((wp) => asPoint(wp?.lat, wp?.lng, { address: wp?.address, label: wp?.label }))
    .filter((wp): wp is NonNullable<typeof wp> => wp !== null)
  // 경유지별 우회량을 판별한다: 직행 경로 위(우회 <= epsilon)의 경유지는 추가 요금 0,
  // 우회 경유지는 추가되는 거리·시간에 비례해 surcharge를 붙인다.
  const fareQuote = waypointRouteQuote(pickup, dest, waypoints)
  const config = await getFareConfig()
  const baseQuoted =
    typeof body?.estimatedFare === 'number' && Number.isFinite(body.estimatedFare)
      ? piRound(Math.max(0, body.estimatedFare) + waypointSurchargePi(fareQuote.chargeableDetourKm, config, kind))
      : estimateTaxiFarePi(fareQuote.chargeableKm, config, kind)
  // 시간대별 할증 — 관리자 설정(기본 심야 0~4시 +20%)을 호출 견적에 반영한다.
  const nightRate = timeSurchargeRate(config)
  const quoted = nightRate > 0 ? piRound(baseQuoted * (1 + nightRate)) : baseQuoted
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
  // 유료도로 통행료 — 길찾기 API의 tollFare(원)를 설정 환산율(원/Pi)로 Pi로 변환해
  // 견적에 합산한다. 제공자가 통행료를 주지 않으면(OSRM 폴백 등) 0으로 둔다.
  const tollKrw = routeSummary?.tollFare != null && routeSummary.tollFare > 0 ? routeSummary.tollFare : null
  const tollPi = tollKrw ? tollFareToPi(tollKrw, config) : 0
  if (tollPi > 0) console.log('[dispatch] toll fare added to quote', { tollKrw, tollPi })
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
  const passengerPhone = typeof body?.passengerPhone === 'string' ? body.passengerPhone.trim().slice(0, 20) : ''
  const ride = createRideAndMatch({
    id: crypto.randomUUID(),
    kind,
    passengerId,
    passengerUid: piUid,
    passengerPhone: passengerPhone || undefined,
    pickup,
    waypoints,
    dest,
    estimatedFare: piRound(quoted + avoidPi + tollPi),
    avoidSurchargePi: avoidPi,
    tollPi,
    tollKrw,
    expectedMinutes,
    waitMinutes,
  })
  // Flush before responding so the pending offer is visible to other
  // serverless instances (the driver's offer poll) immediately.
  await flushDispatchPersist().catch(() => undefined)
  return NextResponse.json({ ok: true, ride: toPublicRide(ride) })
}
