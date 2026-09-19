import { NextResponse } from 'next/server'
import { getLostItem } from '@/lib/support-store'
import { updateLostStatus } from '@/lib/support-engine'
import type { LostStatus, SupportActor } from '@/lib/support-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const item = getLostItem(id)
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
  const item = updateLostStatus(id, status as LostStatus, actorId, role as SupportActor)
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, item })
}
