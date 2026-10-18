import { NextResponse } from 'next/server'
import { altPayEligibility, listAltPayRecords } from '@/lib/altpay-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 이용자의 타 결제 수단 자격(실패 누적) + 본인 완료 내역 조회. */
export async function GET(request: Request) {
  const uid = new URL(request.url).searchParams.get('uid')?.trim() || ''
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 })
  const [eligibility, records] = await Promise.all([altPayEligibility(uid), listAltPayRecords({ userId: uid })])
  return NextResponse.json({ ok: true, eligibility, records })
}
