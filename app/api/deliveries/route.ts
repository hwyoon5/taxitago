import { NextResponse } from 'next/server'
import { createDeliveryDispatch, listAssignedByDriver, listDeliveriesByOwner, listOpenDeliveries, publicDelivery, setDeliveryPhotoCount, sweepExpiredDeliveries } from '@/lib/delivery-dispatch'
import { sanitizeAttachments, saveAttachments } from '@/lib/attachment-store'
import { notifyNearbyDeliveryDrivers } from '@/lib/delivery-push'
import { driverDeliveryEligible } from '@/lib/partner-services'
import { getRegistryUser } from '@/lib/user-registry'
import { complianceGate } from '@/lib/compliance-store'
import { fdsBlockStatus, recordFdsSignal } from '@/lib/fds-store'

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
  // 기사 매칭 풀 — 등록 계정이면 겸직 역할·허용 차량 체급에 맞는 콜만 내린다.
  // 레지스트리에 없는 단말(테스트넷 개발 기기)은 기존처럼 전체 목록을 돌려준다.
  const forDriver = params.get('forDriver')?.trim()
  if (forDriver) {
    const user = await getRegistryUser(forDriver).catch(() => null)
    // 자격 인증 미완료·반려 계정은 매칭 풀이 비어 내려간다.
    const gate = user && !user.withdrawnAt ? await complianceGate(user).catch(() => null) : null
    if (gate && !gate.ok) return NextResponse.json({ ok: true, jobs: [] })
    const jobs = (await listOpenDeliveries()).filter((job) => (user ? driverDeliveryEligible(user, job) : true))
    return NextResponse.json({ ok: true, jobs: jobs.map((job) => publicDelivery(job)) })
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
  // FDS — 차단 계정은 등록 불가, 반복 등록은 콜 플러드 룰로 집계한다.
  const ownerIdRaw = typeof body?.ownerId === 'string' ? body.ownerId.trim() : ''
  if (ownerIdRaw) {
    const fds = await fdsBlockStatus(ownerIdRaw).catch(() => null)
    if (fds?.blocked) {
      return NextResponse.json(
        { error: '비정상 이용 패턴이 감지되어 일시적으로 제한됐습니다.', fdsBlocked: true, until: fds.until },
        { status: 403 },
      )
    }
    void recordFdsSignal('ride-flood', { actorId: ownerIdRaw, detail: `택배 등록 · ${pickupAddress} → ${destAddress}` }).catch(() => undefined)
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
