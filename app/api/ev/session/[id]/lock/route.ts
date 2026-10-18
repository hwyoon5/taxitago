import { NextResponse } from 'next/server'
import { lockEvSession } from '@/lib/ev-charge-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 예치금 잠금 — 클라이언트 결제 완료 직후의 명시적 잠금 요청.
 * txid는 payment-kind 레지스트리에서 서버 검증된 결제만 인정한다
 * (/api/pi/complete의 서버 후킹과 같은 검증).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { userId?: string; paymentId?: string; txid?: string } | null
  const result = await lockEvSession(id, { paymentId: body?.paymentId, txid: body?.txid })
  if (!result.ok) {
    return NextResponse.json({ error: result.error, session: result.session }, { status: result.error === 'not_found' ? 404 : 409 })
  }
  return NextResponse.json({ ok: true, session: result.session })
}
