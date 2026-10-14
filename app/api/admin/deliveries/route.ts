import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { listAllDeliveries } from '@/lib/delivery-dispatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 관리자 택배 이력 조회 — 상태 무관하게 전체 레코드를 날짜/상태/검색어로 필터한다.
 * from·to: YYYY-MM-DD (KST 하루 경계), status: requested|assigned|in_transit|completed,
 * q: 주소·연락처·기사명·id 부분 일치.
 */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const params = new URL(request.url).searchParams
  const from = params.get('from')?.trim() || ''
  const to = params.get('to')?.trim() || ''
  const status = params.get('status')?.trim() || ''
  const q = (params.get('q') || '').trim().toLowerCase()

  const fromMs = /^\d{4}-\d{2}-\d{2}$/.test(from) ? Date.parse(`${from}T00:00:00+09:00`) : -Infinity
  const toMs = /^\d{4}-\d{2}-\d{2}$/.test(to) ? Date.parse(`${to}T23:59:59.999+09:00`) : Infinity

  const items = listAllDeliveries()
    .filter((job) => {
      const at = Date.parse(job.createdAt)
      if (Number.isFinite(fromMs) && at < fromMs) return false
      if (Number.isFinite(toMs) && at > toMs) return false
      if (status && job.status !== status) return false
      if (q) {
        const hay = [job.pickupAddress, job.destAddress, job.senderPhone, job.recipientPhone, job.driverName, job.driverPhone, job.id]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    .map((job) => ({
      id: job.id,
      ownerId: job.ownerId || '',
      pickupAddress: job.pickupAddress,
      destAddress: job.destAddress,
      packageLabel: job.packageLabel,
      vehicle: job.vehicle ?? null,
      packageSize: job.packageSize ?? null,
      fare: job.fare,
      scheduledAt: job.scheduledAt ?? null,
      status: job.status,
      senderPhone: job.senderPhone,
      recipientPhone: job.recipientPhone,
      driverId: job.driverId,
      driverName: job.driverName,
      driverPhone: job.driverPhone ?? null,
      driverVehicle: job.driverVehicle,
      driverPlate: job.driverPlate,
      photoCount: job.photoCount ?? 0,
      paymentMethod: job.paymentMethod ?? null,
      paymentTxid: job.paymentTxid ?? null,
      paidAt: job.paidAt ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }))

  return NextResponse.json({ ok: true, total: items.length, generatedAt: new Date().toISOString(), items })
}
