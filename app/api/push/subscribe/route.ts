import { NextResponse } from 'next/server'
import { removeDriverPushSubscription, saveDriverPushSubscription } from '@/lib/driver-push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    driverId?: unknown
    ownerId?: unknown
    role?: unknown
    subscription?: unknown
    unsubscribe?: unknown
  } | null
  // ownerId(범용) — driverId는 구형 클라이언트 호환 별칭.
  const ownerId =
    (typeof body?.ownerId === 'string' ? body.ownerId.trim() : '') ||
    (typeof body?.driverId === 'string' ? body.driverId.trim() : '')
  if (!ownerId) return NextResponse.json({ error: 'ownerId required' }, { status: 400 })
  const role = body?.role === 'user' ? 'user' : 'driver'
  if (body?.unsubscribe === true) {
    const endpoint = body.subscription && typeof body.subscription === 'object' && 'endpoint' in body.subscription
      ? String((body.subscription as { endpoint?: unknown }).endpoint || '')
      : ''
    await removeDriverPushSubscription(ownerId, endpoint || undefined)
    return NextResponse.json({ ok: true })
  }
  if (!(await saveDriverPushSubscription(ownerId, body?.subscription, role))) {
    return NextResponse.json({ error: 'subscription required' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
