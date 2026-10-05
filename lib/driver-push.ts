import webpush from 'web-push'

export type DriverPushSubscription = {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}

type PushPayload = {
  title: string
  body: string
  tag: string
  url: string
  rideId: string
  expiresAt?: string
  pickupDistanceKm?: number
  ride?: {
    id: string
    passengerId: string
    kind?: 'taxi' | 'daeri'
    pickup: { lat: number; lng: number; address?: string; label?: string }
    waypoints?: { lat: number; lng: number; address?: string; label?: string }[]
    dest: { lat: number; lng: number; address?: string; label?: string }
    estimatedFare: number
  }
}

type PushDb = {
  publicKey: string
  privateKey: string
  subscriptions: Map<string, DriverPushSubscription[]>
}

const SUBJECT = (process.env.VAPID_SUBJECT || 'mailto:grace837100@gmail.com').trim()

function db(): PushDb {
  const globalStore = globalThis as typeof globalThis & { __taxitagoDriverPush?: PushDb }
  if (!globalStore.__taxitagoDriverPush) {
    const fromEnv = (process.env.VAPID_PUBLIC_KEY || '').trim()
    const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim()
    const generated = fromEnv && privateKey ? null : webpush.generateVAPIDKeys()
    globalStore.__taxitagoDriverPush = {
      publicKey: fromEnv || generated?.publicKey || '',
      privateKey: privateKey || generated?.privateKey || '',
      subscriptions: new Map(),
    }
    if (globalStore.__taxitagoDriverPush.publicKey && globalStore.__taxitagoDriverPush.privateKey) {
      webpush.setVapidDetails(SUBJECT, globalStore.__taxitagoDriverPush.publicKey, globalStore.__taxitagoDriverPush.privateKey)
    }
  }
  return globalStore.__taxitagoDriverPush
}

export function getVapidPublicKey() {
  return db().publicKey
}

function isSubscription(value: unknown): value is DriverPushSubscription {
  if (!value || typeof value !== 'object') return false
  const record = value as DriverPushSubscription
  return typeof record.endpoint === 'string' && record.endpoint.startsWith('https://') && Boolean(record.keys?.p256dh) && Boolean(record.keys?.auth)
}

export function saveDriverPushSubscription(driverId: string, subscription: unknown) {
  const id = driverId.trim()
  if (!id || !isSubscription(subscription)) return false
  const store = db()
  const current = store.subscriptions.get(id) ?? []
  const next = [subscription, ...current.filter((item) => item.endpoint !== subscription.endpoint)].slice(0, 5)
  store.subscriptions.set(id, next)
  return true
}

export function removeDriverPushSubscription(driverId: string, endpoint?: string) {
  const id = driverId.trim()
  const store = db()
  if (!endpoint) {
    store.subscriptions.delete(id)
    return
  }
  const next = (store.subscriptions.get(id) ?? []).filter((item) => item.endpoint !== endpoint)
  if (next.length) store.subscriptions.set(id, next)
  else store.subscriptions.delete(id)
}

export async function sendDriverPush(driverId: string, payload: PushPayload) {
  const store = db()
  const targets = store.subscriptions.get(driverId.trim()) ?? []
  if (!targets.length || !store.publicKey || !store.privateKey) return
  const body = JSON.stringify(payload)
  await Promise.all(targets.map(async (subscription) => {
    try {
      await webpush.sendNotification(subscription, body)
    } catch (error) {
      const status = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 0
      if (status === 404 || status === 410) removeDriverPushSubscription(driverId, subscription.endpoint)
      else console.error('[push] delivery failed', status || 'unknown')
    }
  }))
}
