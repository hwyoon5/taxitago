import { sendUserPush, type PushPayload } from '@/lib/driver-push'
import { recordPushLog } from '@/lib/push-store'
import { sendSmsText } from '@/lib/sms-notify'
import type { DeliveryDispatch } from '@/lib/delivery-dispatch'
import type { DriverRecord, RideRequestRecord } from '@/lib/dispatch-types'

/**
 * 서비스 상태 변화 → 이용자/기사 웹 푸시 이벤트 헬퍼.
 *
 * - 전부 베스트 에포트: 호출부는 `void notifyX()`로 발사하고 실패가 요청
 *   흐름을 막지 않는다.
 * - 모든 발송 시도는 pushlog( taxitago:pushlog )에 남아 관리자 모니터링이
 *   가능하다.
 * - 푸시가 구독 없음/실패로 못 갔을 때 PUSH_SMS_FALLBACK=1 + 수신 번호가
 *   있으면 SMS/알림톡 웹훅으로 대체 발송한다.
 */

const SMS_FALLBACK = process.env.PUSH_SMS_FALLBACK === '1'

async function deliver(
  ownerId: string,
  kind: string,
  payload: PushPayload,
  fallback?: { to?: string; text?: string },
) {
  const id = ownerId.trim()
  if (!id) return
  let status = 'no-subscription'
  try {
    // 발송 결과 로그는 sendUserPush 내부에서 기록한다.
    const result = await sendUserPush(id, payload, { kind })
    if (result.sent > 0) status = 'sent'
    else if (result.subscribed > 0) status = 'failed'
  } catch {
    status = 'failed'
  }
  if (status !== 'sent' && SMS_FALLBACK && fallback?.to && fallback?.text) {
    const sms = await sendSmsText(fallback.to, fallback.text).catch(() => 'failed' as const)
    void recordPushLog({
      ownerId: id,
      kind: 'sms-fallback',
      title: payload.title,
      status: sms === 'sent' ? 'sms-sent' : 'sms-failed',
      detail: `push ${status} → SMS ${sms}`,
    })
  }
}

/** 승객 — 기사 배정(매칭) 성사 알림. */
export async function notifyPassengerRideMatched(ride: RideRequestRecord, driver: DriverRecord) {
  const passengerId = ride.passengerId?.trim()
  if (!passengerId) return
  const vehicle = [driver.vehicle, driver.plate].filter(Boolean).join(' ') || '차량 정보 확인 중'
  await deliver(
    passengerId,
    'ride-matched',
    {
      type: 'user',
      title: '기사 배정 완료',
      body: `${driver.name || '기사'} 기사가 배정됐어요 · ${vehicle}`,
      tag: `taxitago-matched-${ride.id}`,
      url: '/',
      rideId: ride.id,
    },
    { text: `[TaxiTago] 기사 배정 완료 — ${driver.name || '기사'} · ${vehicle}` },
  )
}

/** 발신인 — 택배 기사 매칭 성사 알림. */
export async function notifyDeliveryMatched(job: DeliveryDispatch) {
  const ownerId = job.ownerId?.trim()
  if (!ownerId) return
  const driver = [job.driverName || '기사', job.driverVehicle, job.driverPlate].filter(Boolean).join(' · ')
  await deliver(
    ownerId,
    'delivery-matched',
    {
      type: 'user',
      title: '택배 배차 완료',
      body: `${driver} 기사가 수거를 진행해요 · ${job.pickupAddress} → ${job.destAddress}`,
      tag: `taxitago-delivery-matched-${job.id}`,
      url: '/',
      rideId: job.id,
    },
    {
      to: job.senderPhone,
      text: `[TaxiTago] 택배 배차 완료 — ${driver} · ${job.pickupAddress} → ${job.destAddress}`,
    },
  )
}

/** 발신인 — 택배 수거 완료(배송 시작) / 배송 완료 알림. */
export async function notifyDeliveryProgress(job: DeliveryDispatch, stage: 'picked_up' | 'delivered') {
  const ownerId = job.ownerId?.trim()
  if (!ownerId) return
  const title = stage === 'picked_up' ? '물품 수거 완료' : '배송 완료'
  const body =
    stage === 'picked_up'
      ? `${job.driverName || '기사'} 기사가 물품을 수거해 배송을 시작했어요`
      : `${job.packageLabel || '택배'} 배송이 완료됐어요 · ${job.destAddress}`
  await deliver(
    ownerId,
    'delivery-progress',
    {
      type: 'user',
      title,
      body,
      tag: `taxitago-delivery-${stage}-${job.id}`,
      url: '/',
      rideId: job.id,
    },
    { to: job.senderPhone, text: `[TaxiTago] ${title} — ${body}` },
  )
}

/** 이용자 — Pi 결제 완료 알림. */
export async function notifyPaymentCompleted(piUid: string, label: string, amountPi: number) {
  const uid = piUid.trim()
  if (!uid) return
  await deliver(uid, 'payment', {
    type: 'user',
    title: '결제 완료',
    body: `${label || '서비스 결제'} · ${amountPi.toFixed(2)} Pi 결제가 완료됐어요`,
    tag: `taxitago-pay-${uid}-${Date.now()}`,
    url: '/',
  })
}

/** 기사 — 에스크로/정산 완료 알림. */
export async function notifyDriverSettled(driverId: string, label: string, netPi: number) {
  const id = driverId.trim()
  if (!id) return
  await deliver(id, 'settlement', {
    type: 'user',
    title: '정산 완료',
    body: `${label || '운행'} 정산 ${netPi.toFixed(2)} Pi가 기사 지갑으로 처리됐어요`,
    tag: `taxitago-settle-${id}-${Date.now()}`,
    url: '/?driver=1',
  })
}
