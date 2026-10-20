const fs = require('fs')
const load = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const save = (p, s) => fs.writeFileSync(p, s)
const need = (s, frag, label) => { if (!s.includes(frag)) throw new Error('MISSING ' + label) }
const rep = (s, a, b, label) => { if (!s.includes(a)) { const probe = b.split('\n').map(l => l.trim()).filter(l => l.length > 30)[0]; if (probe && s.includes(probe)) return s; throw new Error('MISSING ' + label) } return s.split(a).join(b) }

// ═══ 1. lib/delivery-dispatch.ts — 사진 수·결제 필드 + 헬퍼 ═══
{
  const p = 'lib/delivery-dispatch.ts'
  let s = load(p)
  s = rep(s, `  driverVehicle: string | null
  driverPlate: string | null
  createdAt: string
  updatedAt: string
}`,
`  driverVehicle: string | null
  driverPlate: string | null
  /** 물품 첨부 사진 수 — 원본은 attachment-store에 id 기준으로 보관. */
  photoCount?: number
  /** 배송비 결제 수단 — 'prepay_pi' 선결제 | 'onsite_qr' 현장 QR | null 미선택. */
  paymentMethod?: 'prepay_pi' | 'onsite_qr' | null
  /** 서버 검증을 통과한 결제 txid — 라우트에서 paymentKindOf 확인 후 기록. */
  paymentTxid?: string | null
  paidAt?: string | null
  createdAt: string
  updatedAt: string
}`, 'S1a')

  s = rep(s, `/** 미배차 건 삭제 — 발신인 취소. */`,
`export function setDeliveryPhotoCount(id: string, count: number) {
  const job = getDeliveryDispatch(id)
  if (!job) return
  job.photoCount = count
  job.updatedAt = new Date().toISOString()
  persist()
}

/** 배송비 결제 수단/완료 기록 — 발신인 소유 건만. 배정 후에도 결제 표시는 허용한다. */
export function markDeliveryPayment(id: string, ownerId: string, method: 'prepay_pi' | 'onsite_qr', txid: string | null) {
  const job = getDeliveryDispatch(id)
  if (!job) return { ok: false as const, error: 'not_found' as const, job: null }
  if (job.ownerId && job.ownerId !== ownerId) return { ok: false as const, error: 'forbidden' as const, job: null }
  job.paymentMethod = method
  if (txid) {
    job.paymentTxid = txid
    job.paidAt = new Date().toISOString()
  }
  job.updatedAt = new Date().toISOString()
  persist()
  return { ok: true as const, job }
}

/** 미배차 건 삭제 — 발신인 취소. */`, 'S1b')

  s = rep(s, `    driverPlate: job.driverPlate,`,
`    driverPlate: job.driverPlate,
    photoCount: job.photoCount ?? 0,
    paymentMethod: job.paymentMethod ?? null,
    paidAt: job.paidAt ?? null,`, 'S1c')
  save(p, s)
  console.log('store ok')
}

// ═══ 2. POST /api/deliveries — 사진 저장 ═══
{
  const p = 'app/api/deliveries/route.ts'
  let s = load(p)
  s = rep(s, `import { createDeliveryDispatch, listAssignedByDriver, listDeliveriesByOwner, listOpenDeliveries, publicDelivery } from '@/lib/delivery-dispatch'`,
`import { createDeliveryDispatch, listAssignedByDriver, listDeliveriesByOwner, listOpenDeliveries, publicDelivery, setDeliveryPhotoCount } from '@/lib/delivery-dispatch'
import { sanitizeAttachments, saveAttachments } from '@/lib/attachment-store'`, 'S2a')

  s = rep(s, `  // 등록 즉시 수거지 근거리 온라인 택배 기사에게 웹 푸시`,
`  // 물품 첨부 사진 — 검증 후 엔티티 id로 저장하고 장수만 기록한다.
  const photos = sanitizeAttachments(body?.photos)
  if (photos.length) {
    const saved = await saveAttachments(job.id, photos)
    if (saved.length) setDeliveryPhotoCount(job.id, saved.length)
  }
  // 등록 즉시 수거지 근거리 온라인 택배 기사에게 웹 푸시`, 'S2b')
  save(p, s)
  console.log('post route ok')
}

