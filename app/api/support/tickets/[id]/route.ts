import { NextResponse } from 'next/server'
import { getTicket } from '@/lib/support-store'
import { addTicketNote, assignTicket, editTicketMessage, postTicketMessage, setTicketStatus } from '@/lib/support-engine'
import { adminActor } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import type { SupportActor, TicketStatus } from '@/lib/support-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES: TicketStatus[] = ['received', 'assigned', 'in_progress', 'waiting', 'resolved', 'closed']

/**
 * 낙관적 동시성 제어 — 클라이언트가 조회 시각의 updatedAt을 baseUpdatedAt으로
 * 보내면, 그 사이 다른 직원이 저장해 값이 어긋난 경우 409로 거절한다.
 * 최신 레코드를 함께 돌려줘 클라이언트가 즉시 갱신할 수 있다.
 */
async function staleCheck(id: string, baseUpdatedAt: unknown): Promise<{ conflict: boolean; ticket: Awaited<ReturnType<typeof getTicket>> }> {
  const base = typeof baseUpdatedAt === 'string' ? baseUpdatedAt : ''
  if (!base) return { conflict: false, ticket: null }
  const current = await getTicket(id)
  if (!current) return { conflict: false, ticket: null }
  return { conflict: current.updatedAt !== base, ticket: current }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const ticket = await getTicket(id)
  if (!ticket) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // 내부 메모·배정 정보는 관리자에게만 노출 — 고객 단건 조회에서는 제거한다.
  const isAdmin = await adminActor(request)
  return NextResponse.json({ ok: true, ticket: isAdmin ? ticket : { ...ticket, notes: undefined } })
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
  if (actor) {
    const stale = await staleCheck(id, body?.baseUpdatedAt)
    if (stale.conflict) {
      return NextResponse.json({ error: 'conflict', ticket: stale.ticket }, { status: 409 })
    }
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
  // 모든 관리자 변경에 낙관적 동시성 검사 — 조회 후 다른 직원이 먼저 저장했으면 거절.
  const stale = await staleCheck(id, body?.baseUpdatedAt)
  if (stale.conflict) {
    return NextResponse.json({ error: 'conflict', ticket: stale.ticket }, { status: 409 })
  }
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
  // 담당자 배정/해제 — { assignee: { staffId, staffName } | null }
  if (body && 'assignee' in body) {
    const raw = body.assignee as { staffId?: unknown; staffName?: unknown } | null
    const assignee =
      raw && typeof raw.staffId === 'string' && raw.staffId.trim()
        ? { staffId: raw.staffId.trim(), staffName: typeof raw.staffName === 'string' && raw.staffName.trim() ? raw.staffName.trim() : raw.staffId.trim() }
        : null
    const ticket = await assignTicket(id, assignee)
    if (!ticket) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await recordAudit({
      kind: 'ticket',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `ticket:${id}`,
      detail: assignee ? `문의 담당자 배정 · ${ticket.subject || id} → ${assignee.staffName}` : `문의 담당자 해제 · ${ticket.subject || id}`,
      after: { assigneeId: ticket.assigneeId ?? '', assigneeName: ticket.assigneeName ?? '', status: ticket.status },
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, ticket })
  }
  // 내부 메모 — { memo: string }, 작성자는 인증된 관리자 본인.
  const memo = typeof body?.memo === 'string' ? body.memo : ''
  if (memo.trim()) {
    const ticket = await addTicketNote(id, { staffId: actor.staffId, staffName: actor.staffName, text: memo })
    if (!ticket) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await recordAudit({
      kind: 'ticket',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `ticket:${id}`,
      detail: `문의 내부 메모 추가 · ${ticket.subject || id}`,
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, ticket })
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
