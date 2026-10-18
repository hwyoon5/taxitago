import { NextResponse } from 'next/server'
import {
  createEvBooking,
  earliestFreeAt,
  ensureEvStation,
  listEvBookings,
  stationAvailability,
  sweepEvStation,
  syncEvBookings,
} from '@/lib/ev-booking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * EV 충전 예약 조회 — 이용자의 예약 목록과 요청한 충전소들의 실시간
 * 가용 슬롯·대기열 현황을 돌려준다. 스윕은 읽기 경로에서도 실행돼
 * 만료·승격이 스케줄러 없이도 반영된다.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const userId = (searchParams.get('userId') || '').trim()
  // 'id|이름' 쌍 — 자동 등록되는 충전소가 id 그대로 이름을 쓰지 않게 한다.
  const stationIds = (searchParams.get('stations') || '')
    .split(',')
    .map((entry) => {
      const [id, ...rest] = entry.split('|')
      return { id: (id || '').trim().slice(0, 80), name: rest.join('|').trim().slice(0, 80) }
    })
    .filter((row) => row.id)
    .slice(0, 20)
  syncEvBookings()
  const availability = stationIds.map(({ id, name }) => {
    ensureEvStation(id, { name: name || undefined })
    sweepEvStation(id)
    const avail = stationAvailability(id)
    if (avail.occupiedNow >= avail.slots) {
      const next = earliestFreeAt(id, avail.slots, Date.now(), 60)
      if (next != null) avail.nextFreeAt = new Date(next).toISOString()
    }
    return avail
  }).map((avail, index) => ({ ...avail, name: stationIds[index]?.name || avail.name }))
  const bookings = userId ? listEvBookings({ userId }).slice(0, 30) : []
  const mine = bookings.find((row) => ['queued', 'reserved', 'notified', 'active'].includes(row.status)) ?? null
  return NextResponse.json({ bookings, mine, availability })
}

/** 예약 생성 — 슬롯이 비면 notified/reserved, 차 있으면 대기열(queued). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const result = createEvBooking({
    userId: typeof body?.userId === 'string' ? body.userId : '',
    userUid: typeof body?.userUid === 'string' ? body.userUid : undefined,
    stationId: typeof body?.stationId === 'string' ? body.stationId : '',
    stationName: typeof body?.stationName === 'string' ? body.stationName : undefined,
    startAt: typeof body?.startAt === 'string' ? body.startAt : undefined,
    durationMin: typeof body?.durationMin === 'number' && Number.isFinite(body.durationMin) ? body.durationMin : undefined,
    powerKw: typeof body?.powerKw === 'number' && Number.isFinite(body.powerKw) ? body.powerKw : undefined,
    providerName: typeof body?.providerName === 'string' ? body.providerName : undefined,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  const avail = stationAvailability(result.booking.stationId)
  return NextResponse.json({ ok: true, booking: result.booking, deduped: result.deduped === true, availability: avail })
}
