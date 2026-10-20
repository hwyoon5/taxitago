const fs = require('fs')
const load = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const save = (p, s) => fs.writeFileSync(p, s)
const need = (s, frag, label) => { if (!s.includes(frag)) throw new Error('MISSING ' + label) }

// ── 0. lib/sms-notify.ts — SMS/알림톡 연동 모듈(신규) ─────────────────────────
{
  const p = 'lib/sms-notify.ts'
  fs.writeFileSync(p, `/**
 * SMS/알림톡 발송 모듈.
 *
 * 공급자 연동은 웹훅 위임 — SMS_WEBHOOK_URL이 설정되면 { to, text }를 POST하고
 * SMS_WEBHOOK_TOKEN이 있으면 Bearer 인증을 붙인다. 미설정 환경에서는 서버
 * 로그로 대체해 호출부가 실패 없이 동작한다(개발·테스트 안전).
 */

const SMS_TIMEOUT_MS = 6000

export async function sendSmsText(to: string, text: string): Promise<'sent' | 'skipped' | 'failed'> {
  const target = to.replace(/[^0-9+]/g, '')
  if (!target) return 'skipped'
  const webhook = process.env.SMS_WEBHOOK_URL?.trim()
  if (!webhook) {
    console.log('[sms] provider not configured — message logged only', { to: target, text })
    return 'skipped'
  }
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SMS_WEBHOOK_TOKEN ? { Authorization: \`Bearer \${process.env.SMS_WEBHOOK_TOKEN}\` } : {}),
      },
      body: JSON.stringify({ to: target, text }),
      signal: AbortSignal.timeout(SMS_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn('[sms] provider rejected', { status: res.status, to: target })
      return 'failed'
    }
    return 'sent'
  } catch (error) {
    console.warn('[sms] provider unreachable', { error: String(error), to: target })
    return 'failed'
  }
}
`)
  console.log('0 ok')
}

// ── 1. accept route — 발신인 SMS 통보 ────────────────────────────────────────
{
  const p = 'app/api/deliveries/[id]/accept/route.ts'
  let s = load(p)
  need(s, `import { getRegistryUser } from '@/lib/user-registry'`, 'A1')
  s = s.replace(`import { getRegistryUser } from '@/lib/user-registry'`,
`import { getRegistryUser } from '@/lib/user-registry'
import { sendSmsText } from '@/lib/sms-notify'`)
  need(s, `  const job = result.job
  await recordSettlement({`, 'A2')
  s = s.replace(`  const job = result.job
  await recordSettlement({`,
`  const job = result.job
  // 발신인 SMS/알림톡 통보 — 공급자 미설정이면 로그만 남기고 응답은 지연 없이 반환.
  void sendSmsText(
    job.senderPhone,
    \`[TaxiTago] 택배 배차가 완료됐어요. \${job.driverName ?? '기사'} 기사(\${job.driverVehicle ?? ''} \${job.driverPlate ?? ''})\${job.driverPhone ? \` · \${job.driverPhone}\` : ''}\`,
  ).catch(() => undefined)
  await recordSettlement({`)
  save(p, s)
  console.log('1 ok')
}

const p = 'components/home-screen.tsx'
let s = load(p)

// ── 2. DeliveryCountdown 컴포넌트 — RouteSelectRow 앞에 추가 ─────────────────
need(s, `/**
 * 택시 홈 카드와 동일한 경로 행`, 'C1')
s = s.replace(`/**
 * 택시 홈 카드와 동일한 경로 행`,
`/** 예약 수거까지 남은 시간 — 1초 단위 카운트다운, 도래 시 상태 문구로 전환. */
function DeliveryCountdown({ at, className }: { at?: string | null; className?: string }) {
  const { t } = useLocale()
  const [remain, setRemain] = useState(() => (at ? Date.parse(at) - Date.now() : 0))
  useEffect(() => {
    if (!at) return
    const target = Date.parse(at)
    setRemain(target - Date.now())
    const timer = window.setInterval(() => setRemain(target - Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [at])
  if (!at) return null
  const total = Math.max(0, Math.floor(remain / 1000))
  const mm = Math.floor(total / 60)
  const ss = String(total % 60).padStart(2, '0')
  return (
    <p className={className ?? 'text-[11px] font-black text-[#4A82B8]'}>
      {remain <= 0 ? t('svc.delivDue') : t('svc.delivCountdown', { time: \`\${mm}분 \${ss}초\` })}
    </p>
  )
}

/**
 * 택시 홈 카드와 동일한 경로 행`)

