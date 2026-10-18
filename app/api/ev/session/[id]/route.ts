import { NextResponse } from 'next/server'
import { getEvSession, syncEvChargeFromDisk } from '@/lib/ev-charge-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 세션 상태 조회 — 예치 잠금·실측 충전량·정산/환불 결과를 이용자가 폴링한다. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  syncEvChargeFromDisk()
  const session = getEvSession(id)
  if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { searchParams } = new URL(request.url)
  const userId = (searchParams.get('userId') || '').trim()
  if (userId && session.userId !== userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return NextResponse.json({ session })
}
