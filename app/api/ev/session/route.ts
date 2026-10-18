import { NextResponse } from 'next/server'
import { createEvSession } from '@/lib/ev-charge-engine'
import { listEvSessions, syncEvChargeFromDisk } from '@/lib/ev-charge-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * EV 충전 세션 개시 — 예치금(선결제) 금액은 서버가 요금 설정과 충전기 단가로
 * 계산해 세션에 고정한다. 실제 잠금은 Pi 결제가 /api/pi/complete에서
 * 서버 검증을 통과할 때 일어난다(kind 'ev-deposit').
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const result = await createEvSession({
    userId: typeof body?.userId === 'string' ? body.userId : '',
    userUid: typeof body?.userUid === 'string' ? body.userUid : undefined,
    userWallet: typeof body?.userWallet === 'string' ? body.userWallet : undefined,
    userPhone: typeof body?.userPhone === 'string' ? body.userPhone : undefined,
    chargerId: typeof body?.chargerId === 'string' ? body.chargerId : '',
    chargerName: typeof body?.chargerName === 'string' ? body.chargerName : '',
    powerKw: typeof body?.powerKw === 'number' && Number.isFinite(body.powerKw) ? body.powerKw : undefined,
    providerId: typeof body?.providerId === 'string' ? body.providerId : undefined,
    providerName: typeof body?.providerName === 'string' ? body.providerName : undefined,
    perKwhPi: typeof body?.perKwhPi === 'number' && Number.isFinite(body.perKwhPi) ? body.perKwhPi : undefined,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, session: result.session, deduped: result.deduped === true })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const userId = (searchParams.get('userId') || '').trim()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  syncEvChargeFromDisk()
  return NextResponse.json({ sessions: listEvSessions(userId).slice(0, 50) })
}
