import { NextResponse } from 'next/server'
import { getLostItem } from '@/lib/support-store'
import { updateLostStatus } from '@/lib/support-engine'
import { adminActor } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import type { LostStatus, SupportActor } from '@/lib/support-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const item = await getLostItem(id)
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, item })
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const status = body?.status
  const actorId = typeof body?.actorId === 'string' ? body.actorId.trim() : ''
  const role = body?.role
  const allowed: LostStatus[] = ['open', 'matched', 'talking', 'returned', 'closed']
  if (!actorId || (role !== 'passenger' && role !== 'driver' && role !== 'admin') || !allowed.includes(status as LostStatus)) {
    return NextResponse.json({ error: 'actorId, role, status required' }, { status: 400 })
  }
  const actor = role === 'admin' ? await adminActor(request) : null
  if (role === 'admin' && !actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const result = await updateLostStatus(id, status as LostStatus, actorId, role as SupportActor)
  if (!result.ok) {
    const code = result.error === 'not_found' ? 404 : result.error === 'forbidden' ? 403 : 409
    return NextResponse.json({ error: result.error }, { status: code })
  }
  if (actor) {
    await recordAudit({
      kind: 'ticket',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `lost:${id}`,
      detail: `분실물 상태 변경 · ${result.item.itemType} → ${status}`,
      after: { status: result.item.status },
    }).catch(() => undefined)
  }
  return NextResponse.json({ ok: true, item: result.item })
}
