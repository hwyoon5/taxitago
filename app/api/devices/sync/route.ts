import { NextResponse } from 'next/server'
import { syncPartnerFeeds } from '@/lib/partner-feed'
import { getPartnerFeed } from '@/lib/partner-source-store'
import { isAdminRequest } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 파트너 피드 수동 동기화 트리거.
 * - 관리자(x-admin-key) 또는 DEVICE_INGEST_TOKEN(x-device-key): 전체 또는
 *   body.feedId로 지정한 소스 동기화.
 * - 파트너 본인: body.feedId + ownerUid가 소스 소유자와 일치하면 본인 소스만
 *   동기화 가능.
 * 일반 자동 동기화는 GET /api/devices의 stale 검사가 after()로 처리한다.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { feedId?: unknown; ownerUid?: unknown } | null
  const feedId = typeof body?.feedId === 'string' ? body.feedId.trim() : ''
  const ownerUid = typeof body?.ownerUid === 'string' ? body.ownerUid.trim() : ''

  const ingestToken = (process.env.DEVICE_INGEST_TOKEN || '').trim()
  const deviceKey = (request.headers.get('x-device-key') || '').trim()
  const admin = await isAdminRequest(request).catch(() => false)
  const privileged = admin || Boolean(ingestToken && deviceKey === ingestToken)

  if (!privileged) {
    // 파트너 셀프 동기화 — 본인 소유 소스만 허용한다.
    const feed = feedId ? await getPartnerFeed(feedId).catch(() => null) : null
    if (!feed || feed.ownerUid !== ownerUid || !ownerUid) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }
  if (!feedId && !privileged) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const summary = await syncPartnerFeeds(feedId || undefined).catch((error) => {
    console.error('[PartnerFeed] manual sync failed', error)
    return null
  })
  if (!summary) {
    return NextResponse.json({ ok: false, error: 'sync_failed' }, { status: 500 })
  }
  return NextResponse.json({ ...summary, ok: true })
}