// ═══ 3. PATCH /api/deliveries/[id] — 사진 교체 + 결제 표시 ═══
{
  const p = 'app/api/deliveries/[id]/route.ts'
  let s = load(p)
  s = rep(s, `import { deleteDeliveryDispatch, getDeliveryDispatch, publicDelivery, updateDeliveryDispatch } from '@/lib/delivery-dispatch'`,
`import { deleteDeliveryDispatch, getDeliveryDispatch, markDeliveryPayment, publicDelivery, setDeliveryPhotoCount, updateDeliveryDispatch } from '@/lib/delivery-dispatch'
import { sanitizeAttachments, saveAttachments } from '@/lib/attachment-store'`, 'S3a')

  s = rep(s, `  const patch: Record<string, unknown> = {}`,
`  // 결제 수단·완료 표시 — txid는 서버가 검증한 결제만 인정한다.
  const method = body?.paymentMethod
  if (method === 'prepay_pi' || method === 'onsite_qr') {
    const txid = typeof body?.paymentTxid === 'string' ? body.paymentTxid.trim() : ''
    if (method === 'prepay_pi' && !txid) {
      return NextResponse.json({ error: 'paymentTxid required' }, { status: 400 })
    }
    if (txid) {
      const { paymentKindOf } = await import('@/lib/payment-kind-store')
      const kind = await paymentKindOf(txid).catch(() => '')
      if (!kind) return NextResponse.json({ error: 'payment not verified by this server' }, { status: 409 })
    }
    const paidResult = markDeliveryPayment(id, ownerId, method, txid || null)
    if (!paidResult.ok) {
      return NextResponse.json({ error: paidResult.error }, { status: paidResult.error === 'not_found' ? 404 : 403 })
    }
  }
  // 사진 재첨부 — 전달된 경우 통째로 교체한다.
  const photos = sanitizeAttachments(body?.photos)
  if (photos.length) {
    const saved = await saveAttachments(id, photos)
    if (saved.length) setDeliveryPhotoCount(id, saved.length)
  }
  const patch: Record<string, unknown> = {}`, 'S3b')
  save(p, s)
  console.log('patch route ok')
}

// ═══ 4. lib/delivery-job.ts — 타입 확장 ═══
{
  const p = 'lib/delivery-job.ts'
  let s = load(p)
  s = rep(s, `  status: DeliveryJobStatus
  createdAt: string
}`,
`  status: DeliveryJobStatus
  createdAt: string
  /** 물품 사진 — 리사이즈된 dataURL, 서버가 attachment-store에 보관. */
  photos?: { name: string; mime: string; dataUrl: string }[]
}`, 'S4a')
  s = rep(s, `  driverPhone?: string
  senderPhone?: string`,
`  driverPhone?: string
  senderPhone?: string
  photoCount?: number
  paymentMethod?: 'prepay_pi' | 'onsite_qr' | null
  paidAt?: string | null`, 'S4b')
  save(p, s)
  console.log('client lib ok')
}

// ═══ 5. home-screen.tsx ═══
const p = 'components/home-screen.tsx'
let s = load(p)

// 5a. 임포트 — PhotoPicker, fetchAttachments/PhotoUpload
s = rep(s, `import { fetchLostInbox, fetchSosInbox } from '@/lib/support-client'`,
`import { fetchAttachments, fetchLostInbox, fetchSosInbox, type PhotoUpload } from '@/lib/support-client'
import PhotoPicker from '@/components/photo-picker'`, 'C1')

// 5b. ServiceSheet 상태 추가
s = rep(s, `  const [myDeliveries, setMyDeliveries] = useState<PublicDelivery[]>([])`,
`  const [myDeliveries, setMyDeliveries] = useState<PublicDelivery[]>([])
  // 물품 첨부 사진(리사이즈된 dataURL) — 등록 시 서버 attachment-store로 간다.
  const [deliveryPhotos, setDeliveryPhotos] = useState<PhotoUpload[]>([])
  // 등록 직후 열리는 결제 수단 선택 시트 대상 — 선결제/현장 QR 분기의 기준 건.
  const [deliveryPayJob, setDeliveryPayJob] = useState<PublicDelivery | null>(null)
  const [deliveryPayBusy, setDeliveryPayBusy] = useState(false)
  // 현장 QR 결제 스캔 대상 건 — 발신인이 기사 QR을 찍어 완료 표시한다.
  const [deliveryQrJob, setDeliveryQrJob] = useState<PublicDelivery | null>(null)
  // '요금 올리기' 인라인 입력 — 매칭이 안 될 때 발신인이 상향 재등록한다.
  const [fareBump, setFareBump] = useState<{ id: string; value: string } | null>(null)`, 'C2')

