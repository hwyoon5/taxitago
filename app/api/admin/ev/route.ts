import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import { dataNetwork } from '@/lib/kv'
import {
  adminEvOverview,
  cancelEvBooking,
  ensureEvStation,
  saveEvStation,
} from '@/lib/ev-booking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * EV 충전 예약·대기열 관제 — GET: 충전소별 슬롯 점유·대기열·전력 부하와
 * 최근 예약 목록. POST: station(슬롯·출력 설정) / cancel(예약 강제 취소).
 * 모든 변경은 감사 로그(kind 'ev')에 남는다.
 */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const overview = adminEvOverview()
  return NextResponse.json({ ok: true, network: dataNetwork(), ...overview })
}

export async function POST(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const action = typeof body?.action === 'string' ? body.action.trim() : ''
  const audit = (refId: string, detail: string, before?: unknown, after?: unknown) =>
    recordAudit({
      kind: 'ev',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId,
      detail,
      before,
      after,
    }).catch(() => undefined)

  if (action === 'station') {
    const stationId = typeof body?.stationId === 'string' ? body.stationId.trim().slice(0, 80) : ''
    if (!stationId) return NextResponse.json({ error: 'stationId required' }, { status: 400 })
    const before = ensureEvStation(stationId, { name: typeof body?.name === 'string' ? body.name : undefined })
    if (typeof body?.name === 'string' && body.name.trim()) before.name = body.name.trim().slice(0, 80)
    const slots = Number(body?.slots)
    if (Number.isFinite(slots)) before.slots = Math.min(50, Math.max(1, Math.round(slots)))
    const powerKw = Number(body?.powerKw)
    if (Number.isFinite(powerKw) && powerKw > 0) before.powerKw = Math.round(powerKw * 10) / 10
    before.updatedBy = actor.staffId
    const station = saveEvStation(before)
    await audit(`ev:station:${station.id}`, `EV 충전소 설정 · ${station.name} · 슬롯 ${station.slots}`, undefined, station)
    return NextResponse.json({ ok: true, station })
  }

  if (action === 'cancel') {
    const bookingId = typeof body?.bookingId === 'string' ? body.bookingId.trim() : ''
    if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 })
    const result = cancelEvBooking(bookingId, { admin: actor.staffId })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.error === 'not_found' ? 404 : 409 })
    }
    await audit(`ev:booking:${bookingId}`, `EV 예약 강제 취소 · ${result.booking.stationName} · ${result.booking.userId}`)
    return NextResponse.json({ ok: true, booking: result.booking })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
