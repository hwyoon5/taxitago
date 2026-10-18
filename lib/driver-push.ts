import webpush from 'web-push'
import {
  listPushSubscriptions,
  recordPushLog,
  removePushSubscription,
  savePushSubscription,
  subscribedOwnerIds,
  type PushSubRole,
} from '@/lib/push-store'

export type DriverPushSubscription = {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}

export type PushPayload = {
  /** 콜 유형 — 'ride'(택시/대리) | 'delivery'(택배) | 'user'(이용자 이벤트).
   *  sw가 이 값으로 포그라운드 메시지 채널·클릭 동작을 구분한다.
   *  미설정은 'ride'로 간주. */
  type?: 'ride' | 'delivery' | 'user'
  title: string
  body: string
  tag: string
  url: string
  rideId?: string
  expiresAt?: string
  pickupDistanceKm?: number
  ride?: {
    id: string
    passengerId: string
    kind?: 'taxi' | 'daeri'
    /** 승객이 고른 차량 등급 — 기사 오퍼 카드의 티어 배지에 표시. */
    tier?: string
    pickup: { lat: number; lng: number; address?: string; label?: string }
    waypoints?: { lat: number; lng: number; address?: string; label?: string }[]
    dest: { lat: number; lng: number; address?: string; label?: string }
    estimatedFare: number
    avoidSurchargePi?: number
    tollPi?: number
    tollKrw?: number | null
  }
}

type PushKeys = {
  publicKey: string
  privateKey: string
}

const SUBJECT = (process.env.VAPID_SUBJECT || 'mailto:grace837100@gmail.com').trim()

function keys(): PushKeys {
  const globalStore = globalThis as typeof globalThis & { __taxitagoDriverPush?: PushKeys }
  if (!globalStore.__taxitagoDriverPush) {
    const fromEnv = (process.env.VAPID_PUBLIC_KEY || '').trim()
    const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim()
    const generated = fromEnv && privateKey ? null : webpush.generateVAPIDKeys()
    globalStore.__taxitagoDriverPush = {
      publicKey: fromEnv || generated?.publicKey || '',
      privateKey: privateKey || generated?.privateKey || '',
    }
    if (globalStore.__taxitagoDriverPush.publicKey && globalStore.__taxitagoDriverPush.privateKey) {
      webpush.setVapidDetails(SUBJECT, globalStore.__taxitagoDriverPush.publicKey, globalStore.__taxitagoDriverPush.privateKey)
    }
  }
  return globalStore.__taxitagoDriverPush
}

export function getVapidPublicKey() {
  return keys().publicKey
}

function isSubscription(value: unknown): value is DriverPushSubscription {
  if (!value || typeof value !== 'object') return false
  const record = value as DriverPushSubscription
  return typeof record.endpoint === 'string' && record.endpoint.startsWith('https://') && Boolean(record.keys?.p256dh) && Boolean(record.keys?.auth)
}

export async function saveDriverPushSubscription(driverId: string, subscription: unknown, role: PushSubRole = 'driver') {
  if (!isSubscription(subscription)) return false
  return savePushSubscription(driverId, subscription, role)
}

/** 푸시 구독이 등록된 계정 id 목록 — 관리자 방송 알림의 발송 대상 열거용.
 *  role을 주면 해당 역할 구독을 가진 계정만 돌려준다. */
export function subscribedDriverIds(role?: PushSubRole): Promise<string[]> {
  return subscribedOwnerIds(role)
}

export async function removeDriverPushSubscription(driverId: string, endpoint?: string) {
  await removePushSubscription(driverId, endpoint)
}

export type PushSendResult = {
  /** 등록된 구독 수 */
  subscribed: number
  /** 발송 성공 수 */
  sent: number
  /** 만료돼 제거된 구독 수 */
  removed: number
  /** 기타 실패 수 */
  failed: number
}

/**
 * 계정(ownerId: 기사 id 또는 이용자 Pi uid)의 모든 구독 단말에 웹 푸시를
 * 보낸다. 구독이 없거나 VAPID 키가 없으면 아무것도 하지 않는다.
 */
export async function sendUserPush(ownerId: string, payload: PushPayload, opts?: { kind?: string }): Promise<PushSendResult> {
  const result: PushSendResult = { subscribed: 0, sent: 0, removed: 0, failed: 0 }
  const store = keys()
  const id = ownerId.trim()
  const finish = () => {
    // kind가 주어진 발송은 관리자 모니터링용 발송 로그에 남긴다.
    if (opts?.kind) {
      void recordPushLog({
        ownerId: id,
        kind: opts.kind,
        title: payload.title,
        status: result.sent > 0 ? 'sent' : result.subscribed > 0 ? 'failed' : 'no-subscription',
        detail: payload.body.slice(0, 160),
      }).catch(() => undefined)
    }
    return result
  }
  if (!store.publicKey || !store.privateKey || !id) return finish()
  const targets = await listPushSubscriptions(id).catch(() => [])
  result.subscribed = targets.length
  if (!targets.length) return finish()
  const body = JSON.stringify(payload)
  await Promise.all(targets.map(async (subscription) => {
    try {
      await webpush.sendNotification(subscription, body)
      result.sent += 1
    } catch (error) {
      const status = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 0
      if (status === 404 || status === 410) {
        result.removed += 1
        await removePushSubscription(ownerId, subscription.endpoint).catch(() => undefined)
      } else {
        result.failed += 1
        console.error('[push] delivery failed', status || 'unknown')
      }
    }
  }))
  return finish()
}

export async function sendDriverPush(driverId: string, payload: PushPayload, kind?: string) {
  await sendUserPush(driverId, payload, kind ? { kind } : undefined).catch(() => undefined)
}