// 5c. 폼에 PhotoPicker 삽입 — 차량 선택 앞
s = rep(s, `              <p className="mb-2 text-sm font-black">{t('svc.vehiclePick')}</p>`,
`              <p className="mb-1 mt-3 text-sm font-black">{t('svc.delivPhoto')}</p>
              <PhotoPicker photos={deliveryPhotos} onChange={setDeliveryPhotos} />
              <p className="mt-0.5 text-[10px] font-bold text-[#94A3B8]">{t('svc.delivPhotoHint')}</p>
              <p className="mb-2 text-sm font-black">{t('svc.vehiclePick')}</p>`, 'C3')

// 5d. 생성/수정 payload에 photos 포함 + 등록 성공 시 결제 시트 오픈
s = rep(s, `        void updateDelivery(editId, ownerId, {
          pickupAddress: deliveryPickup.trim(),`,
`        void updateDelivery(editId, ownerId, {
          ...(deliveryPhotos.length ? { photos: deliveryPhotos } : {}),
          pickupAddress: deliveryPickup.trim(),`, 'C4a')

s = rep(s, `        status: 'requested',
        createdAt: new Date().toISOString(),
      }
      setPhoneError('')`,
`        status: 'requested',
        createdAt: new Date().toISOString(),
        photos: deliveryPhotos,
      }
      setPhoneError('')`, 'C4b')

s = rep(s, `      void publishDelivery(job)
        .then(() => {
          refreshMyDeliveries()
          setMyDeliveriesOpen(true)
          onNotice(t('svc.delivRegistered'))
        })`,
`      void publishDelivery(job)
        .then((published) => {
          refreshMyDeliveries()
          setMyDeliveriesOpen(true)
          // 등록 직후 결제 수단 선택 — 선결제 또는 현장 QR.
          setDeliveryPayJob(published)
          onNotice(t('svc.delivRegistered'))
        })`, 'C4c')

// 5e. 결제·요금 상향 핸들러 — removeMyDelivery 뒤에 삽입
s = rep(s, `  const removeMyDelivery = (job: PublicDelivery) => {`,
`  // Pi 선결제 — SDK 체크아웃 완료 txid를 서버가 검증한 뒤 결제 완료로 기록한다.
  const payDeliveryNow = async () => {
    const job = deliveryPayJob
    if (!job || deliveryPayBusy) return
    setDeliveryPayBusy(true)
    try {
      const result = await startPiCheckout({
        amount: job.fare,
        memo: '택배 배송비 선결제',
        metadata: { kind: 'delivery', deliveryId: job.id },
      })
      await updateDelivery(job.id, deliveryOwnerId(), { paymentMethod: 'prepay_pi', paymentTxid: result.txid })
      onNotice(t('svc.delivPayDone'))
      setDeliveryPayJob(null)
      refreshMyDeliveries()
    } catch (error) {
      onNotice(error instanceof Error ? describePiUserMessage(error) : '')
    } finally {
      setDeliveryPayBusy(false)
    }
  }
  const chooseDeliveryQr = () => {
    const job = deliveryPayJob
    if (!job) return
    void updateDelivery(job.id, deliveryOwnerId(), { paymentMethod: 'onsite_qr' })
      .then(() => {
        refreshMyDeliveries()
        onNotice(t('svc.delivPayOnsite'))
      })
      .catch((error) => onNotice(error instanceof Error ? error.message : ''))
    setDeliveryPayJob(null)
  }
  const submitFareBump = (job: PublicDelivery) => {
    const next = Number(fareBump?.value)
    if (!Number.isFinite(next) || next <= job.fare) {
      onNotice(t('svc.delivFareUpErr'))
      return
    }
    const bump = next
    setFareBump(null)
    void updateDelivery(job.id, deliveryOwnerId(), { fare: bump })
      .then(() => {
        onNotice(t('svc.delivFareUpDone'))
        refreshMyDeliveries()
      })
      .catch((error) => onNotice(error instanceof Error ? error.message : ''))
  }
  const removeMyDelivery = (job: PublicDelivery) => {`, 'C5')

