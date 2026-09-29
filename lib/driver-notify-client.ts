import { apiFetch } from '@/lib/app-origin'

function urlBase64ToUint8Array(value: string) {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(padded)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

export async function enableDriverPush(driverId: string, requestPermission = false) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) return false
  if (Notification.permission === 'denied') return false
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : requestPermission
      ? await Notification.requestPermission()
      : 'default'
  if (permission !== 'granted') return false
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  const keyResponse = await apiFetch('/api/push/vapid')
  const keyPayload = (await keyResponse.json().catch(() => null)) as { publicKey?: string } | null
  const publicKey = keyPayload?.publicKey || ''
  if (!keyResponse.ok || !publicKey) return false
  const current = await registration.pushManager.getSubscription()
  const subscription = current ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })
  const saved = await apiFetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId, subscription }),
  })
  return saved.ok
}

export async function showDriverOfferNotification(rideId: string, body: string) {
  if (typeof window === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return
  const registration = await navigator.serviceWorker.getRegistration()
  const options = {
    body,
    tag: `taxitago-offer-${rideId}`,
    renotify: true,
    data: { url: '/?driver=1' },
  }
  if (registration) await registration.showNotification('새로운 운행 요청', options)
  else new Notification('새로운 운행 요청', { body, tag: `taxitago-offer-${rideId}` })
}
