import { NextResponse } from 'next/server'
import { altPayLedger, completeViaAltPay, listAltPayRecords } from '@/lib/altpay-store'
import { getDriver, getRide } from '@/lib/dispatch-store'
import { driverPayoutTarget } from '@/lib/escrow-engine'
import { getDevice } from '@/lib/device-store'
import { createManualPay, settleManualPayByDriver } from '@/lib/manual-pay-store'
import type { SettlementService } from '@/lib/settlement-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SERVICES: SettlementService[] = ['taxi', 'daeri', 'delivery', 'bicycle', 'kickboard', 'ev', 'parking']

/**
 * 타 결제 수단 이용 완료 — Pi 결제 실패가 지정 조건(잔액 부족 1회 또는
 * 통신·기타 오류 2회)을 채운 이용자만 호출할 수 있다.
 *
 * kind 'ride'    — 배차된 운행의 승객 결제를 현장 결제로 마감한다. 서버가
 *                  기사 계정으로 현장 수동 정산(manual-pay) 장부를 만들어
 *                  반환된 onsitePayId로 /api/rides/[id]/complete를 마무리한다.
 * kind 'service' — 셀프·무인 서비스(기기/EV) 이용료의 타 결제 완료.
 *                  수수료는 제공자의 미입금 수수료 장부에 적립된다.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  const kind = body?.kind === 'ride' ? 'ride' : 'service'
  const method = typeof body?.method === 'string' ? body.method.trim() : 'other'
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  if (kind === 'ride') {
    const refId = typeof body?.refId === 'string' ? body.refId.trim() : ''
    const ride = refId ? getRide(refId) : null
    if (!ride) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    // 승객 본인 확인 — 로컬 passengerId 또는 Pi uid 어느 쪽으로 호출했는지에 관계없이 통과한다.
    if (ride.passengerId !== userId && ride.passengerUid !== userId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
    const driverId = ride.assignedDriverId || ''
    if (!driverId) return NextResponse.json({ error: 'not_assigned' }, { status: 409 })
    const service: SettlementService = ride.kind === 'daeri' ? 'daeri' : 'taxi'
    const amount = ride.estimatedFare
    // 멱등 — 같은 운행의 타 결제 완료가 이미 기록됐으면 저장된 onsitePayId를 돌려준다.
    const prior = (await listAltPayRecords({ userId })).find((row) => row.refId === `ride:${ride.id}` && row.status !== 'waived')
    if (prior) {
      const ledger = await altPayLedger(driverId)
      return NextResponse.json({ ok: true, record: prior, ledger, locked: Boolean(ledger?.lockedAt), onsitePayId: prior.onsitePayId || '' })
    }
    // 이미 Pi 정산·현장 정산 등으로 마감된 운행은 타 결제로 이중 청구하지 않는다.
    if (ride.status !== 'assigned') {
      return NextResponse.json({ error: ride.status === 'completed' ? 'already_completed' : 'not_active' }, { status: 409 })
    }
    const driver = getDriver(driverId)
    const target = driverPayoutTarget(driverId)
    // 기사가 현장에서 직접 수령한 것으로 기록 — 수수료는 플랫폼 미수가 아니라
    // 제공자 미입금 수수료 장부로 넘긴다(completeViaAltPay가 적립).
    const manual = await createManualPay({
      driverId,
      driverName: driver?.name || target.name,
      driverWallet: target.wallet,
      amount,
      memo: `타 결제 수단 이용 완료 (${method})`,
      rideId: ride.id,
    })
    await settleManualPayByDriver(manual.id, driverId).catch(() => null)
    const result = await completeViaAltPay({
      userId,
      service,
      refId: `ride:${ride.id}`,
      providerId: driverId,
      providerName: driver?.name || target.name,
      amount,
      method: method as 'card' | 'cash' | 'bank' | 'other',
      onsitePayId: manual.id,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 })
    return NextResponse.json({ ok: true, record: result.record, ledger: result.ledger, locked: result.locked, onsitePayId: manual.id })
  }

  const serviceRaw = typeof body?.service === 'string' ? body.service.trim() : ''
  const service = (SERVICES as string[]).includes(serviceRaw) ? (serviceRaw as SettlementService) : null
  const amount = Number(body?.amount)
  if (!service) return NextResponse.json({ error: 'service required' }, { status: 400 })
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000) {
    return NextResponse.json({ error: 'invalid_amount' }, { status: 400 })
  }
  // 제공자 식별은 기기 등록부가 원천 — deviceId가 있으면 소유자를 서버에서 해석한다.
  let providerId = typeof body?.providerId === 'string' ? body.providerId.trim() : ''
  let providerName = typeof body?.providerName === 'string' ? body.providerName.trim() : ''
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : ''
  if (deviceId) {
    const device = await getDevice(deviceId).catch(() => null)
    if (device?.ownerUid) {
      providerId = device.ownerUid
      providerName = device.ownerName || providerName
    }
  }
  if (!providerId) return NextResponse.json({ error: 'providerId required' }, { status: 400 })
  const result = await completeViaAltPay({
    userId,
    service,
    refId: typeof body?.refId === 'string' ? body.refId.trim() : `service:${deviceId || service}:${Date.now()}`,
    providerId,
    providerName,
    amount,
    method: method as 'card' | 'cash' | 'bank' | 'other',
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 })
  return NextResponse.json({ ok: true, record: result.record, ledger: result.ledger, locked: result.locked })
}