// 5f. 내 택배 항목 — 사진/결제 배지 + 요금 상향 + 결제/QR 버튼
{
  const old = `                    <p className="mt-0.5 text-[11px] font-bold text-[#64748B]">
                      {job.packageLabel} · {job.fare.toFixed(2)} Pi
                      {job.scheduledAt
                        ? \` · \${t('svc.delivScheduled')} \${new Date(job.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}\`
                        : \` · \${t('svc.delivNow')}\`}
                      {job.status === 'assigned' ? \` · \${t('svc.delivAssigned')}\` : ''}
                    </p>
                    {job.scheduledAt && job.status === 'requested' ? <DeliveryCountdown at={job.scheduledAt} className="mt-1 text-[11px] font-black text-[#4A82B8]" /> : null}
                    {job.status === 'requested' ? (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => loadDeliveryIntoForm(job)}
                          className="flex-1 rounded-xl bg-[#4A82B8] py-2 text-xs font-black text-white"
                        >
                          {t('svc.delivEdit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeMyDelivery(job)}
                          className="flex-1 rounded-xl border-2 border-[#FCA5A5] bg-white py-2 text-xs font-black text-[#DC2626]"
                        >
                          {t('svc.delivDelete')}
                        </button>
                      </div>
                    ) : null}`
  const neu = `                    <p className="mt-0.5 text-[11px] font-bold text-[#64748B]">
                      {job.packageLabel} · {job.fare.toFixed(2)} Pi
                      {job.scheduledAt
                        ? \` · \${t('svc.delivScheduled')} \${new Date(job.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}\`
                        : \` · \${t('svc.delivNow')}\`}
                      {job.status === 'assigned' ? \` · \${t('svc.delivAssigned')}\` : ''}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {job.photoCount ? (
                        <span className="rounded-full bg-[#E8F1FA] px-2 py-0.5 text-[10px] font-black text-[#4A82B8]">{t('svc.delivPhotosN', { n: String(job.photoCount) })}</span>
                      ) : null}
                      {job.paidAt ? (
                        <span className="rounded-full bg-[#D1FAE5] px-2 py-0.5 text-[10px] font-black text-[#047857]">{t('svc.delivPaid')}</span>
                      ) : job.paymentMethod === 'onsite_qr' ? (
                        <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10px] font-black text-[#B45309]">{t('svc.delivPayOnsite')}</span>
                      ) : null}
                    </div>
                    {job.scheduledAt && job.status === 'requested' ? <DeliveryCountdown at={job.scheduledAt} className="mt-1 text-[11px] font-black text-[#4A82B8]" /> : null}
                    {job.status === 'requested' ? (
                      <div className="mt-2 space-y-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => loadDeliveryIntoForm(job)}
                            className="flex-1 rounded-xl bg-[#4A82B8] py-2 text-xs font-black text-white"
                          >
                            {t('svc.delivEdit')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setFareBump({ id: job.id, value: (job.fare + 0.5).toFixed(2) })}
                            className="flex-1 rounded-xl border-2 border-[#BFDBFE] bg-white py-2 text-xs font-black text-[#4A82B8]"
                          >
                            {t('svc.delivFareUp')}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeMyDelivery(job)}
                            className="flex-1 rounded-xl border-2 border-[#FCA5A5] bg-white py-2 text-xs font-black text-[#DC2626]"
                          >
                            {t('svc.delivDelete')}
                          </button>
                        </div>
                        {fareBump?.id === job.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.1"
                              min={job.fare}
                              value={fareBump.value}
                              onChange={(event) => setFareBump({ id: job.id, value: event.target.value })}
                              placeholder={t('svc.delivFareUpPh')}
                              aria-label={t('svc.delivFareUp')}
                              className="w-24 rounded-lg border-2 border-[#BFDBFE] bg-white px-2 py-1.5 text-center text-sm font-black text-[#0F172A] outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => submitFareBump(job)}
                              className="rounded-lg bg-[#4A82B8] px-3 py-1.5 text-[11px] font-black text-white"
                            >
                              {t('common.ok')}
                            </button>
                          </div>
                        ) : null}
                        {!job.paidAt && !job.paymentMethod ? (
                          <button
                            type="button"
                            onClick={() => setDeliveryPayJob(job)}
                            className="w-full rounded-xl border-2 border-dashed border-[#BFDBFE] bg-white py-2 text-[11px] font-black text-[#4A82B8]"
                          >
                            {t('svc.delivPayNeed')}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {job.status === 'assigned' && job.paymentMethod === 'onsite_qr' && !job.paidAt ? (
                      <button
                        type="button"
                        onClick={() => setDeliveryQrJob(job)}
                        className="mt-2 w-full rounded-xl bg-[#4A82B8] py-2 text-xs font-black text-white"
                      >
                        {t('svc.delivQrPay')}
                      </button>
                    ) : null}`
  s = rep(s, old, neu, 'C6')
}

