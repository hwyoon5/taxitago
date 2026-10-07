import { NextResponse } from 'next/server'
import { getTicket } from '@/lib/support-store'
import { editTicketMessage, postTicketMessage, setTicketStatus } from '@/lib/support-engine'
import { adminActor } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import type { SupportActor, TicketStatus } from '@/lib/support-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES: TicketStatus[] = ['received', 'in_progress', 'waiting', 'resolved', 'closed']

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const ticket = await getTicket(id)
  if (!ticket) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, ticket })
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const actorId = typeof body?.actorId === 'string' ? body.actorId.trim() : ''
  const role = body?.role
  const text = typeof body?.text === 'string' ? body.text : ''
  if (!actorId || (role !== 'passenger' && role !== 'driver' && role !== 'admin')) {
    return NextResponse.json({ error: 'actorId and role required' }, { status: 400 })
  }
  const actor = role === 'admin' ? await adminActor(request) : null
  if (role === 'admin' && !actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const result = await postTicketMessage({ ticketId: id, actorId, role: role as SupportActor, text })
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'forbidden' ? 403 : 400
    return NextResponse.json({ error: result.error }, { status })
  }
  if (actor) {
    await recordAudit({
      kind: 'ticket',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `ticket:${id}`,
      detail: `문의 답변 등록 · ${result.ticket.subject || id}`,
    }).catch(() => undefined)
  }
  return NextResponse.json({ ok: true, ticket: result.ticket, message: result.message })
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const messageId = typeof body?.messageId === 'string' ? body.messageId.trim() : ''
  const text = typeof body?.text === 'string' ? body.text : ''
  if (messageId) {
    const result = await editTicketMessage({
      ticketId: id,
      messageId,
      role: body?.role === 'admin' ? 'admin' : 'passenger',
      text,
    })
    if (!result.ok) {
      const status = result.error === 'not_found' ? 404 : result.error === 'forbidden' ? 403 : 400
      return NextResponse.json({ error: result.error }, { status })
    }
    if (body?.role === 'admin') {
      await recordAudit({
        kind: 'ticket',
        actor: actor.staffId,
        actorName: actor.staffName,
        refId: `ticket:${id}`,
        detail: `문의 답변 수정 · ${id}`,
      }).catch(() => undefined)
    }
    return NextResponse.json({ ok: true, ticket: result.ticket })
  }
  const status = body?.status
  if (!STATUSES.includes(status as TicketStatus)) {
    return NextResponse.json({ error: 'status required' }, { status: 400 })
  }
  const ticket = await setTicketStatus(id, status as TicketStatus)
  if (!ticket) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await recordAudit({
    kind: 'ticket',
    actor: actor.staffId,
    actorName: actor.staffName,
    refId: `ticket:${id}`,
    detail: `문의 상태 변경 · ${ticket.subject || id} → ${status}`,
    after: { status: ticket.status },
  }).catch(() => undefined)
  return NextResponse.json({ ok: true, ticket })
}
