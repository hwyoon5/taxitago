const fs = require('fs')
const load = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const save = (p, s) => fs.writeFileSync(p, s)
const need = (s, frag, label) => { if (!s.includes(frag)) throw new Error('MISSING ' + label) }

const p = 'components/home-screen.tsx'
let s = load(p)

// ── 1. import ────────────────────────────────────────────────────────────────
need(s, `import { acceptDelivery, deleteDelivery, fetchDelivery, fetchMyDeliveries, fetchOpenDeliveries, loadDeliveryJob, publishDelivery, saveDeliveryJob, updateDelivery,`, 'U1')
s = s.replace(`import { acceptDelivery, deleteDelivery, fetchDelivery, fetchMyDeliveries, fetchOpenDeliveries, loadDeliveryJob, publishDelivery, saveDeliveryJob, updateDelivery,`,
`import { acceptDelivery, deleteDelivery, fetchAcceptedDeliveries, fetchDelivery, fetchMyDeliveries, fetchOpenDeliveries, loadDeliveryJob, publishDelivery, saveDeliveryJob, updateDelivery,`)

// ── 2. courier 상태에 phone ──────────────────────────────────────────────────
need(s, `const [courier, setCourier] = useState<{ name: string; vehicle: string; plate: string } | null>(null)`, 'U2')
s = s.replace(`const [courier, setCourier] = useState<{ name: string; vehicle: string; plate: string } | null>(null)`,
`const [courier, setCourier] = useState<{ name: string; vehicle: string; plate: string; phone?: string } | null>(null)`)

need(s, `phone: '', kind: 'driver' as const }
        : { name: selectedUsage?.name || service`, 'U3')
s = s.replace(`phone: '', kind: 'driver' as const }
        : { name: selectedUsage?.name || service`,
`phone: courier?.phone || '', kind: 'driver' as const }
        : { name: selectedUsage?.name || service`)

// ── 3. 배정 폴링 — viewer로 발신인 전달해 기사 연락처 수신 ──────────────────
need(s, `      void fetchDelivery(id).then((job) => {
        if (stopped || !job || job.status !== 'assigned' || !job.driverVehicle || !job.driverPlate) return
        setCourier({ name: job.driverName || t('match.driver'), vehicle: job.driverVehicle, plate: job.driverPlate })`, 'U4')
s = s.replace(`      void fetchDelivery(id).then((job) => {
        if (stopped || !job || job.status !== 'assigned' || !job.driverVehicle || !job.driverPlate) return
        setCourier({ name: job.driverName || t('match.driver'), vehicle: job.driverVehicle, plate: job.driverPlate })`,
`      void fetchDelivery(id, deliveryOwnerId()).then((job) => {
        if (stopped || !job || job.status !== 'assigned' || !job.driverVehicle || !job.driverPlate) return
        setCourier({ name: job.driverName || t('match.driver'), vehicle: job.driverVehicle, plate: job.driverPlate, phone: job.driverPhone || '' })`)

// ── 4. DriverDashboard — 수락 건 상태 + 복원 폴링 ────────────────────────────
need(s, `  const [nearDelivery, setNearDelivery] = useState<PublicDelivery | null>(null)`, 'U5')
s = s.replace(`  const [nearDelivery, setNearDelivery] = useState<PublicDelivery | null>(null)`,
`  const [nearDelivery, setNearDelivery] = useState<PublicDelivery | null>(null)
  // 수락한 택배 — 배정 기사에게 발신·수신 연락처가 노출되는 카드.
  const [acceptedDelivery, setAcceptedDelivery] = useState<PublicDelivery | null>(null)`)

need(s, `  const acceptDeliveryJob = (job: PublicDelivery) => {`, 'U6')
s = s.replace(`  const acceptDeliveryJob = (job: PublicDelivery) => {`,
`  // 수락한 택배는 서버에 남는다 — 새로고침·재진입 시 배정 건을 복원한다.
  useEffect(() => {
    if (!driverId || partner?.serviceType !== '택배') return
    let stopped = false
    const pull = () => {
      void fetchAcceptedDeliveries(driverId).then((jobs) => {
        if (!stopped) setAcceptedDelivery(jobs[0] ?? null)
      }).catch(() => undefined)
    }
    pull()
    const timer = window.setInterval(pull, 5000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [driverId, partner?.serviceType])

  const acceptDeliveryJob = (job: PublicDelivery) => {`)

need(s, `    void acceptDelivery(job.id, { driverId, name: partner?.name, vehicle: fleet.vehicle, plate: fleet.plate })`, 'U7')
s = s.replace(`    void acceptDelivery(job.id, { driverId, name: partner?.name, vehicle: fleet.vehicle, plate: fleet.plate })`,
`    void acceptDelivery(job.id, { driverId, name: partner?.name, vehicle: fleet.vehicle, plate: fleet.plate, phone: partner?.phone || memberPhone() })`)

need(s, `      .then(() => {
        setOpenDeliveries((items) => items.filter((item) => item.id !== job.id))`, 'U8')
s = s.replace(`      .then(() => {
        setOpenDeliveries((items) => items.filter((item) => item.id !== job.id))`,
`      .then((accepted) => {
        setAcceptedDelivery(accepted)
        setOpenDeliveries((items) => items.filter((item) => item.id !== job.id))`)

// ── 5. 배정 택배 카드 — 발신인·수신인 연락처 ─────────────────────────────────
need(s, `      {nearDelivery ? (`, 'U9')
s = s.replace(`      {nearDelivery ? (`,
`      {partner?.serviceType === '택배' && acceptedDelivery ? (
        <section className="mt-2 rounded-2xl border-2 border-[#4A82B8] bg-[#E8F1FA] p-4">
          <p className="text-xs font-bold text-[#4A82B8]">배차된 택배 · 연락처</p>
          <p className="mt-2 text-sm font-black text-[#0F172A]">{acceptedDelivery.pickupAddress} → {acceptedDelivery.destAddress}</p>
          <p className="mt-1 text-xs font-semibold text-[#475569]">
            {acceptedDelivery.packageLabel} · {acceptedDelivery.fare.toFixed(1)} Pi
            {acceptedDelivery.scheduledAt
              ? \` · 예약 \${new Date(acceptedDelivery.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}\`
              : ' · 즉시'}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {acceptedDelivery.senderPhone ? (
              <a href={telHref(acceptedDelivery.senderPhone)} className="rounded-xl bg-white py-2.5 text-center text-xs font-black text-[#4A82B8] shadow-sm">
                발신인 {formatKoreanPhone(acceptedDelivery.senderPhone)}
              </a>
            ) : null}
            {acceptedDelivery.recipientPhone ? (
              <a href={telHref(acceptedDelivery.recipientPhone)} className="rounded-xl bg-white py-2.5 text-center text-xs font-black text-[#4A82B8] shadow-sm">
                수신인 {formatKoreanPhone(acceptedDelivery.recipientPhone)}
              </a>
            ) : null}
          </div>
        </section>
      ) : null}
      {nearDelivery ? (`)

save(p, s)
console.log('home-screen ok')
