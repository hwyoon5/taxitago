import { NextResponse } from 'next/server'
import { deletePartnerLink, getPartnerLink, upsertPartnerLink } from '@/lib/partner-ledger-server'
import { piRound } from '@/lib/pi-format'
import { inspectPiAccessToken } from '@/lib/pi-platform'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'

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
    insuranceCompany?: unknown
    insurancePolicyNo?: unknown
    insuranceExpiresAt?: unknown
    insuranceDocName?: unknown
    insuranceDocAt?: unknown
    linkedAt?: unknown
  } | null
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const wallet = typeof body?.wallet === 'string' ? body.wallet.trim() : ''
  if (!uid || !wallet) {
    return NextResponse.json({ error: 'uid and wallet required' }, { status: 400 })
  }
  const previous = getPartnerLink(uid)
  const text = (value: unknown, fallback?: string) => (typeof value === 'string' ? value.trim() : fallback)
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
    insuranceCompany: text(body?.insuranceCompany, previous?.insuranceCompany),
    insurancePolicyNo: text(body?.insurancePolicyNo, previous?.insurancePolicyNo),
    insuranceExpiresAt: text(body?.insuranceExpiresAt, previous?.insuranceExpiresAt),
    insuranceDocName: text(body?.insuranceDocName, previous?.insuranceDocName),
    insuranceDocAt: text(body?.insuranceDocAt, previous?.insuranceDocAt),
    linkedAt: typeof body?.linkedAt === 'string' ? body.linkedAt : previous?.linkedAt || new Date().toISOString(),
  })
  return NextResponse.json({ ok: true, profile: record })
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    uid?: unknown
    wallet?: unknown
    accessToken?: unknown
  } | null
  const fromBody = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const uid = fromBody || new URL(request.url).searchParams.get('uid')?.trim() || ''
  if (!uid) return NextResponse.json({ success: false, error: 'uid required' }, { status: 400 })
  // 1. 인증 — 탈퇴 요청자가 해당 Pi uid 소유자인지 확인한다. 토큰 없는 호출로
  // 잔액 0인 타인 계정을 해제할 수 없게 막는다. /api/rides와 같은 정책:
  // 메인넷은 fail-closed, 테스트넷은 /v2/me 판정 불가(unreachable)만 통과.
  const sandbox = isPiSandboxRequest(request)
  const sandboxSession = sandbox && uid === 'sandbox-uid-taxitago'
  if (!sandboxSession) {
    const token =
      request.headers.get('x-pi-access-token')?.trim() ||
      (typeof body?.accessToken === 'string' ? body.accessToken.trim() : '')
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Pi 계정 인증이 필요합니다. 다시 로그인해 주세요.' },
        { status: 401 },
      )
    }
    const inspection = await inspectPiAccessToken(token, sandbox)
    const verifiedUid = inspection.status === 'ok' ? inspection.uid : null
    const allowed = verifiedUid === uid || (sandbox && inspection.status === 'unreachable')
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'Pi 인증이 만료되었거나 확인되지 않았습니다. 다시 로그인해 주세요.' },
        { status: 401 },
      )
    }
  }
  // 2. 보유 파이 잔액이 남아 있으면 탈퇴를 원천 차단 — 잔액 출금·소진 후에만
  // 계정 해제를 진행한다. 잔액은 서버 장부의 uid/지갑 귀속 크레딧 롤업이 권위.
  const wallet =
    (typeof body?.wallet === 'string' ? body.wallet.trim() : '') ||
    getPartnerLink(uid)?.wallet?.trim() ||
    ''
  const { userCreditTotals } = await import('@/lib/user-credit-store')
  // 잔액을 확인할 수 없으면 탈퇴 자체를 중단한다(fail-closed) — 조회 오류를
  // 우회 수단으로 쓸 수 없게 하고, 인프라 장애 시엔 재시도를 요청한다.
  let remaining = 0
  try {
    const totals = await userCreditTotals(wallet, uid)
    // 비정상 값(NaN·undefined) 안전 장치 — 숫자로 정규화해 0 이하만 통과시킨다.
    remaining = Number(totals.total) || 0
  } catch (error) {
    console.error('[Withdraw] balance lookup failed; withdrawal blocked', { uid, error })
    return NextResponse.json(
      { success: false, error: '보유 잔액을 확인하지 못해 탈퇴를 진행할 수 없습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    )
  }
  if (remaining > 0) {
    console.warn('[Withdraw] blocked: remaining balance', { uid, total: remaining })
    return NextResponse.json(
      {
        success: false,
        error: `보유 중인 파이 잔액(${piRound(remaining)} Pi)이 남아있어 탈퇴할 수 없습니다. 잔액을 모두 출금하거나 소진한 후 다시 시도해 주세요.`,
      },
      { status: 400 },
    )
  }
  deletePartnerLink(uid)
  return NextResponse.json({ ok: true, success: true })
}

export async function GET(request: Request) {
  const uid = new URL(request.url).searchParams.get('uid')?.trim() || ''
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 })
  const profile = getPartnerLink(uid)
  if (!profile) return NextResponse.json({ ok: false, profile: null }, { status: 404 })
  return NextResponse.json({ ok: true, profile })
}
