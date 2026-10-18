import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { listPushLog, subscribedOwnerIds } from '@/lib/push-store'
import { getVapidPublicKey } from '@/lib/driver-push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 푸시 발송 모니터링 — 최근 발송 로그와 구독 현황.
 * GET ?limit= (기본 100, 최대 300)
 */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const limitParam = Number(new URL(request.url).searchParams.get('limit') || '100')
  const limit = Number.isFinite(limitParam) ? limitParam : 100
  const [entries, driverSubs, userSubs] = await Promise.all([
    listPushLog(limit),
    subscribedOwnerIds('driver').catch(() => [] as string[]),
    subscribedOwnerIds('user').catch(() => [] as string[]),
  ])
  return NextResponse.json({
    ok: true,
    entries,
    stats: {
      driverSubscriptions: driverSubs.length,
      userSubscriptions: userSubs.length,
      vapidConfigured: Boolean(getVapidPublicKey()),
      smsFallback: process.env.PUSH_SMS_FALLBACK === '1',
    },
  })
}
