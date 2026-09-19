import { NextResponse } from 'next/server'
import { postLostMessage } from '@/lib/support-engine'
import type { SupportActor } from '@/lib/support-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const actorId = typeof body?.actorId === 'string' ? body.actorId.trim() : ''
  const role = body?.role
  const text = typeof body?.text === 'string' ? body.text : ''
  if (!actorId || (role !== 'passenger' && role !== 'driver' && role !== 'admin')) {
    return NextResponse.json({ error: 'actorId and role required' }, { status: 400 })
  }
  const result = postLostMessage({ itemId: id, actorId, role: role as SupportActor, text })
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'forbidden' ? 403 : 400
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ ok: true, item: result.item, message: result.message })
}
