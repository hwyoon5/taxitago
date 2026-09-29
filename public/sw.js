self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = { title: '새로운 운행 요청', body: '수락 또는 거절해 주세요.', tag: 'taxitago-offer', url: '/?driver=1' }
  try {
    payload = { ...payload, ...(event.data ? event.data.json() : {}) }
  } catch {
    undefined
  }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    renotify: true,
    data: { url: payload.url || '/?driver=1' },
  }))
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
        next.postMessage({ type: 'driver-offer' })
        await next.focus()
        return
      } catch {
        undefined
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(href)
  }))
})
