import { NextResponse, after } from 'next/server'
import { createSupportTicket, ticketInbox } from '@/lib/support-engine'
import { isAdminRequest } from '@/lib/admin-auth'
import { notifySupportInbox } from '@/lib/admin-notify'
import type { SupportActor, TicketCategory } from '@/lib/support-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CATEGORIES: TicketCategory[] = ['fare_dispute', 'general', 'payment', 'safety', 'lost']

function roleOf(value: string | null): SupportActor | null {
  return value === 'passenger' || value === 'driver' || value === 'admin' ? value : null
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const actorId = url.searchParams.get('actorId')?.trim() || undefined
  const role = roleOf(url.searchParams.get('role'))
  if (role === 'admin' && !isAdminRequest(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, tickets: await ticketInbox({ actorId, role: role ?? undefined }) })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  const userRole = body?.userRole === 'driver' || body?.userRole === 'passenger' ? body.userRole : null
  const category = CATEGORIES.includes(body?.category as TicketCategory) ? (body?.category as TicketCategory) : null
  const text = typeof body?.body === 'string' ? body.body : ''
  if (!userId || !userRole || !category) {
    return NextResponse.json({ error: 'userId, userRole, category required' }, { status: 400 })
  }
  const result = await createSupportTicket({
    userId,
    userRole,
    category,
    subject: typeof body?.subject === 'string' ? body.subject : undefined,
    body: text,
    rideId: typeof body?.rideId === 'string' ? body.rideId : undefined,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  const ticket = result.ticket
  after(() =>
    notifySupportInbox({
      kind: 'ticket',
      id: ticket.id,
      title: ticket.subject,
      detail: ticket.body,
      from: `${ticket.userRole === 'driver' ? '기사' : '이용자'} ${ticket.userId}`,
    }),
  )
  return NextResponse.json({ ok: true, ticket })
}
