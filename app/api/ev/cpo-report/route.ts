import { NextResponse } from 'next/server'
import { reportEvMeter, settleEvSession } from '@/lib/ev-charge-engine'
import { adminActor } from '@/lib/admin-auth'
import { isPiSandboxEnv } from '@/lib/pi-sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * CPO(충전 사업자) 서버의 실측 충전량 보고 — 충전기 계량 데이터를 세션에
 * 기록하고, `end: true`이면 그 실측치로 즉시 정산·차액 환불을 실행한다.
 *
 * 인증: `EV_CPO_API_KEY` env와 일치하는 `x-cpo-key` 헤더, 또는 관리자 키.
 * 둘 다 설정돼 있지 않은 경우 테스트넷에서만 개발 편의로 열어두고
 * 메인넷에서는 반드시 닫는다.
 */
export async function POST(request: Request) {
  const cpoKey = (process.env.EV_CPO_API_KEY || '').trim()
  const given = (request.headers.get('x-cpo-key') || '').trim()
  const admin = cpoKey ? null : await adminActor(request).catch(() => null)
  const authorized = (cpoKey && given && given === cpoKey) || Boolean(admin)
  if (!authorized && !(isPiSandboxEnv() && !cpoKey)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string
    chargerId?: string
    kwh?: unknown
    end?: unknown
  } | null
  const sessionId = (body?.sessionId || '').trim()
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  const reported = reportEvMeter(sessionId, { kwh: Number(body?.kwh), source: 'cpo' })
  if (!reported.ok) {
    return NextResponse.json({ error: reported.error }, { status: reported.error === 'not_found' ? 404 : 409 })
  }
  if (body?.end === true) {
    const settled = await settleEvSession(sessionId, { endedBy: 'cpo' })
    if (!settled.ok) {
      return NextResponse.json({ error: settled.error, session: settled.session }, { status: 409 })
    }
    return NextResponse.json({ ok: true, session: settled.session, duplicate: settled.duplicate === true })
  }
  return NextResponse.json({ ok: true, session: reported.session })
}
