import { NextResponse } from 'next/server'
import { listChatMessages, postChatMessage } from '@/lib/comms-engine'
import type { CommsRole } from '@/lib/comms-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function roleOf(value: unknown): CommsRole | null {
  return value === 'passenger' || value === 'driver' ? value : null
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const url = new URL(request.url)
  const actorId = url.searchParams.get('actorId')?.trim() || ''
  const role = roleOf(url.searchParams.get('role'))
  const after = url.searchParams.get('after')?.trim() || undefined
  if (!actorId || !role) return NextResponse.json({ error: 'actorId and role required' }, { status: 400 })
  const result = listChatMessages(id, actorId, role, after)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === 'not_found' ? 404 : 403 })
  return NextResponse.json({ ok: true, room: result.room })
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const actorId = typeof body?.actorId === 'string' ? body.actorId.trim() : ''
  const role = roleOf(body?.role)
  const text = typeof body?.text === 'string' ? body.text : ''
  if (!actorId || !role) return NextResponse.json({ error: 'actorId and role required' }, { status: 400 })
  const result = postChatMessage({ rideId: id, actorId, role, text })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'archived' ? 409 : 400 })
  }
  return NextResponse.json({ ok: true, message: result.message, room: result.room })
}
