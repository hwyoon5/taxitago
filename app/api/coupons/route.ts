import { NextResponse } from 'next/server'
import { previewCoupon } from '@/lib/coupon-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 쿠폰 미리보기 — 결제 화면이 코드 유효성과 할인액을 조회한다.
 * 실제 사용 기록은 결제 차감 시점(/api/wallet/spend)에만 남는다.
 * GET /api/coupons?code=…&uid=…&amount=…
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = (url.searchParams.get('code') || '').trim()
  const uid = (url.searchParams.get('uid') || '').trim()
  const amount = Number(url.searchParams.get('amount'))
  if (!code || !uid) {
    return NextResponse.json({ ok: false, error: 'invalid_params' }, { status: 400 })
  }
  const result = await previewCoupon(code, uid, Number.isFinite(amount) ? amount : 0)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error })
  }
  return NextResponse.json({
    ok: true,
    coupon: {
      code: result.coupon.code,
      title: result.coupon.title,
      kind: result.coupon.kind,
      value: result.coupon.value,
    },
    discount: result.discount,
    payable: result.payable,
  })
}
