import { after, NextResponse } from 'next/server'
import { deletePartnerLink, getPartnerLink, upsertPartnerLink } from '@/lib/partner-ledger-server'
import { findLockedUser, getRegistryUser, upsertRegistryUser } from '@/lib/user-registry'
import { piRound } from '@/lib/pi-format'
import { inspectPiAccessToken } from '@/lib/pi-platform'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'
import { removeDriverPushSubscription } from '@/lib/driver-push'
import { recordAudit } from '@/lib/audit-store'
import { normalizeVehicleTiers } from '@/lib/ride-tiers'
import { normalizeDeliveryVehicles, normalizeServiceRoles } from '@/lib/partner-services'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    uid?: unknown
    username?: unknown
    wallet?: unknown
    role?: unknown
    name?: unknown
    phone?: unknown
    detail?: unknown
    vehicle?: unknown
    plate?: unknown
    region?: unknown
    serviceType?: unknown
    serviceRoles?: unknown
    deliveryVehicles?: unknown
    vehicleTiers?: unknown
    insuranceCompany?: unknown
    insurancePolicyNo?: unknown
    insuranceExpiresAt?: unknown
    insuranceDocName?: unknown
    insuranceDocAt?: unknown
    linkedAt?: unknown
    accessToken?: unknown
  } | null
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const wallet = typeof body?.wallet === 'string' ? body.wallet.trim() : ''
  if (!uid || !wallet) {
    return NextResponse.json({ error: 'uid and wallet required' }, { status: 400 })
  }
  // 가입·동기화 인증 — 메인넷은 KYC 완료 계정(wallet_address 스코프)만
  // 기사/파트너로 등록할 수 있다(fail-closed). 테스트넷은 /api/rides와
  // 동일하게 uid 존재만으로 통과시킨다 — 오래된 개발 토큰 때문에
  // 가입·호출·매칭 테스트가 인증 오류로 막히지 않게 한다.
  const sandbox = isPiSandboxRequest(request)
  if (!sandbox) {
    const token =
      request.headers.get('x-pi-access-token')?.trim() ||
      (typeof body?.accessToken === 'string' ? body.accessToken.trim() : '')
    if (!token) {
      return NextResponse.json({ error: 'Pi 계정 연동 및 로그인 후 이용해 주세요.' }, { status: 401 })
    }
    const inspection = await inspectPiAccessToken(token, sandbox)
    if (inspection.status !== 'ok' || inspection.uid !== uid) {
      return NextResponse.json(
        { error: 'Pi 인증이 만료되었거나 확인되지 않았습니다. 다시 로그인해 주세요.' },
        { status: 401 },
      )
    }
    if (!inspection.scopes.includes('wallet_address')) {
      return NextResponse.json(
        { error: 'Pi KYC 인증이 완료된 계정만 기사·파트너로 등록할 수 있습니다.', kycRequired: true },
        { status: 403 },
      )
    }
  }
  // 이용 정지(Lock) 계정은 연동·로그인 동기화 자체를 차단한다.
  const locked = await findLockedUser(uid, wallet).catch(() => null)
  if (locked) {
    return NextResponse.json(
      { error: '관리자에 의해 이용이 정지된 계정입니다.', locked: true, lockReason: locked.lockReason || undefined },
      { status: 403 },
    )
  }
  const previous = getPartnerLink(uid)
  const text = (value: unknown, fallback?: string) => (typeof value === 'string' ? value.trim() : fallback)
  // 역할 상호배타 — 하나의 계정(uid)은 기사·파트너 중 한 가지 역할만 가진다.
  // 이미 다른 역할로 등록된 uid가 반대 역할로 등록·동기화를 시도하면 차단한다.
  const incomingRole = text(body?.role)
  if (previous?.role && incomingRole && previous.role !== incomingRole) {
    return NextResponse.json(
      { error: `이미 ${previous.role}(으)로 등록된 계정입니다. 기사와 파트너 역할은 중복으로 가질 수 없습니다.` },
      { status: 409 },
    )
  }
  const record = upsertPartnerLink({
    uid,
    username: username || uid,
    wallet,
    role: text(body?.role, previous?.role),
    name: text(body?.name, previous?.name),
    phone: text(body?.phone, previous?.phone),
    detail: text(body?.detail, previous?.detail),
    vehicle: text(body?.vehicle, previous?.vehicle),
    plate: text(body?.plate, previous?.plate),
    region: text(body?.region, previous?.region),
    serviceType: text(body?.serviceType, previous?.serviceType),
    // 겸직·체급·차량 등급은 배열 필드 — 클라이언트가 명시적으로 보냈을 때만 교체하고,
    // 미전송(구형 클라이언트)이면 이전 등록값을 보존한다.
    serviceRoles:
      body?.serviceRoles !== undefined
        ? normalizeServiceRoles(body.serviceRoles, text(body?.serviceType, previous?.serviceType))
        : previous?.serviceRoles,
    deliveryVehicles: body?.deliveryVehicles !== undefined ? normalizeDeliveryVehicles(body.deliveryVehicles) : previous?.deliveryVehicles,
    vehicleTiers:
      body?.vehicleTiers !== undefined ? normalizeVehicleTiers(body.vehicleTiers) : normalizeVehicleTiers(previous?.vehicleTiers),
    insuranceCompany: text(body?.insuranceCompany, previous?.insuranceCompany),
    insurancePolicyNo: text(body?.insurancePolicyNo, previous?.insurancePolicyNo),
    insuranceExpiresAt: text(body?.insuranceExpiresAt, previous?.insuranceExpiresAt),
    insuranceDocName: text(body?.insuranceDocName, previous?.insuranceDocName),
    insuranceDocAt: text(body?.insuranceDocAt, previous?.insuranceDocAt),
    linkedAt: typeof body?.linkedAt === 'string' ? body.linkedAt : previous?.linkedAt || new Date().toISOString(),
  })
  // 영속 가입자 레지스트리에도 반영 — 관리자 가입자 목록·통계의 데이터 소스.
  await upsertRegistryUser(record).catch((error) => {
    console.error('[users] registry upsert failed', { uid, error })
  })
  return NextResponse.json({ ok: true, profile: record })
}

