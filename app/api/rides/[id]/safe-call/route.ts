import { NextResponse } from 'next/server'
import { answerSafeCall, getPublicSafeCall, hangupSafeCall, startSafeCall } from '@/lib/comms-engine'
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
  if (!actorId || !role) return NextResponse.json({ error: 'actorId and role required' }, { status: 400 })
  const result = getPublicSafeCall(id, actorId, role)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === 'not_found' ? 404 : 403 })
  return NextResponse.json({ ok: true, call: result.call })
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const actorId = typeof body?.actorId === 'string' ? body.actorId.trim() : ''
  const role = roleOf(body?.role)
  const action = body?.action === 'answer' || body?.action === 'hangup' ? body.action : 'start'
  if (!actorId || !role) return NextResponse.json({ error: 'actorId and role required' }, { status: 400 })
  const result =
    action === 'answer'
      ? answerSafeCall(id, actorId, role)
      : action === 'hangup'
        ? hangupSafeCall(id, actorId, role)
        : startSafeCall({
            rideId: id,
            actorId,
            role,
            realPhone: typeof body?.realPhone === 'string' ? body.realPhone : undefined,
          })
  if (!result.ok) {
    return NextResponse.json({ error: result.error, call: result.call }, { status: result.error === 'not_found' ? 404 : 409 })
  }
  return NextResponse.json({ ok: true, call: result.call })
}