// 5g. 결제 수단 선택 모달 + QR 스캔 모달 — deliverySearchTarget 모달 앞에 삽입
s = rep(s, `      {deliverySearchTarget ? (`,
`      {deliveryPayJob ? (
        <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/45 px-6" onClick={() => setDeliveryPayJob(null)}>
          <div className="w-full max-w-sm rounded-3xl bg-white p-5" onClick={(event) => event.stopPropagation()}>
            <p className="text-xs font-black text-[#4A82B8]">{t('svc.delivPayTitle')}</p>
            <p className="mt-2 text-sm font-black text-[#0F172A]">
              {deliveryPayJob.fare.toFixed(2)} Pi · {deliveryPayJob.pickupAddress} → {deliveryPayJob.destAddress}
            </p>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                disabled={deliveryPayBusy}
                onClick={() => void payDeliveryNow()}
                className="w-full rounded-2xl bg-[#4A82B8] py-3 text-sm font-black text-white disabled:opacity-60"
              >
                {deliveryPayBusy ? t('common.loading') : t('svc.delivPayPi')}
              </button>
              <button
                type="button"
                onClick={chooseDeliveryQr}
                className="w-full rounded-2xl border-2 border-[#BFDBFE] bg-white py-3 text-sm font-black text-[#4A82B8]"
              >
                {t('svc.delivPayQr')}
              </button>
              <button
                type="button"
                onClick={() => setDeliveryPayJob(null)}
                className="w-full rounded-2xl bg-[#F1F5F9] py-3 text-sm font-black text-[#64748B]"
              >
                {t('svc.delivPayLater')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deliveryQrJob ? (
        <QrPayScanModal
          onClose={() => setDeliveryQrJob(null)}
          onPaid={(_record, proof) => {
            const job = deliveryQrJob
            setDeliveryQrJob(null)
            if (!job) return
            void updateDelivery(job.id, deliveryOwnerId(), { paymentMethod: 'onsite_qr', paymentTxid: proof.txid })
              .then(() => {
                onNotice(t('svc.delivPayDone'))
                refreshMyDeliveries()
              })
              .catch((error) => onNotice(error instanceof Error ? error.message : ''))
          }}
        />
      ) : null}
      {deliverySearchTarget ? (`, 'C7')

// 5h. 기사 측 — 사진 보기 상태 + 핸들러 (nearDelivery 상태 옆)
s = rep(s, `  const [nearDelivery, setNearDelivery] = useState<PublicDelivery | null>(null)`,
`  const [nearDelivery, setNearDelivery] = useState<PublicDelivery | null>(null)
  // 기사용 물품 사진 뷰어 — 첨부 장수만 목록에 오고, 원본은 클릭 시 조회한다.
  const [deliveryPhotoView, setDeliveryPhotoView] = useState<{ id: string; photos: { id: string; dataUrl: string; name: string }[] } | null>(null)
  const openDeliveryPhotos = (id: string) => {
    void fetchAttachments(id)
      .then((photos) => setDeliveryPhotoView({ id, photos }))
      .catch(() => undefined)
  }
  const deliveryPayBadge = (job: PublicDelivery) =>
    job.paidAt ? t('svc.delivPaid') : job.paymentMethod === 'onsite_qr' ? t('svc.delivPayOnsite') : ''`, 'C8')

// 5i. 기사 오픈 목록 항목 — 사진/결제 칩
s = rep(s, `                  {km !== null ? \` · \${km.toFixed(1)}km\` : ''}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => acceptDeliveryJob(job)}`,
`                  {km !== null ? \` · \${km.toFixed(1)}km\` : ''}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {job.photoCount ? (
                    <button
                      type="button"
                      onClick={() => openDeliveryPhotos(job.id)}
                      className="rounded-full bg-[#E8F1FA] px-2 py-0.5 text-[10px] font-black text-[#4A82B8]"
                    >
                      {t('svc.delivPhotosN', { n: String(job.photoCount) })}
                    </button>
                  ) : null}
                  {deliveryPayBadge(job) ? (
                    <span className={\`rounded-full px-2 py-0.5 text-[10px] font-black \${job.paidAt ? 'bg-[#D1FAE5] text-[#047857]' : 'bg-[#FEF3C7] text-[#B45309]'}\`}>
                      {deliveryPayBadge(job)}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => acceptDeliveryJob(job)}`, 'C9')

