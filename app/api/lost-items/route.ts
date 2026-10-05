import { NextResponse, after } from 'next/server'
import { fileLostItem, lostInbox } from '@/lib/support-engine'
import { isAdminRequest } from '@/lib/admin-auth'
import { notifySupportInbox } from '@/lib/admin-notify'
import { sanitizeAttachments } from '@/lib/attachment-store'
import type { LostItemType, LostKind, SupportActor } from '@/lib/support-types'
import { LOST_ITEM_TYPES } from '@/lib/support-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function roleOf(value: string | null): SupportActor | null {
  return value === 'passenger' || value === 'driver' || value === 'admin' ? value : null
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const actorId = url.searchParams.get('actorId')?.trim() || ''
  const role = roleOf(url.searchParams.get('role'))
  if (!actorId || !role) return NextResponse.json({ error: 'actorId and role required' }, { status: 400 })
  if (role === 'admin' && !(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, items: await lostInbox({ actorId, role }) })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const kind: LostKind | null = body?.kind === 'found' || body?.kind === 'lost' ? body.kind : null
  const itemType = typeof body?.itemType === 'string' && LOST_ITEM_TYPES.includes(body.itemType as LostItemType) ? (body.itemType as LostItemType) : null
  const reporterId = typeof body?.reporterId === 'string' ? body.reporterId.trim() : ''
  const reporterRole = body?.reporterRole === 'driver' || body?.reporterRole === 'passenger' ? body.reporterRole : null
  if (!kind || !itemType || !reporterId || !reporterRole) {
    return NextResponse.json({ error: 'kind, itemType, reporterId, reporterRole required' }, { status: 400 })
  }
  const result = await fileLostItem({
    kind,
    itemType,
    description: typeof body?.description === 'string' ? body.description : '',
    occurredAt: typeof body?.occurredAt === 'string' ? body.occurredAt : undefined,
    rideId: typeof body?.rideId === 'string' ? body.rideId.trim() : undefined,
    reporterId,
    reporterRole,
    route: typeof body?.route === 'string' ? body.route : undefined,
    driverName: typeof body?.driverName === 'string' ? body.driverName : undefined,
    plate: typeof body?.plate === 'string' ? body.plate : undefined,
    vehicle: typeof body?.vehicle === 'string' ? body.vehicle : undefined,
    photos: sanitizeAttachments(body?.photos),
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === 'forbidden' ? 403 : 400 })
  const item = result.item
  after(() =>
    notifySupportInbox({
      kind: 'lost',
      id: item.id,
      title: `${item.kind === 'lost' ? '분실' : '습득'} · ${item.itemType}`,
      detail: item.description || item.route,
      from: `${item.reporterRole === 'driver' ? '기사' : '이용자'} ${item.reporterId}`,
    }),
  )
  return NextResponse.json({ ok: true, item })
}
