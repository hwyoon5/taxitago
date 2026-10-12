import { NextResponse } from 'next/server'
import { beatPresence, PRESENCE_ROLES, presenceCounts, type PresenceRole } from '@/lib/presence-store'
import { ensureSeedDrivers, hydrateDispatchFromKv, listDrivers, listRides } from '@/lib/dispatch-store'
import { DRIVER_STALE_MS } from '@/lib/dispatch-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 앱 접속 하트비트 — 익명이지만 역할·식별자만 받고 개인정보는 저장하지 않는다. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const id = typeof body?.id === 'string' ? body.id.trim().slice(0, 128) : ''
  const role = typeof body?.role === 'string' ? body.role : ''
  if (!id || !(PRESENCE_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: 'id and valid role required' }, { status: 400 })
  }
  // 선택적 위치 — 관리자 관제 대시보드가 마지막 알려진 좌표를 표시하는 데 쓴다.
  const lat = Number(body?.lat)
  const lng = Number(body?.lng)
  const loc = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : undefined
  await beatPresence(id, role as PresenceRole, loc)
  return NextResponse.json({ ok: true })
}

/**
 * 공개 집계 스냅샷 — 홈 화면 신호등이 참조하는 역할별 접속자 수와
 * 매칭 수요(대기+제안)만 돌려주며 개인 식별 정보는 일절 포함하지 않는다.
 */
export async function GET() {
  await hydrateDispatchFromKv().catch(() => undefined)
  ensureSeedDrivers()
  const presence = await presenceCounts()
  const now = Date.now()
  const demand = listRides().filter((ride) => ride.status === 'searching' || ride.status === 'offered').length
  const driversOnline = listDrivers().filter(
    (driver) => !driver.virtual && driver.status !== 'offline' && now - Date.parse(driver.lastSeenAt || '') <= DRIVER_STALE_MS,
  ).length
  return NextResponse.json({ ok: true, presence, matching: { demand, driversOnline } })
}
