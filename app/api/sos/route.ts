import { NextResponse, after } from 'next/server'
import { raiseSosAlert, sosInbox } from '@/lib/support-engine'
import { isAdminRequest } from '@/lib/admin-auth'
import { notifySupportInbox } from '@/lib/admin-notify'
import type { SupportActor } from '@/lib/support-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function roleOf(value: string | null): SupportActor | null {
  return value === 'passenger' || value === 'driver' || value === 'admin' ? value : null
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const actorId = url.searchParams.get('actorId')?.trim() || undefined
  const role = roleOf(url.searchParams.get('role'))
  const openOnly = url.searchParams.get('open') === '1'
  if (role === 'admin' && !(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, alerts: await sosInbox({ actorId, role: role ?? undefined, openOnly }) })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const rideId = typeof body?.rideId === 'string' ? body.rideId.trim() : ''
  const fromId = typeof body?.fromId === 'string' ? body.fromId.trim() : ''
  const fromRole = body?.fromRole === 'driver' || body?.fromRole === 'passenger' ? body.fromRole : null
  const lat = Number(body?.lat)
  const lng = Number(body?.lng)
  if (!rideId || !fromId || !fromRole || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'rideId, fromId, fromRole, lat, lng required' }, { status: 400 })
  }
  const result = await raiseSosAlert({
    rideId,
    fromId,
    fromRole,
    lat,
    lng,
    accuracyM: typeof body?.accuracyM === 'number' ? body.accuracyM : null,
    note: typeof body?.note === 'string' ? body.note : '',
  })
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'forbidden' ? 403 : 400
    return NextResponse.json({ error: result.error }, { status })
  }
  const alert = result.alert
  if (!result.duplicate) {
    after(() =>
      notifySupportInbox({
        kind: 'sos',
        id: alert.id,
        title: `긴급 신고 · 운행 ${alert.rideId}`,
        detail: alert.note || `위치 ${alert.lat}, ${alert.lng}`,
        from: `${alert.fromRole === 'driver' ? '기사' : '이용자'} ${alert.fromId}`,
      }),
    )
  }
  return NextResponse.json({ ok: true, alert, duplicate: result.duplicate })
}