// 5j. 근접 팝업에도 사진/결제 칩
s = rep(s, `            <p className="mt-1 text-xs font-bold text-[#475569]">
              {nearDelivery.packageLabel} · {nearDelivery.fare.toFixed(1)} Pi
              {isUsableCoord(nearDelivery.pickupLat, nearDelivery.pickupLng)
                ? \` · \${haversineKm({ lat, lng }, { lat: Number(nearDelivery.pickupLat), lng: Number(nearDelivery.pickupLng) }).toFixed(1)}km\`
                : ''}
            </p>`,
`            <p className="mt-1 text-xs font-bold text-[#475569]">
              {nearDelivery.packageLabel} · {nearDelivery.fare.toFixed(1)} Pi
              {isUsableCoord(nearDelivery.pickupLat, nearDelivery.pickupLng)
                ? \` · \${haversineKm({ lat, lng }, { lat: Number(nearDelivery.pickupLat), lng: Number(nearDelivery.pickupLng) }).toFixed(1)}km\`
                : ''}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {nearDelivery.photoCount ? (
                <button
                  type="button"
                  onClick={() => openDeliveryPhotos(nearDelivery.id)}
                  className="rounded-full bg-[#E8F1FA] px-2 py-0.5 text-[10px] font-black text-[#4A82B8]"
                >
                  {t('svc.delivPhotosN', { n: String(nearDelivery.photoCount) })}
                </button>
              ) : null}
              {deliveryPayBadge(nearDelivery) ? (
                <span className={\`rounded-full px-2 py-0.5 text-[10px] font-black \${nearDelivery.paidAt ? 'bg-[#D1FAE5] text-[#047857]' : 'bg-[#FEF3C7] text-[#B45309]'}\`}>
                  {deliveryPayBadge(nearDelivery)}
                </span>
              ) : null}
            </div>`, 'C10')

// 5k. 수락 건 카드에도 칩
s = rep(s, `          <p className="mt-1 text-xs font-semibold text-[#475569]">
            {acceptedDelivery.packageLabel} · {acceptedDelivery.fare.toFixed(1)} Pi`,
`          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {acceptedDelivery.photoCount ? (
              <button
                type="button"
                onClick={() => openDeliveryPhotos(acceptedDelivery.id)}
                className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-[#4A82B8] shadow-sm"
              >
                {t('svc.delivPhotosN', { n: String(acceptedDelivery.photoCount) })}
              </button>
            ) : null}
            {deliveryPayBadge(acceptedDelivery) ? (
              <span className={\`rounded-full bg-white px-2 py-0.5 text-[10px] font-black shadow-sm \${acceptedDelivery.paidAt ? 'text-[#047857]' : 'text-[#B45309]'}\`}>
                {deliveryPayBadge(acceptedDelivery)}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs font-semibold text-[#475569]">
            {acceptedDelivery.packageLabel} · {acceptedDelivery.fare.toFixed(1)} Pi`, 'C11')

// 5l. 기사 사진 뷰어 모달 — nearDelivery 모달 앞
s = rep(s, `      {nearDelivery ? (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/45 px-5"`,
`      {deliveryPhotoView ? (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/60 px-5" onClick={() => setDeliveryPhotoView(null)}>
          <div className="w-full max-w-sm rounded-3xl bg-white p-4" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-black text-[#4A82B8]">{t('svc.delivPhoto')}</p>
              <button type="button" onClick={() => setDeliveryPhotoView(null)} aria-label={t('common.close')} className="rounded-full bg-[#F1F5F9] p-1.5 text-[#64748B]">
                <X className="h-4 w-4" />
              </button>
            </div>
            {deliveryPhotoView.photos.length ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {deliveryPhotoView.photos.map((photo) => (
                  <img key={photo.id} src={photo.dataUrl} alt={photo.name} className="h-32 w-full rounded-xl border border-[#E2E8F0] object-cover" />
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-sm font-bold text-[#94A3B8]">{t('inbox.empty')}</p>
            )}
          </div>
        </div>
      ) : null}
      {nearDelivery ? (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/45 px-5"`, 'C12')

