import { NextResponse } from 'next/server'
import { syncPartnerFeeds } from '@/lib/partner-feed'
import { isAdminRequest } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 파트너 피드 수동 동기화 트리거 — 관리자(x-admin-key) 또는
 * DEVICE_INGEST_TOKEN(x-device-key, 외부 크론 호출용)으로만 실행한다.
 * 일반 자동 동기화는 GET /api/devices의 stale 검사가 after()로 처리한다.
 */
export async function POST(request: Request) {
  const ingestToken = (process.env.DEVICE_INGEST_TOKEN || '').trim()
  const deviceKey = (request.headers.get('x-device-key') || '').trim()
  const admin = await isAdminRequest(request).catch(() => false)
  if (!admin && !(ingestToken && deviceKey === ingestToken)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const summary = await syncPartnerFeeds().catch((error) => {
    console.error('[PartnerFeed] manual sync failed', error)
    return null
  })
  if (!summary) {
    return NextResponse.json({ ok: false, error: 'sync_failed' }, { status: 500 })
  }
  return NextResponse.json({ ...summary, ok: true })
}
