const fs = require('fs')
const load = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const save = (p, s) => fs.writeFileSync(p, s)
const need = (s, frag, label) => { if (!s.includes(frag)) throw new Error('MISSING ' + label) }
const rep = (s, a, b, label) => { need(s, a, label); return s.split(a).join(b) }

const p = 'components/home-screen.tsx'
let s = load(p)

// ── 1. 휠 피커 컴포넌트 — DeliveryCountdown 앞에 삽입 ────────────────────────
s = rep(s, `/** 예약 수거까지 남은 시간 — 1초 단위 카운트다운, 도래 시 상태 문구로 전환. */`,
`const DELIVERY_SCHEDULE_OPTIONS = [0, 10, 20, 30, 40, 50, 60, 90, 120]

/** 발송 예정 시간 휠 피커 — 세로 스크롤 스냅으로 분 단위를 고른다. */
function MinuteWheelPicker({ value, options, onChange }: { value: number; options: number[]; onChange: (min: number) => void }) {
  const { t } = useLocale()
  const boxRef = useRef<HTMLDivElement>(null)
  const scrollTimer = useRef<number | undefined>(undefined)
  const ITEM_H = 40
  // 직접 입력 등 외부에서 값이 바뀌면 해당 항목으로 스크롤을 맞춘다.
  useEffect(() => {
    const idx = options.indexOf(value)
    const el = boxRef.current
    if (el && idx >= 0 && Math.abs(el.scrollTop - idx * ITEM_H) > 2) el.scrollTop = idx * ITEM_H
  }, [value, options])
  const onScroll = () => {
    window.clearTimeout(scrollTimer.current)
    scrollTimer.current = window.setTimeout(() => {
      const el = boxRef.current
      if (!el) return
      const idx = Math.max(0, Math.min(options.length - 1, Math.round(el.scrollTop / ITEM_H)))
      el.scrollTo({ top: idx * ITEM_H, behavior: 'smooth' })
      if (options[idx] !== value) onChange(options[idx])
    }, 120)
  }
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-10 -translate-y-1/2 rounded-xl border-2 border-[#4A82B8] bg-[#E8F1FA]/60" />
      <div
        ref={boxRef}
        onScroll={onScroll}
        className="max-h-[120px] snap-y snap-mandatory overflow-y-auto rounded-xl bg-[#F8FAFC] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ paddingTop: ITEM_H, paddingBottom: ITEM_H }}
      >
        {options.map((min) => (
          <div key={min} className={\`flex h-10 snap-center items-center justify-center text-sm font-black \${min === value ? 'text-[#2D5F8A]' : 'text-[#94A3B8]'}\`}>
            {min === 0 ? t('svc.delivNow') : t('svc.delivAfter', { min: String(min) })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** 예약 수거까지 남은 시간 — 1초 단위 카운트다운, 도래 시 상태 문구로 전환. */`, 'P1')

// ── 2. 고정 버튼 그리드 → 휠 피커 + 직접 입력 ────────────────────────────────
s = rep(s, `              <p className="mb-2 mt-3 text-sm font-black">{t('svc.delivSched')}</p>
              <div className="grid grid-cols-4 gap-2">
                {[0, 10, 30, 60].map((min) => (
                  <button
                    key={min}
                    type="button"
                    onClick={() => setDeliverySchedule(min)}
                    className={\`rounded-xl border-2 py-2 text-[11px] font-black \${deliverySchedule === min ? 'border-[#4A82B8] bg-[#4A82B8] text-white' : 'border-[#BFDBFE] bg-[#E8F1FA] text-[#4A82B8]'}\`}
                  >
                    {min === 0 ? t('svc.delivNow') : t('svc.delivAfter', { min: String(min) })}
                  </button>
                ))}
              </div>`,
`              <p className="mb-2 mt-3 text-sm font-black">{t('svc.delivSched')}</p>
              <MinuteWheelPicker value={deliverySchedule} options={DELIVERY_SCHEDULE_OPTIONS} onChange={setDeliverySchedule} />
              <div className="mt-2 flex items-center gap-2 rounded-xl border-2 border-[#BFDBFE] bg-white px-3 py-2">
                <Clock className="h-4 w-4 shrink-0 text-[#4A82B8]" />
                <input
                  type="number"
                  min={0}
                  max={240}
                  inputMode="numeric"
                  value={deliverySchedule}
                  onChange={(event) => setDeliverySchedule(Math.max(0, Math.min(240, Math.floor(Number(event.target.value) || 0))))}
                  aria-label={t('svc.delivDirectMin')}
                  className="w-16 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-1 text-center text-sm font-black text-[#0F172A] outline-none"
                />
                <span className="text-[11px] font-bold text-[#64748B]">{t('svc.delivDirectMin')}</span>
              </div>`, 'P2')

