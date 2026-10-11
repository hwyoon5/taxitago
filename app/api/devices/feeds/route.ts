import { NextResponse } from 'next/server'
import {
  listPartnerFeeds,
  listPartnerFeedsByOwner,
  removePartnerFeed,
  upsertPartnerFeed,
  type PartnerFeedSource,
} from '@/lib/partner-source-store'
import { removeExternalDevices } from '@/lib/device-store'
import { isAdminRequest } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 응답에서 인증 키는 제외한다. */
function publicFeed(feed: PartnerFeedSource) {
  const { apiKey, ...rest } = feed
  return { ...rest, hasApiKey: Boolean(apiKey) }
}

/**
 * 외부 파트너 기기 피드 소스 관리.
 * GET  ?uid=<partnerUid> → 해당 파트너의 소스 목록 / 관리자(x-admin-key)는 전체
 * POST { name, endpointUrl, apiKey?, ownerUid } → 소스 등록·갱신
 * DELETE { id, ownerUid } → 소유자 또는 관리자 삭제 (연동 기기도 함께 정리)
 */
export async function GET(request: Request) {
  const uid = new URL(request.url).searchParams.get('uid')?.trim() || ''
  const feeds = await (uid ? listPartnerFeedsByOwner(uid) : isAdminRequest(request).then((admin) => (admin ? listPartnerFeeds() : [])))
  return NextResponse.json({ ok: true, feeds: feeds.map(publicFeed), count: feeds.length })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    name?: unknown
    endpointUrl?: unknown
    apiKey?: unknown
    ownerUid?: unknown
    enabled?: unknown
  } | null
  const feed = await upsertPartnerFeed({
    name: typeof body?.name === 'string' ? body.name : '',
    endpointUrl: typeof body?.endpointUrl === 'string' ? body.endpointUrl : '',
    apiKey: typeof body?.apiKey === 'string' ? body.apiKey : '',
    ownerUid: typeof body?.ownerUid === 'string' ? body.ownerUid : '',
    enabled: typeof body?.enabled === 'boolean' ? body.enabled : undefined,
  })
  if (!feed) {
    return NextResponse.json({ error: 'invalid_fields', message: '상호명·엔드포인트 URL(http/https)·파트너 UID가 필요합니다.' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, feed: publicFeed(feed) })
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: unknown; ownerUid?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  const admin = await isAdminRequest(request).catch(() => false)
  const removed = await removePartnerFeed(id, typeof body?.ownerUid === 'string' ? body.ownerUid : '', admin)
  if (!removed) {
    return NextResponse.json({ error: 'not_found_or_forbidden' }, { status: 404 })
  }
  // 소스가 사라지면 그 소스가 주입한 외부 기기도 함께 정리한다.
  const devicesRemoved = await removeExternalDevices(id).catch(() => 0)
  return NextResponse.json({ ok: true, devicesRemoved })
}
