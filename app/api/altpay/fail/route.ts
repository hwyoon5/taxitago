import { NextResponse } from 'next/server'
import { recordAltPayFail } from '@/lib/altpay-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Pi 결제 실패 신고 — 사유를 '잔액 부족'/'통신·기타 오류'로 분류해 적재하고
 * 타 결제 수단 완료 자격(잔액 부족 1회 또는 오류 2회)을 돌려준다.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const eligibility = await recordAltPayFail({
    userId,
    service: typeof body?.service === 'string' ? body.service : '',
    refId: typeof body?.refId === 'string' ? body.refId : '',
    amount: typeof body?.amount === 'number' ? body.amount : null,
    reason: typeof body?.reason === 'string' ? body.reason : '',
    detail: typeof body?.detail === 'string' ? body.detail : '',
  })
  return NextResponse.json({ ok: true, eligibility })
}
