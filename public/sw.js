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
    for (const client of windows) client.postMessage({ type: 'driver-offer', offer: payload })
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
  const target = new URL(event.notification.data?.url || '/', self.location.origin)
  target.searchParams.set('driver', '1')
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
        next.postMessage({ type: 'driver-offer', offer: event.notification.data?.offer || lastOffer })
        await next.focus()
        return
      } catch {
        undefined
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(href)
  }))
})
