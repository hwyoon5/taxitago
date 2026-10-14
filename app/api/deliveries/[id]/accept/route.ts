import { NextResponse } from 'next/server'
import { acceptDeliveryDispatch, publicDelivery } from '@/lib/delivery-dispatch'
import { recordSettlement } from '@/lib/settlement-store'
import { driverPayoutTarget } from '@/lib/escrow-engine'
import { getRegistryUser } from '@/lib/user-registry'
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
  // 등록 계정이 다른 서비스 자격(택시·대리·시설형)으로 확인되면 택배 수락을
  // 차단한다 — 레지스트리에 기록이 없는 단말은 기존처럼 허용.
  const registryType = await getRegistryUser(driverId).then((user) => user?.serviceType).catch(() => undefined)
  if (registryType && registryType !== '택배') {
    return NextResponse.json({ error: '택배 등록 기사만 수락할 수 있습니다.' }, { status: 403 })
  }
  const result = acceptDeliveryDispatch(id, {
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
