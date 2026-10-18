self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

let lastOffer = null

function rememberOffer(payload) {
  const expiresAt = Date.parse(payload?.expiresAt || payload?.ride?.offerExpiresAt || '')
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return null
  lastOffer = payload
  return payload
}

self.addEventListener('push', (event) => {
  let payload = { title: '새로운 운행 요청', body: '수락 또는 거절해 주세요.', tag: 'taxitago-offer', url: '/?driver=1' }
  try {
    payload = { ...payload, ...(event.data ? event.data.json() : {}) }
  } catch {
    undefined
  }
  rememberOffer(payload)
  const notice = { url: payload.url || '/?driver=1', offer: payload }
  event.waitUntil((async () => {
    await self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      renotify: true,
      vibrate: [450, 150, 450, 150, 700],
      data: notice,
    })
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const channel = payload.type === 'delivery' ? 'delivery-offer' : payload.type === 'user' ? 'user-notify' : 'driver-offer'
    for (const client of windows) client.postMessage({ type: channel, offer: payload })
  })())
})

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'driver-offer-sync' || !lastOffer) return
  const expiresAt = Date.parse(lastOffer.expiresAt || '')
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    lastOffer = null
    return
  }
  event.source?.postMessage({ type: 'driver-offer', offer: lastOffer })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const offer = event.notification.data?.offer || lastOffer
  // 기사 콜 알림만 기사 콘솔로 라우팅 — 이용자 이벤트('user')는 페이로드의
  // url을 그대로 열어 승객 화면에 머물게 한다.
  const isDriverCall = offer?.type === 'ride' || offer?.type === 'delivery'
  const target = new URL(event.notification.data?.url || '/', self.location.origin)
  if (isDriverCall) target.searchParams.set('driver', '1')
  const href = target.href

  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windowClients) => {
    const appClients = windowClients.filter((client) => {
      try {
        return new URL(client.url).origin === self.location.origin
      } catch {
        return false
      }
    })
    for (const client of appClients) {
      try {
        const next = typeof client.navigate === 'function' ? (await client.navigate(href)) || client : client
        next.postMessage({ type: offer?.type === 'delivery' ? 'delivery-offer' : offer?.type === 'user' ? 'user-notify' : 'driver-offer', offer })
        await next.focus()
        return
      } catch {
        undefined
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(href)
  }))
})