export async function DELETE(request: Request) {
  const startedAt = Date.now()
  try {
    const body = (await request.json().catch(() => null)) as {
      uid?: unknown
      wallet?: unknown
      accessToken?: unknown
    } | null
    const fromBody = typeof body?.uid === 'string' ? body.uid.trim() : ''
    const uid = fromBody || new URL(request.url).searchParams.get('uid')?.trim() || ''
    const sandbox = isPiSandboxRequest(request)
    const headerToken = request.headers.get('x-pi-access-token')?.trim() || ''
    const bodyToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : ''
    // 진입 로그 — 클라이언트에서 '처리 중'에 멈춘다는 보고가 있을 때 요청이
    // 라우트까지 도달했는지부터 확인할 수 있게 수신 파라미터를 기록한다.
    console.log('[Withdraw] request received', {
      uid: uid || '(missing)',
      hasWallet: Boolean(typeof body?.wallet === 'string' && body.wallet.trim()),
      hasHeaderToken: Boolean(headerToken),
      hasBodyToken: Boolean(bodyToken),
      sandbox,
      contentType: request.headers.get('content-type') || '(none)',
    })
    if (!uid) return NextResponse.json({ success: false, error: 'uid required' }, { status: 400 })
    // 1. 인증 — 탈퇴 요청자가 해당 Pi uid 소유자인지 확인한다. 토큰 없는 호출로
    // 타인 계정을 해제할 수 없게 막는다. /api/rides와 같은 정책:
    // 메인넷은 fail-closed, 테스트넷은 /v2/me 판정 불가(unreachable)만 통과.
    const sandboxSession = sandbox && uid === 'sandbox-uid-taxitago'
    if (!sandboxSession) {
      const token = headerToken || bodyToken
      if (!token) {
        console.warn('[Withdraw] rejected: no access token', { uid })
        return NextResponse.json(
          { success: false, error: 'Pi 계정 인증이 필요합니다. 다시 로그인해 주세요.' },
          { status: 401 },
        )
      }
      const inspection = await inspectPiAccessToken(token, sandbox)
      const verifiedUid = inspection.status === 'ok' ? inspection.uid : null
      const allowed = verifiedUid === uid || (sandbox && inspection.status === 'unreachable')
      console.log('[Withdraw] token inspection', { uid, status: inspection.status, verifiedUid, allowed })
      if (!allowed) {
        return NextResponse.json(
          { success: false, error: 'Pi 인증이 만료되었거나 확인되지 않았습니다. 다시 로그인해 주세요.' },
          { status: 401 },
        )
      }
    }
    const wallet =
      (typeof body?.wallet === 'string' ? body.wallet.trim() : '') ||
      getPartnerLink(uid)?.wallet?.trim() ||
      ''

    // 2. 계정 연동 해제가 응답의 유일한 전제 조건 — 메모리 Map 삭제라 즉시 끝난다.
    const link = getPartnerLink(uid)
    deletePartnerLink(uid)
    console.log('[Withdraw] account unlinked', { uid, wallet: wallet || '(none)', elapsedMs: Date.now() - startedAt })

    // 3. 느린 정리 작업(크레딧 파기·레지스트리·기사 상태·감사 로그)은 응답 이후
    // 백그라운드로 — KV 장애·지연이 탈퇴 응답을 붙잡아 클라이언트가 '처리 중'에
    // 멈추는 것을 막는다. 각 단계는 실패해도 로그만 남기고 넘어간다.
    after(async () => {
      // 잔액은 탈퇴를 막지 않는다 — 사전 충전 폐지로 앱 잔액은 결제 수단이
      // 아니며, 남은 크레딧은 archiveUserCredits가 withdrawnAt으로 파기한다.
      // 잔액 조회는 감사 로그의 '최종 잔액' 기록용으로만 쓰는 비차단 조회다.
      const { userSpendableBalance, archiveUserCredits } = await import('@/lib/user-credit-store')
      const remaining = await userSpendableBalance(wallet, uid).catch(() => 0)
      await archiveUserCredits({ uid, wallet }).catch((error) => {
        console.error('[Withdraw] credit archive failed', { uid, error })
      })
      // 가입자 레지스트리도 탈퇴 처리 — 프로필·서비스 필드를 지워 재가입 시
      // 옛 정보(역할·차량·보험 등)가 되살아나지 않게 하고 withdrawnAt만 남긴다.
      const { markRegistryUserWithdrawn } = await import('@/lib/user-registry')
      await markRegistryUserWithdrawn(uid).catch((error) => {
        console.error('[Withdraw] registry withdraw mark failed', { uid, error })
      })
      // 기사 활성 상태 정리 — 탈퇴한 기사가 온라인으로 남아 콜을 받지 않게
      // 오프라인 처리하고 콜 알림용 푸시 구독을 해제한다.
      try {
        const { getDriver, nowIso, saveDriver } = await import('@/lib/dispatch-store')
        const driver = getDriver(uid)
        if (driver && driver.status !== 'offline' && !driver.virtual) {
          saveDriver({ ...driver, status: 'offline', lastSeenAt: nowIso() })
        }
        removeDriverPushSubscription(uid)
      } catch (error) {
        console.error('[Withdraw] driver state cleanup failed', { uid, error })
      }
      // 탈퇴 감사 로그 — 정산 장부·운행 이력은 그대로 남기고, 어뷰징 추적용
      // 최소 식별 이력(uid·지갑·탈퇴 시점)을 관리자 감사에 기록한다.
      await recordAudit({
        kind: 'partner',
        actor: uid,
        actorName: link?.name || link?.username,
        refId: uid,
        reason: '회원 탈퇴',
        detail: `wallet ${wallet || '(없음)'} · 최종 잔액 ${piRound(remaining)} Pi`,
        after: { uid, wallet, role: link?.role },
      }).catch((error) => console.error('[Withdraw] audit log failed', { uid, error }))
      console.log('[Withdraw] cleanup done', { uid })
    })

    return NextResponse.json({ ok: true, success: true })
  } catch (error) {
    // 어떤 예외도 JSON 응답으로 변환한다 — Next 기본 에러 페이지(HTML)가
    // 내려가면 클라이언트 json() 파싱이 실패해 '처리 중'이 풀리지 않는다.
    // 스택까지 강제 출력해 서버 로그에서 멈춤 지점을 바로 찾을 수 있게 한다.
    console.error('[Withdraw] unhandled error', {
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { success: false, error: '회원 탈퇴 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    )
  }
}

export async function GET(request: Request) {
  const uid = new URL(request.url).searchParams.get('uid')?.trim() || ''
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 })
  const profile = getPartnerLink(uid)
  const registered = await getRegistryUser(uid).catch(() => null)
  if (!profile && !registered) return NextResponse.json({ ok: false, profile: null }, { status: 404 })
  return NextResponse.json({
    ok: true,
    profile: profile ?? registered,
    // Lock 상태는 로그인 시점 게이트가 확인한다 — 민감 정보가 아닌 이용 가능 플래그.
    locked: Boolean(registered?.lockedAt),
    lockReason: registered?.lockReason || undefined,
  })
}
