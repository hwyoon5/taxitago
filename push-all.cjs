const fs = require('fs')
const load = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const save = (p, s) => fs.writeFileSync(p, s)
const need = (s, frag, label) => { if (!s.includes(frag)) throw new Error('MISSING ' + label) }
const rep = (s, a, b, label) => { need(s, a, label); return s.split(a).join(b) }

// ── 1. lib/driver-push.ts — 페이로드에 서비스 유형 필드 ──────────────────────
{
  const p = 'lib/driver-push.ts'
  let s = load(p)
  s = rep(s, `type PushPayload = {
  title: string`,
`type PushPayload = {
  /** 콜 유형 — 'ride'(택시/대리) | 'delivery'(택배). sw가 이 값으로
   *  포그라운드 메시지 채널을 구분한다. 미설정은 'ride'로 간주. */
  type?: 'ride' | 'delivery'
  title: string`, 'A1')
  save(p, s)
  console.log('1 ok')
}

// ── 2. app/api/deliveries/route.ts — 등록 시 근거리 택배 기사 푸시 ──────────
{
  const p = 'app/api/deliveries/route.ts'
  let s = load(p)
  s = rep(s, `import { createDeliveryDispatch, listAssignedByDriver, listDeliveriesByOwner, listOpenDeliveries, publicDelivery } from '@/lib/delivery-dispatch'`,
`import { createDeliveryDispatch, listAssignedByDriver, listDeliveriesByOwner, listOpenDeliveries, publicDelivery } from '@/lib/delivery-dispatch'
import { listDrivers, syncDispatchFromDisk } from '@/lib/dispatch-store'
import { haversineKm } from '@/lib/dispatch-geo'
import { sendDriverPush } from '@/lib/driver-push'`, 'B1')

  s = rep(s, `  return NextResponse.json({ ok: true, job: publicDelivery(job) })
}`,
`  // 등록 즉시 수거지 근거리 온라인 택배 기사에게 웹 푸시 — 앱이 꺼져 있거나
  // 백그라운드여도 서비스 워커가 OS 알림으로 띄운다. 구독이 없는 기사는
  // sendDriverPush 내부에서 자동으로 건너뛴다.
  const DELIVERY_PUSH_NEAR_KM = 8
  if (job.pickupLat != null && job.pickupLng != null) {
    try {
      syncDispatchFromDisk()
      const pickup = { lat: Number(job.pickupLat), lng: Number(job.pickupLng) }
      for (const driver of listDrivers()) {
        if (driver.status !== 'online' || driver.serviceType !== '택배' || driver.virtual) continue
        if (!Number.isFinite(driver.lat) || haversineKm(driver, pickup) > DELIVERY_PUSH_NEAR_KM) continue
        void sendDriverPush(driver.id, {
          type: 'delivery',
          title: '새 택배 배송 등록',
          body: \`\${job.pickupAddress} → \${job.destAddress} · \${job.fare.toFixed(1)} Pi\`,
          tag: \`taxitago-delivery-\${job.id}\`,
          url: '/?driver=1',
          rideId: job.id,
          expiresAt: job.scheduledAt ?? undefined,
        }).catch(() => undefined)
      }
    } catch (error) {
      console.warn('[deliveries] near-driver push failed', error)
    }
  }
  return NextResponse.json({ ok: true, job: publicDelivery(job) })
}`, 'B2')
  save(p, s)
  console.log('2 ok')
}

// ── 3. public/sw.js — 콜 유형별 포그라운드 메시지 분기 ──────────────────────
{
  const p = 'public/sw.js'
  let s = load(p)
  s = rep(s, `    for (const client of windows) client.postMessage({ type: 'driver-offer', offer: payload })`,
`    const channel = payload.type === 'delivery' ? 'delivery-offer' : 'driver-offer'
    for (const client of windows) client.postMessage({ type: channel, offer: payload })`, 'C1')
  s = rep(s, `        next.postMessage({ type: 'driver-offer', offer: event.notification.data?.offer || lastOffer })`,
`        const offer = event.notification.data?.offer || lastOffer
        next.postMessage({ type: offer?.type === 'delivery' ? 'delivery-offer' : 'driver-offer', offer })`, 'C2')
  save(p, s)
  console.log('3 ok')
}

// ── 4. home-screen.tsx ──────────────────────────────────────────────────────
const p = 'components/home-screen.tsx'
let s = load(p)

// 4a. 기사 모드 진입 시점 — 권한 요청 + 푸시 구독(제스처 컨텍스트).
s = rep(s, `  const enterDriverMode = () => {
    setDriverMode(true)`,
`  const enterDriverMode = () => {
    // 기사 모드 진입 시점에 알림 권한·푸시 구독을 활성화한다 — 사용자 제스처
    // 컨텍스트 안이라 브라우저 권한 팝업이 허용된다. 모든 서비스 콜이
    // 이 구독으로 들어온다(택시/대리 오퍼·택배 근거리 등록).
    void enableDriverPush(localDriverId(loadPartnerProfile()?.uid), true).catch(() => undefined)
    setDriverMode(true)`, 'D1')

// 4b. 택배 오픈 목록 폴링 — 'delivery-offer' 푸시 수신 시 즉시 갱신.
s = rep(s, `    pull()
    const timer = window.setInterval(pull, 2000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [online, partner?.serviceType])`,
`    // 푸시로 깨운 포그라운드 — 2초 폴링을 기다리지 않고 즉시 새 목록을 당긴다.
    const onPush = (event: MessageEvent) => {
      if (event.data?.type === 'delivery-offer') pull()
    }
    navigator.serviceWorker?.addEventListener('message', onPush)
    pull()
    const timer = window.setInterval(pull, 2000)
    return () => {
      stopped = true
      window.clearInterval(timer)
      navigator.serviceWorker?.removeEventListener('message', onPush)
    }
  }, [online, partner?.serviceType])`, 'D2')

save(p, s)
console.log('4 ok')
