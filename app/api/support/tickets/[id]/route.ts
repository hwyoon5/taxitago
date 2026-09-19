import { NextResponse } from 'next/server'
import { getTicket } from '@/lib/support-store'
import { postTicketMessage, setTicketStatus } from '@/lib/support-engine'
import type { SupportActor, TicketStatus } from '@/lib/support-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES: TicketStatus[] = ['received', 'in_progress', 'waiting', 'resolved', 'closed']

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const ticket = getTicket(id)
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
  const result = postTicketMessage({ ticketId: id, actorId, role: role as SupportActor, text })
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'forbidden' ? 403 : 400
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ ok: true, ticket: result.ticket, message: result.message })
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const status = body?.status
  if (!STATUSES.includes(status as TicketStatus)) {
    return NextResponse.json({ error: 'status required' }, { status: 400 })
  }
  const ticket = setTicketStatus(id, status as TicketStatus)
  if (!ticket) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, ticket })
}
