import { NextResponse } from 'next/server'
import { removeDriverPushSubscription, saveDriverPushSubscription } from '@/lib/driver-push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { driverId?: unknown; subscription?: unknown; unsubscribe?: unknown } | null
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  if (!driverId) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  if (body?.unsubscribe === true) {
    const endpoint = body.subscription && typeof body.subscription === 'object' && 'endpoint' in body.subscription
      ? String((body.subscription as { endpoint?: unknown }).endpoint || '')
      : ''
    removeDriverPushSubscription(driverId, endpoint || undefined)
    return NextResponse.json({ ok: true })
  }
  if (!saveDriverPushSubscription(driverId, body?.subscription)) {
    return NextResponse.json({ error: 'subscription required' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
