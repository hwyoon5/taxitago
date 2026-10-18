import { NextResponse } from 'next/server'
import { cancelTrip } from '@/lib/trip-planner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/trips/[id]/cancel — 여정 취소. 실행된 각 다리를 해당 서비스의
 * 취소 경로로 되돌린다(라이드 취소 → 에스크로 자동 환불, EV 예약 취소 →
 * 대기열 승격, 대기 중 택배 건 삭제).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const ownerId =
    request.headers.get('x-pi-uid')?.trim() ||
    (typeof body?.ownerId === 'string' ? body.ownerId.trim() : '')
  if (!ownerId) return NextResponse.json({ error: 'ownerId required' }, { status: 400 })
  const result = await cancelTrip(id, ownerId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 })
  return NextResponse.json({ ok: true, trip: result.trip })
}
