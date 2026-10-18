import { NextResponse } from 'next/server'
import { createTrip, listTrips, syncTrip } from '@/lib/trip-planner'
import { hydrateDispatchFromKv } from '@/lib/dispatch-store'
import { inspectPiAccessToken } from '@/lib/pi-platform'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/trips?ownerId=<id> — 내 통합 여정 목록(최신 상태로 lazy 동기화).
 * POST /api/trips — 여정 계획 생성(다리 구성 + 시간·위치 연동 제안값 반환).
 * 생성은 계획만 만든다 — 실제 호출·예약·발송은 /api/trips/[id]/activate가
 * 다리별 서비스 레코드를 만든다.
 */
export async function GET(request: Request) {
  const ownerId = new URL(request.url).searchParams.get('ownerId')?.trim() || ''
  if (!ownerId) return NextResponse.json({ error: 'ownerId required' }, { status: 400 })
  await hydrateDispatchFromKv()
  const trips = listTrips(ownerId)
  const synced = await Promise.all(trips.map((trip) => syncTrip(trip)))
  return NextResponse.json({ ok: true, trips: synced })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const ownerId =
    request.headers.get('x-pi-uid')?.trim() ||
    (typeof body?.ownerId === 'string' ? body.ownerId.trim() : '')
  if (!ownerId) {
    return NextResponse.json({ error: 'Pi 계정 연동 및 로그인 후 이용해 주세요.' }, { status: 401 })
  }
  // 메인넷은 기사 호출과 같은 수준으로 토큰을 검증한다 — 테스트넷은
  // /v2/me가 불안정해 uid 존재만으로 통과한다(기존 라이드 정책과 동일).
  if (!isPiSandboxRequest(request)) {
    const piToken =
      request.headers.get('x-pi-access-token')?.trim() ||
      (typeof body?.piAccessToken === 'string' ? body.piAccessToken.trim() : '')
    if (!piToken) {
      return NextResponse.json({ error: 'Pi 계정 연동 및 로그인 후 이용해 주세요.' }, { status: 401 })
    }
    const inspection = await inspectPiAccessToken(piToken, false)
    if (inspection.status !== 'ok' || inspection.uid !== ownerId) {
      return NextResponse.json({ error: 'Pi 인증이 만료되었거나 확인되지 않았습니다. 다시 로그인해 주세요.' }, { status: 401 })
    }
  }
  const result = await createTrip(ownerId, { departAt: body?.departAt, legs: body?.legs })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, trip: result.trip })
}