// ── 3. 등록 전용 플로 — 매칭 화면 진입 제거, 목록 저장 후 리턴 ────────────────
s = rep(s, `      setRegisteredDeliveryAt(scheduledAt)
      const job: DeliveryJob = {`,
`      const job: DeliveryJob = {`, 'P3a')

s = rep(s, `      saveDeliveryJob(job)
      onDeliveryCreated?.(job)
      void publishDelivery(job).then((published) => {
        deliveryServerId.current = published.id
      }).catch(() => undefined)
      setPhoneError('')
    }`,
`      setPhoneError('')
      // 등록만 수행 — 매칭 화면으로 넘어가지 않고 '내 택배' 목록에 저장한다.
      // 기사가 목록에서 수락하는 순간 발신인 알림·SMS가 발송된다.
      void publishDelivery(job)
        .then(() => {
          refreshMyDeliveries()
          setMyDeliveriesOpen(true)
          onNotice(t('svc.delivRegistered'))
        })
        .catch((error) => onNotice(error instanceof Error ? error.message : t('svc.delivRegistered')))
      return
    }`, 'P3b')

// ── 4. registeredDeliveryAt 상태·매칭 화면 카운트다운 정리 ───────────────────
s = rep(s, `  // 등록 완료된 예약 시각 — 매칭 화면의 카운트다운 타이머에 표시한다.
  const [registeredDeliveryAt, setRegisteredDeliveryAt] = useState<string | null>(null)
`, '', 'P4a')

s = rep(s, `            {service === '택배' && registeredDeliveryAt ? (
              <DeliveryCountdown at={registeredDeliveryAt} className="mt-3 text-sm font-black text-[#4A82B8]" />
            ) : null}
`, '', 'P4b')

// ── 5. 미사용 임포트 정리(saveDeliveryJob) ───────────────────────────────────
if (!s.includes('saveDeliveryJob(')) {
  s = s.replace('loadDeliveryJob, publishDelivery, saveDeliveryJob, updateDelivery', 'loadDeliveryJob, publishDelivery, updateDelivery')
}

save(p, s)
console.log('home-screen ok')

// ── 6. i18n ──────────────────────────────────────────────────────────────────
{
  const keys = {
    'messages/ko.json': {
      'svc.delivBtn': '택배(배송) 등록하기',
      'svc.delivDirectMin': '직접 입력(분 후 발송)',
      'svc.delivRegistered': '택배가 등록됐어요 — 기사가 수락하면 알림을 보내드려요',
    },
    'messages/en.json': {
      'svc.delivBtn': 'Register delivery',
      'svc.delivDirectMin': 'Custom (minutes later)',
      'svc.delivRegistered': 'Delivery registered — we will notify you when a driver accepts',
    },
    'messages/ja.json': {
      'svc.delivBtn': '配送を登録する',
      'svc.delivDirectMin': '直接入力（分後）',
      'svc.delivRegistered': '配送を登録しました — ドライバーが受諾したらお知らせします',
    },
    'messages/zh.json': {
      'svc.delivBtn': '登记快递',
      'svc.delivDirectMin': '自定义（分钟后）',
      'svc.delivRegistered': '快递已登记 — 司机接单后会通知您',
    },
  }
  for (const [file, entries] of Object.entries(keys)) {
    const data = JSON.parse(load(file))
    Object.assign(data, entries)
    save(file, JSON.stringify(data, null, 2) + '\n')
  }
  console.log('i18n ok')
}
