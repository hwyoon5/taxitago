import { NextResponse } from 'next/server'
import { settleEvSession } from '@/lib/ev-charge-engine'
import { getEvSession, syncEvChargeFromDisk } from '@/lib/ev-charge-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 충전 종료·정산 — CPO 서버가 이미 보고한 실측 kWh가 있으면 그 값이 우선하고,
 * 없으면 요청의 kWh(수동 입력), 그래도 없으면 충전기 출력×경과시간 추정으로
 * 확정한다. 확정 요금과 예치금의 차액은 이 경로에서 자동 환불된다.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { userId?: string; kwh?: unknown } | null
  syncEvChargeFromDisk()
  const session = getEvSession(id)
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  if (!userId || session.userId !== userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const result = await settleEvSession(id, { kwh: Number(body?.kwh), endedBy: 'user' })
  if (!result.ok) {
    return NextResponse.json({ error: result.error, session: result.session }, { status: 409 })
  }
  return NextResponse.json({ ok: true, session: result.session, duplicate: result.duplicate === true })
}
