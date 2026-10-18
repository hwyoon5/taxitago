import { NextResponse } from 'next/server'
import { publicDelivery, relistDeliveryDispatch } from '@/lib/delivery-dispatch'
import { notifyNearbyDeliveryDrivers } from '@/lib/delivery-push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 만료·완료 택배 건의 재등록 — 출발지/도착지/물품 정보·사진·연락처를
 * 원본에서 복사한 새 'requested' 건을 만들어 매칭 풀에 올린다.
 * 요금(fare)·예약 수거 시각(scheduledAt)은 patch로 덮을 수 있어
 * '요금 올리기'와 재등록을 한 번에 처리한다.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as {
    ownerId?: string
    fare?: unknown
    scheduledAt?: unknown
  } | null
  const ownerId = typeof body?.ownerId === 'string' ? body.ownerId.trim() : ''
  if (!ownerId) return NextResponse.json({ error: 'ownerId required' }, { status: 400 })
  const fare = typeof body?.fare === 'number' && Number.isFinite(body.fare) ? body.fare : undefined
  const scheduledAt = typeof body?.scheduledAt === 'string' ? body.scheduledAt : undefined
  const result = await relistDeliveryDispatch(id, ownerId, { fare, scheduledAt })
  if (!result.ok || !result.relisted) {
    const status = result.error === 'not_found' ? 404 : result.error === 'forbidden' ? 403 : 409
    return NextResponse.json({ error: result.error }, { status })
  }
  // 재등록 건도 신규 콜과 동일하게 근거리 기사에게 푸시한다.
  notifyNearbyDeliveryDrivers(result.relisted)
  return NextResponse.json({ ok: true, job: publicDelivery(result.relisted, ownerId), relistedFrom: id })
}
