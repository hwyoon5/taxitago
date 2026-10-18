import { NextResponse } from 'next/server'
import { cancelEvSession } from '@/lib/ev-charge-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 세션 취소 — 예치금 잠금 전이면 자금 이동 없이 종료, 잠금 후 미충전이면
 * 예치금 전액을 이용자에게 환불한다. 실측 충전량이 잡힌 세션은 정산 경로로 보낸다.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { userId?: string } | null
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const result = await cancelEvSession(id, userId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'not_found' ? 404 : 403 })
  }
  return NextResponse.json({ ok: true, session: result.session, duplicate: result.duplicate === true })
}
