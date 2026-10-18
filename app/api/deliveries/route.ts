import { NextResponse } from 'next/server'
import { createDeliveryDispatch, listAssignedByDriver, listDeliveriesByOwner, listOpenDeliveries, publicDelivery, setDeliveryPhotoCount, sweepExpiredDeliveries } from '@/lib/delivery-dispatch'
import { sanitizeAttachments, saveAttachments } from '@/lib/attachment-store'
import { notifyNearbyDeliveryDrivers } from '@/lib/delivery-push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // 매칭 마감이 지난 미배차 건을 먼저 만료 처리 — 목록은 항상 최신 상태로 내린다.
  await sweepExpiredDeliveries().catch(() => undefined)
  const params = new URL(request.url).searchParams
  const ownerId = params.get('ownerId')?.trim()
  // 기사에게 배정된 건 — 발신·수신 연락처가 함께 내려간다(publicDelivery viewer=기사).
  const driverId = params.get('driverId')?.trim()
  if (driverId) {
    return NextResponse.json({ ok: true, jobs: (await listAssignedByDriver(driverId)).map((job) => publicDelivery(job, driverId)) })
  }
  // 발신인 본인 목록(전체 상태) — 기사용 오픈 목록과 분기한다.
  if (ownerId) {
    return NextResponse.json({ ok: true, jobs: (await listDeliveriesByOwner(ownerId)).map((job) => publicDelivery(job, ownerId)) })
  }
  return NextResponse.json({ ok: true, jobs: (await listOpenDeliveries()).map((job) => publicDelivery(job)) })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const pickupAddress = typeof body?.pickupAddress === 'string' ? body.pickupAddress.trim() : ''
  const destAddress = typeof body?.destAddress === 'string' ? body.destAddress.trim() : ''
  if (!pickupAddress || !destAddress) {
    return NextResponse.json({ error: 'pickupAddress and destAddress required' }, { status: 400 })
  }
  const createdAt = new Date().toISOString()
  const job = await createDeliveryDispatch({
    id: typeof body?.id === 'string' && body.id.trim() ? body.id.trim() : crypto.randomUUID(),
    pickupAddress,
    destAddress,
    packageLabel: typeof body?.packageLabel === 'string' ? body.packageLabel : '택배',
    fare: Number.isFinite(Number(body?.fare)) ? Number(body?.fare) : 0,
    senderPhone: typeof body?.senderPhone === 'string' ? body.senderPhone : '',
    recipientPhone: typeof body?.recipientPhone === 'string' ? body.recipientPhone : '',
    ownerId: typeof body?.ownerId === 'string' ? body.ownerId.trim().slice(0, 80) : '',
    pickupLat: Number.isFinite(Number(body?.pickupLat)) ? Number(body?.pickupLat) : null,
    pickupLng: Number.isFinite(Number(body?.pickupLng)) ? Number(body?.pickupLng) : null,
    destLat: Number.isFinite(Number(body?.destLat)) ? Number(body?.destLat) : null,
    destLng: Number.isFinite(Number(body?.destLng)) ? Number(body?.destLng) : null,
    // 미래 시각만 예약으로 인정 — 과거/파싱 불가는 즉시 배송으로 정규화한다.
    scheduledAt: (() => {
      const raw = typeof body?.scheduledAt === 'string' ? Date.parse(body.scheduledAt) : NaN
      return Number.isFinite(raw) && raw > Date.now() ? new Date(raw).toISOString() : null
    })(),
    vehicle: typeof body?.vehicle === 'string' ? body.vehicle.trim().slice(0, 30) : '',
    packageSize: typeof body?.packageSize === 'string' ? body.packageSize.trim().slice(0, 30) : '',
    driverNote: typeof body?.driverNote === 'string' ? body.driverNote.trim().slice(0, 300) : '',
    createdAt,
  })
  // 물품 첨부 사진 — 검증 후 엔티티 id로 저장하고 장수만 기록한다.
  const photos = sanitizeAttachments(body?.photos)
  if (photos.length) {
    const saved = await saveAttachments(job.id, photos)
    if (saved.length) await setDeliveryPhotoCount(job.id, saved.length)
  }
  // 등록 즉시 수거지 근거리 온라인 택배 기사에게 웹 푸시 — 앱이 꺼져 있거나
  // 백그라운드여도 서비스 워커가 OS 알림으로 띄운다. 구독이 없는 기사는
  // sendDriverPush 내부에서 자동으로 건너뛴다.
  notifyNearbyDeliveryDrivers(job)
  return NextResponse.json({ ok: true, job: publicDelivery(job) })
}
