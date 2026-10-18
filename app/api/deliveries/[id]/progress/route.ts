import { NextResponse } from 'next/server'
import { progressDeliveryDispatch, publicDelivery } from '@/lib/delivery-dispatch'
import { notifyDeliveryProgress } from '@/lib/push-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 배정 기사의 배송 진행 표시.
 * action: 'pickup' → in_transit(수거 완료·배송 중), 'complete' → completed(배송 완료).
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { driverId?: string; action?: string } | null
  const driverId = body?.driverId?.trim() || ''
  const next = body?.action === 'pickup' ? 'in_transit' : body?.action === 'complete' ? 'completed' : null
  if (!driverId || !next) {
    return NextResponse.json({ error: 'driverId and action required' }, { status: 400 })
  }
  const result = await progressDeliveryDispatch(id, driverId, next)
  if (!result.ok || !result.job) {
    const status = result.error === 'not_found' ? 404 : result.error === 'forbidden' ? 403 : 409
    return NextResponse.json({ error: result.error }, { status })
  }
  // 발신인 상태 알림 — 수거 완료(배송 시작)/배송 완료 시점에 웹 푸시.
  void notifyDeliveryProgress(result.job, next === 'in_transit' ? 'picked_up' : 'delivered').catch(() => undefined)
  return NextResponse.json({ ok: true, job: publicDelivery(result.job, driverId) })
}
