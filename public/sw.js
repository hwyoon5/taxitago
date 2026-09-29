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
  const target = new URL(event.notification.data?.url || '/?driver=1', self.location.origin).href
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if (!client.url.startsWith(self.location.origin)) continue
      await client.focus()
      client.postMessage({ type: 'driver-offer' })
      return
    }
    await self.clients.openWindow(target)
  })())
})
