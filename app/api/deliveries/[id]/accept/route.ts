import { NextResponse } from 'next/server'
import { acceptDeliveryDispatch, getDeliveryDispatch, publicDelivery } from '@/lib/delivery-dispatch'
import { recordSettlement } from '@/lib/settlement-store'
import { driverPayoutTarget } from '@/lib/escrow-engine'
import { getRegistryUser } from '@/lib/user-registry'
import { driverDeliveryEligible, partnerServesDelivery } from '@/lib/partner-services'
import { sendSmsText } from '@/lib/sms-notify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  const vehicle = typeof body?.vehicle === 'string' ? body.vehicle.trim() : ''
  const plate = typeof body?.plate === 'string' ? body.plate.trim() : ''
  if (!driverId || !vehicle || !plate) {
    return NextResponse.json({ error: 'driverId, vehicle, and plate required' }, { status: 400 })
  }
  // 등록 계정의 수행 역할·차량 체급을 서버가 검증한다 — 겸직 역할에 '택배'가
  // 없거나 허용 체급이 아닌 콜(소화물 예외 제외)은 수락을 차단한다.
  // 레지스트리에 기록이 없는 단말(테스트넷 개발 기기)은 기존처럼 허용.
  const registryUser = await getRegistryUser(driverId).catch(() => null)
  if (registryUser) {
    if (!partnerServesDelivery(registryUser)) {
      return NextResponse.json({ error: '택배 배송 역할이 등록된 기사만 수락할 수 있습니다.' }, { status: 403 })
    }
    const job = await getDeliveryDispatch(id)
    if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (!driverDeliveryEligible(registryUser, job)) {
      return NextResponse.json({ error: '수행 가능한 차량 체급·화물 규격이 아닙니다.' }, { status: 403 })
    }
  }
  const result = await acceptDeliveryDispatch(id, {
    driverId,
    name: typeof body?.name === 'string' ? body.name : '기사',
    vehicle,
    plate,
    phone: typeof body?.phone === 'string' ? body.phone : '',
  })
  if (!result.ok || !result.job) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'not_found' ? 404 : 409 })
  }
  const job = result.job
  // 발신인 SMS/알림톡 통보 — 공급자 미설정이면 로그만 남기고 응답은 지연 없이 반환.
  void sendSmsText(
    job.senderPhone,
    `[TaxiTago] 택배 배차가 완료됐어요. ${job.driverName ?? '기사'} 기사(${job.driverVehicle ?? ''} ${job.driverPlate ?? ''})${job.driverPhone ? ` · ${job.driverPhone}` : ''}`,
  ).catch(() => undefined)
  await recordSettlement({
    refId: `delivery:${job.id}`,
    service: 'delivery',
    driverId,
    driverName: job.driverName || '기사',
    memo: `${job.packageLabel} · ${job.pickupAddress} → ${job.destAddress}`,
    gross: job.fare,
    driverWallet: driverPayoutTarget(driverId).wallet,
  }).catch(() => null)
  return NextResponse.json({ ok: true, job: publicDelivery(job, driverId) })
}