save(p, s)
console.log('home-screen ok')

// ═══ 6. i18n ═══
{
  const keys = {
    'messages/ko.json': {
      'svc.delivPhoto': '물품 사진',
      'svc.delivPhotoHint': '파손·분쟁 방지용으로 기사에게 미리 보여줘요 (선택)',
      'svc.delivPayTitle': '배송비 결제 방법',
      'svc.delivPayPi': 'Pi로 선결제',
      'svc.delivPayQr': '현장 QR 결제',
      'svc.delivPayLater': '나중에 결제',
      'svc.delivPayNeed': '결제 방법 선택',
      'svc.delivPaid': '결제 완료',
      'svc.delivPayOnsite': '현장 결제 예정',
      'svc.delivPayDone': '결제가 완료됐어요',
      'svc.delivFareUp': '요금 올리기',
      'svc.delivFareUpPh': '현재보다 높은 금액',
      'svc.delivFareUpDone': '요금을 올려 재등록했어요',
      'svc.delivFareUpErr': '현재 요금보다 높게 입력해 주세요',
      'svc.delivPhotosN': '사진 {n}장',
      'svc.delivQrPay': 'QR 결제',
    },
    'messages/en.json': {
      'svc.delivPhoto': 'Item photos',
      'svc.delivPhotoHint': 'Shown to the driver to prevent damage/disputes (optional)',
      'svc.delivPayTitle': 'Delivery payment',
      'svc.delivPayPi': 'Prepay with Pi',
      'svc.delivPayQr': 'On-site QR payment',
      'svc.delivPayLater': 'Pay later',
      'svc.delivPayNeed': 'Choose payment method',
      'svc.delivPaid': 'Paid',
      'svc.delivPayOnsite': 'Pay on-site',
      'svc.delivPayDone': 'Payment completed',
      'svc.delivFareUp': 'Raise fare',
      'svc.delivFareUpPh': 'Amount above current',
      'svc.delivFareUpDone': 'Fare raised and reposted',
      'svc.delivFareUpErr': 'Enter an amount above the current fare',
      'svc.delivPhotosN': '{n} photos',
      'svc.delivQrPay': 'QR pay',
    },
    'messages/ja.json': {
      'svc.delivPhoto': '荷物の写真',
      'svc.delivPhotoHint': '破損・トラブル防止のためドライバーに事前表示（任意）',
      'svc.delivPayTitle': '配送料の支払い',
      'svc.delivPayPi': 'Piで先払い',
      'svc.delivPayQr': '現場QR決済',
      'svc.delivPayLater': '後で支払う',
      'svc.delivPayNeed': '支払い方法を選択',
      'svc.delivPaid': '支払い済み',
      'svc.delivPayOnsite': '現場支払い予定',
      'svc.delivPayDone': '支払いが完了しました',
      'svc.delivFareUp': '料金を上げる',
      'svc.delivFareUpPh': '現在より高い金額',
      'svc.delivFareUpDone': '料金を引き上げて再登録しました',
      'svc.delivFareUpErr': '現在の料金より高く入力してください',
      'svc.delivPhotosN': '写真{n}枚',
      'svc.delivQrPay': 'QR決済',
    },
    'messages/zh.json': {
      'svc.delivPhoto': '物品照片',
      'svc.delivPhotoHint': '用于防止损坏与纠纷，司机会提前查看（可选）',
      'svc.delivPayTitle': '配送费支付方式',
      'svc.delivPayPi': 'Pi 预付',
      'svc.delivPayQr': '现场扫码支付',
      'svc.delivPayLater': '稍后支付',
      'svc.delivPayNeed': '选择支付方式',
      'svc.delivPaid': '已支付',
      'svc.delivPayOnsite': '待现场支付',
      'svc.delivPayDone': '支付完成',
      'svc.delivFareUp': '提高运费',
      'svc.delivFareUpPh': '高于当前金额',
      'svc.delivFareUpDone': '已上调运费并重新发布',
      'svc.delivFareUpErr': '请输入高于当前运费的金额',
      'svc.delivPhotosN': '{n}张照片',
      'svc.delivQrPay': '扫码支付',
    },
  }
  for (const [file, entries] of Object.entries(keys)) {
    const data = JSON.parse(load(file))
    Object.assign(data, entries)
    save(file, JSON.stringify(data, null, 2) + '\n')
  }
  console.log('i18n ok')
}
