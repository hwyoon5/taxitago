import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import { sendDriverPush, subscribedDriverIds } from '@/lib/driver-push'
import { BROADCAST_REGION_KEYS, broadcastRegionLabel, type BroadcastRegion } from '@/lib/broadcast-regions'
import {
  createBroadcast,
  deleteBroadcast,
  getBroadcast,
  listBroadcasts,
  updateBroadcast,
  type BroadcastEntry,
  type BroadcastTarget,
} from '@/lib/broadcast-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TARGETS: BroadcastTarget[] = ['all', 'passenger', 'driver', 'partner', 'staff']

function targetLabel(target: BroadcastTarget) {
  return target === 'staff'
    ? '기사·파트너'
    : target === 'driver'
      ? '기사'
      : target === 'partner'
        ? '파트너'
        : target === 'passenger'
          ? '승객'
          : '전체'
}

/** 기사 푸시 구독자에게 방송 알림을 최선형으로 발송 — 실패해도 공지 등록은 성공시킨다. */
async function pushToDrivers(entry: BroadcastEntry) {
  if (entry.target === 'passenger' || entry.target === 'partner') return
  const ids = subscribedDriverIds()
  await Promise.all(
    ids.map((driverId) =>
      sendDriverPush(driverId, {
        title: `공지 · ${entry.title}`,
        body: entry.body.slice(0, 120),
        tag: `broadcast-${entry.id}`,
        url: '/',
        rideId: '',
      }).catch(() => undefined),
    ),
  )
}

export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const broadcasts = await listBroadcasts()
  return NextResponse.json({ ok: true, broadcasts })
}

export async function POST(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 80) : ''
  const text = typeof body?.body === 'string' ? body.body.trim().slice(0, 2000) : ''
  const target = TARGETS.includes(body?.target as BroadcastTarget) ? (body?.target as BroadcastTarget) : 'all'
  const region = BROADCAST_REGION_KEYS.includes(body?.region as BroadcastRegion) ? (body?.region as BroadcastRegion) : 'nation'
  const banner = body?.banner === true
  if (!title || !text) {
    return NextResponse.json({ error: '제목과 내용을 입력해 주세요.' }, { status: 400 })
  }
  const entry = await createBroadcast({
    title,
    body: text,
    target,
    region,
    banner,
    createdBy: actor.staffId,
    createdByName: actor.staffName,
  })
  void pushToDrivers(entry)
  await recordAudit({
    kind: 'broadcast',
    actor: actor.staffId,
    actorName: actor.staffName,
    refId: `broadcast:${entry.id}`,
    detail: `공지 방송 등록 · 대상 ${targetLabel(target)} · 지역 ${broadcastRegionLabel(region)}${banner ? ' · 배너 노출' : ''} · ${title}`,
  }).catch(() => undefined)
  return NextResponse.json({ ok: true, broadcast: entry })
}

export async function PATCH(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const baseUpdatedAt = typeof body?.baseUpdatedAt === 'string' ? body.baseUpdatedAt : ''
  const current = id ? await getBroadcast(id) : null
  if (!current) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const title = typeof body?.title === 'string' ? body.title.trim() : undefined
  const text = typeof body?.body === 'string' ? body.body.trim() : undefined
  if ((title !== undefined && !title) || (text !== undefined && !text)) {
    return NextResponse.json({ error: '제목과 내용은 비울 수 없습니다.' }, { status: 400 })
  }
  const result = await updateBroadcast(
    id,
    {
      title,
      body: text,
      target: TARGETS.includes(body?.target as BroadcastTarget) ? (body?.target as BroadcastTarget) : undefined,
      region: BROADCAST_REGION_KEYS.includes(body?.region as BroadcastRegion) ? (body?.region as BroadcastRegion) : undefined,
      banner: typeof body?.banner === 'boolean' ? body.banner : undefined,
    },
    baseUpdatedAt || undefined,
  )
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (result.conflict) {
    return NextResponse.json(
      { error: 'conflict', message: '다른 사용자에 의해 내용이 변경되었습니다. 최신 정보를 불러온 후 다시 시도해 주세요.', broadcast: result.entry },
      { status: 409 },
    )
  }
  await recordAudit({
    kind: 'broadcast',
    actor: actor.staffId,
    actorName: actor.staffName,
    refId: `broadcast:${id}`,
    detail: `공지 방송 수정 · 대상 ${targetLabel(result.entry.target)} · 지역 ${broadcastRegionLabel(result.entry.region)} · ${result.entry.title}`,
    before: { title: current.title, target: current.target, region: current.region, banner: current.banner },
    after: { title: result.entry.title, target: result.entry.target, region: result.entry.region, banner: result.entry.banner },
  }).catch(() => undefined)
  return NextResponse.json({ ok: true, broadcast: result.entry })
}

export async function DELETE(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const id = new URL(request.url).searchParams.get('id')?.trim() || ''
  if (!id || !(await deleteBroadcast(id))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  await recordAudit({
    kind: 'broadcast',
    actor: actor.staffId,
    actorName: actor.staffName,
    refId: `broadcast:${id}`,
    detail: `공지 방송 삭제`,
  }).catch(() => undefined)
  return NextResponse.json({ ok: true })
}