// ── 3. 등록된 예약 시각 상태 + 생성 시 저장 ──────────────────────────────────
need(s, `  const [myDeliveriesOpen, setMyDeliveriesOpen] = useState(false)`, 'C3')
s = s.replace(`  const [myDeliveriesOpen, setMyDeliveriesOpen] = useState(false)`,
`  const [myDeliveriesOpen, setMyDeliveriesOpen] = useState(false)
  // 등록 완료된 예약 시각 — 매칭 화면의 카운트다운 타이머에 표시한다.
  const [registeredDeliveryAt, setRegisteredDeliveryAt] = useState<string | null>(null)`)

need(s, `      const job: DeliveryJob = {
        id: \`delivery-\${Date.now()}\`,`, 'C4')
s = s.replace(`      const job: DeliveryJob = {
        id: \`delivery-\${Date.now()}\`,`,
`      setRegisteredDeliveryAt(scheduledAt)
      const job: DeliveryJob = {
        id: \`delivery-\${Date.now()}\`,`)

// ── 4. 매칭 화면 카운트다운 ─────────────────────────────────────────────────
need(s, `            {ride ? (
              <TaxiLiveMap
                kind="daeri"`, 'C5')
s = s.replace(`            {ride ? (
              <TaxiLiveMap
                kind="daeri"`,
`            {service === '택배' && registeredDeliveryAt ? (
              <DeliveryCountdown at={registeredDeliveryAt} className="mt-3 text-sm font-black text-[#4A82B8]" />
            ) : null}
            {ride ? (
              <TaxiLiveMap
                kind="daeri"`)

// ── 5. 내 택배 목록 카운트다운 ──────────────────────────────────────────────
need(s, `                      {job.status === 'assigned' ? \` · \${t('svc.delivAssigned')}\` : ''}
                    </p>`, 'C6')
s = s.replace(`                      {job.status === 'assigned' ? \` · \${t('svc.delivAssigned')}\` : ''}
                    </p>`,
`                      {job.status === 'assigned' ? \` · \${t('svc.delivAssigned')}\` : ''}
                    </p>
                    {job.scheduledAt && job.status === 'requested' ? <DeliveryCountdown at={job.scheduledAt} className="mt-1 text-[11px] font-black text-[#4A82B8]" /> : null}`)

// ── 6. 발신인 배차 알림 폴링 — HomeScreen showNotice 뒤에 삽입 ──────────────
need(s, `  const showNotice = (message: string) => {`, 'C7')
s = s.replace(`  const showNotice = (message: string) => {`,
`  // 택배 배차 알림 — 기사 수락 시 발신인 앱에 즉시 토스트를 띄운다(12초 폴링).
  const deliveryStatusSeen = useRef(new Map<string, string>())
  useEffect(() => {
    let stopped = false
    const pull = () => {
      const ownerId = loadPiIdentity()?.uid || localPassengerId()
      if (!ownerId || stopped) return
      void fetchMyDeliveries(ownerId)
        .then((jobs) => {
          if (stopped) return
          for (const job of jobs) {
            const prev = deliveryStatusSeen.current.get(job.id)
            if (prev === 'requested' && job.status === 'assigned') {
              showNotice(
                t('svc.delivMatchedNotice', {
                  driver: job.driverName || t('match.driver'),
                  vehicle: \`\${job.driverVehicle ?? ''} \${job.driverPlate ?? ''}\`.trim(),
                }),
              )
            }
            deliveryStatusSeen.current.set(job.id, job.status)
          }
        })
        .catch(() => undefined)
    }
    pull()
    const timer = window.setInterval(pull, 12000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [])

  const showNotice = (message: string) => {`)

save(p, s)
console.log('home-screen ok')

// ── 7. i18n ──────────────────────────────────────────────────────────────────
{
  const keys = {
    'messages/ko.json': {
      'svc.delivCountdown': '수거 예정까지 {m}분 {s}초',
      'svc.delivDue': '수거 예정 시간입니다',
      'svc.delivMatchedNotice': '택배 배차 완료 — {driver} 기사({vehicle})가 수락했어요',
    },
    'messages/en.json': {
      'svc.delivCountdown': 'Pickup in {m}m {s}s',
      'svc.delivDue': 'Pickup time reached',
      'svc.delivMatchedNotice': 'Delivery assigned — {driver} ({vehicle}) accepted',
    },
    'messages/ja.json': {
      'svc.delivCountdown': '集荷まで {m}分 {s}秒',
      'svc.delivDue': '集荷予定時刻です',
      'svc.delivMatchedNotice': '配送が確定しました — {driver}（{vehicle}）が受諾しました',
    },
    'messages/zh.json': {
      'svc.delivCountdown': '取件倒计时 {m}分 {s}秒',
      'svc.delivDue': '已到取件时间',
      'svc.delivMatchedNotice': '快递已接单 — {driver}（{vehicle}）已接受',
    },
  }
  for (const [file, entries] of Object.entries(keys)) {
    const data = JSON.parse(load(file))
    Object.assign(data, entries)
    save(file, JSON.stringify(data, null, 2) + '\n')
  }
  console.log('i18n ok')
}
