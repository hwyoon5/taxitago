import { listDrivers, syncDispatchFromDisk } from '@/lib/dispatch-store'
import { haversineKm } from '@/lib/dispatch-geo'
import { sendDriverPush } from '@/lib/driver-push'
import { driverDeliveryEligible } from '@/lib/partner-services'
import { complianceGate } from '@/lib/compliance-store'
import { getRegistryUser } from '@/lib/user-registry'
import { DRIVER_STALE_MS } from '@/lib/dispatch-types'
import type { DeliveryDispatch } from '@/lib/delivery-dispatch'

const DELIVERY_PUSH_NEAR_KM = 8

/**
 * 새 택배 콜(등록·재등록)을 수거지 근거리 온라인 택배 기사에게 웹 푸시로 알린다.
 * 구독이 없는 기사는 sendDriverPush 내부에서 건너뛰고, 실패해도 호출 흐름을 막지 않는다.
 */
export async function notifyNearbyDeliveryDrivers(job: DeliveryDispatch) {
  if (job.pickupLat == null || job.pickupLng == null) return
  try {
    syncDispatchFromDisk()
    const pickup = { lat: Number(job.pickupLat), lng: Number(job.pickupLng) }
    for (const driver of listDrivers()) {
      // 택배 역할 + 차량 체급 자격 — 겸직 기사는 serviceRoles, 전업은 serviceType으로 판정.
      if (driver.status !== 'online' || driver.virtual) continue
      // presence 게이트(정지·자격 인증)가 비트를 차단한 기사는 하트비트가
      // 멈춰 레코드가 'online'으로 남아도 곧 stale가 된다 — 푸시도 건너뛴다.
      if (Date.now() - Date.parse(driver.lastSeenAt) > DRIVER_STALE_MS) continue
      if (!driverDeliveryEligible(driver, job)) continue
      if (!Number.isFinite(driver.lat) || haversineKm(driver, pickup) > DELIVERY_PUSH_NEAR_KM) continue
      // 자격 인증 게이트 — 등록 계정의 필수 증빙이 승인되지 않으면 푸시 제외.
      // 미등록 테스트넷 단말은 기존처럼 허용한다.
      const regUser = await getRegistryUser(driver.piUid || driver.id).catch(() => null)
      if (regUser && !regUser.withdrawnAt) {
        const gate = await complianceGate(regUser).catch(() => null)
        if (gate && !gate.ok) continue
      }
      void sendDriverPush(driver.id, {
        type: 'delivery',
        title: '새 택배 배송 등록',
        body: `${job.pickupAddress} → ${job.destAddress} · ${job.fare.toFixed(1)} Pi`,
        tag: `taxitago-delivery-${job.id}`,
        url: '/?driver=1',
        rideId: job.id,
        expiresAt: job.scheduledAt ?? undefined,
      }, 'offer').catch(() => undefined)
    }
  } catch (error) {
    console.warn('[deliveries] near-driver push failed', error)
  }
}
