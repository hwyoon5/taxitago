import { NextResponse } from 'next/server'
import { activateTripLeg, syncTrip } from '@/lib/trip-planner'
import { hydrateDispatchFromKv } from '@/lib/dispatch-store'
import { hydrateEscrowFromKv } from '@/lib/escrow-store'
import { isUserLocked } from '@/lib/user-registry'
import { fdsBlockStatus, recordFdsSignal } from '@/lib/fds-store'
import { inspectPiAccessToken } from '@/lib/pi-platform'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/trips/[id]/activate — 여정의 planned 다리를 실제 서비스 레코드로
 * 실행한다(택시 호출·EV 예약·택배 등록). body: { leg? } — 특정 다리만 실행.
 * 에스크로 잠금·예치금·정산은 각 서비스 라이프사이클이 그대로 처리하고,
 * 여정은 refId로 상태 전이를 추적한다.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const ownerId =
    request.headers.get('x-pi-uid')?.trim() ||
    (typeof body?.ownerId === 'string' ? body.ownerId.trim() : '')
  if (!ownerId) {
    return NextResponse.json({ error: 'Pi 계정 연동 및 로그인 후 이용해 주세요.' }, { status: 401 })
  }
  // 실행은 실제 호출·예약·등록을 만들므로 /api/rides와 동일하게 메인넷은
  // 토큰 소유자 검증 + KYC 스코프를 요구한다(테스트넷은 uid만으로 통과).
  if (!isPiSandboxRequest(request)) {
    const piToken =
      request.headers.get('x-pi-access-token')?.trim() ||
      (typeof body?.piAccessToken === 'string' ? body.piAccessToken.trim() : '')
    if (!piToken) {
      return NextResponse.json({ error: 'Pi 계정 연동 및 로그인 후 이용해 주세요.' }, { status: 401 })
    }
    const inspection = await inspectPiAccessToken(piToken, false)
    if (inspection.status !== 'ok' || inspection.uid !== ownerId) {
      return NextResponse.json({ error: 'Pi 인증이 만료되었거나 확인되지 않았습니다. 다시 로그인해 주세요.' }, { status: 401 })
    }
    if (!inspection.scopes.includes('wallet_address')) {
      return NextResponse.json(
        { error: 'Pi KYC 인증이 완료된 계정만 이용할 수 있습니다. 다시 로그인해 주세요.', kycRequired: true },
        { status: 403 },
      )
    }
  }
  // 라이드 생성과 동일한 보호 게이트 — 정지 계정·FDS 차단은 실행을 막는다.
  if (await isUserLocked(ownerId).catch(() => false)) {
    return NextResponse.json({ error: '관리자에 의해 이용이 정지된 계정입니다.' }, { status: 403 })
  }
  const fds = await fdsBlockStatus(ownerId).catch(() => null)
  if (fds?.blocked) {
    return NextResponse.json(
      { error: '비정상 이용 패턴이 감지되어 일시적으로 제한됐습니다.', fdsBlocked: true, until: fds.until },
      { status: 403 },
    )
  }
  void recordFdsSignal('ride-flood', { actorId: ownerId, detail: `trip:${id}` }).catch(() => undefined)
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv()])
  const legId = typeof body?.leg === 'string' ? body.leg.trim() || null : null
  const result = await activateTripLeg(id, legId, {
    passengerId: ownerId,
    passengerUid: typeof body?.passengerUid === 'string' ? body.passengerUid.trim() : undefined,
    passengerPhone: typeof body?.passengerPhone === 'string' ? body.passengerPhone.trim() : undefined,
  })
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'ride_in_progress' ? 409 : 400
    return NextResponse.json({ error: result.error, trip: result.trip }, { status })
  }
  return NextResponse.json({ ok: true, trip: await syncTrip(result.trip!) })
}
