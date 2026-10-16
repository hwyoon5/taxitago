const fs = require('fs')
const load = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const save = (p, s) => fs.writeFileSync(p, s)
const need = (s, frag, label) => { if (!s.includes(frag)) throw new Error('MISSING ' + label) }

// ── 0. publicDelivery destLat/destLng — 이미 적용됨 ──────────────────────────

const p = 'components/home-screen.tsx'
let s = load(p)

// ── 1. import ────────────────────────────────────────────────────────────────
need(s, `import { acceptDelivery, fetchDelivery, fetchOpenDeliveries, loadDeliveryJob, publishDelivery, saveDeliveryJob, type DeliveryChatPeer, type DeliveryJob, type PublicDelivery } from '@/lib/delivery-job'`, 'H1')
s = s.replace(`import { acceptDelivery, fetchDelivery, fetchOpenDeliveries, loadDeliveryJob, publishDelivery, saveDeliveryJob, type DeliveryChatPeer, type DeliveryJob, type PublicDelivery } from '@/lib/delivery-job'`,
`import { acceptDelivery, deleteDelivery, fetchDelivery, fetchMyDeliveries, fetchOpenDeliveries, loadDeliveryJob, publishDelivery, saveDeliveryJob, updateDelivery, type DeliveryChatPeer, type DeliveryJob, type PublicDelivery } from '@/lib/delivery-job'`)

// ── 2. ServiceSheet — 예약/편집/내 목록 상태 ────────────────────────────────
need(s, `  useEffect(() => {
    if (isUsableCoord(destLat, destLng)) {
      setDeliveryDestPoint({ lat: Number(destLat), lng: Number(destLng) })
    }
  }, [destLat, destLng])`, 'H2')
s = s.replace(`  useEffect(() => {
    if (isUsableCoord(destLat, destLng)) {
      setDeliveryDestPoint({ lat: Number(destLat), lng: Number(destLng) })
    }
  }, [destLat, destLng])`,
`  useEffect(() => {
    if (isUsableCoord(destLat, destLng)) {
      setDeliveryDestPoint({ lat: Number(destLat), lng: Number(destLng) })
    }
  }, [destLat, destLng])
  // 발송 예정 오프셋(분) — 0이면 즉시 배송.
  const [deliverySchedule, setDeliverySchedule] = useState(0)
  // '내 택배' 목록에서 수정 진입한 건의 서버 id — 호출이 PATCH로 바뀐다.
  const [editingDeliveryId, setEditingDeliveryId] = useState<string | null>(null)
  const [myDeliveriesOpen, setMyDeliveriesOpen] = useState(false)
  const [myDeliveries, setMyDeliveries] = useState<PublicDelivery[]>([])
  const deliveryOwnerId = () => loadPiIdentity()?.uid || daeriPassengerIdRef.current || localPassengerId()
  const deliveryScheduledAt = () =>
    deliverySchedule > 0 ? new Date(Date.now() + deliverySchedule * 60000).toISOString() : null
  const refreshMyDeliveries = () => {
    void fetchMyDeliveries(deliveryOwnerId()).then(setMyDeliveries).catch(() => undefined)
  }
  const loadDeliveryIntoForm = (job: PublicDelivery) => {
    setDeliveryPickup(job.pickupAddress)
    setDeliveryDest(job.destAddress)
    setDeliveryPickupPoint(
      isUsableCoord(job.pickupLat, job.pickupLng) ? { lat: Number(job.pickupLat), lng: Number(job.pickupLng) } : null,
    )
    setDeliveryDestPoint(
      isUsableCoord(job.destLat, job.destLng) ? { lat: Number(job.destLat), lng: Number(job.destLng) } : null,
    )
    if (job.vehicle && (DELIVERY_VEHICLES as readonly string[]).includes(job.vehicle)) {
      setDeliveryVehicle(job.vehicle as DeliveryVehicle)
    }
    if (job.packageSize && (PACKAGE_SIZES as readonly { id: string }[]).some((size) => size.id === job.packageSize)) {
      setPackageSize(job.packageSize as PackageSizeId)
    }
    setDeliverySchedule(0)
    setEditingDeliveryId(job.id)
    setMyDeliveriesOpen(false)
  }
  const removeMyDelivery = (job: PublicDelivery) => {
    void deleteDelivery(job.id, deliveryOwnerId())
      .then(() => {
        onNotice(t('svc.delivDeleted'))
        refreshMyDeliveries()
      })
      .catch((error) => onNotice(error instanceof Error ? error.message : ''))
  }`)

// ── 3. startService — 예약·좌표·소유자 저장, 수정 건은 PATCH ────────────────
need(s, `      const job: DeliveryJob = {
        id: \`delivery-\${Date.now()}\`,
        vehicle: deliveryVehicle,
        packageSize,
        packageLabel: packageOption.label,
        fare: deliveryFare,
        pickupAddress: deliveryPickup.trim(),
        destAddress: deliveryDest.trim(),
        senderPhone,
        recipientPhone,
        status: 'requested',
        createdAt: new Date().toISOString(),
      }`, 'H3')
s = s.replace(`      const job: DeliveryJob = {
        id: \`delivery-\${Date.now()}\`,
        vehicle: deliveryVehicle,
        packageSize,
        packageLabel: packageOption.label,
        fare: deliveryFare,
        pickupAddress: deliveryPickup.trim(),
        destAddress: deliveryDest.trim(),
        senderPhone,
        recipientPhone,
        status: 'requested',
        createdAt: new Date().toISOString(),
      }`,
`      const ownerId = deliveryOwnerId()
      const scheduledAt = deliveryScheduledAt()
      if (editingDeliveryId) {
        const editId = editingDeliveryId
        setEditingDeliveryId(null)
        setPhoneError('')
        void updateDelivery(editId, ownerId, {
          pickupAddress: deliveryPickup.trim(),
          pickupLat: deliveryPickupPoint?.lat ?? null,
          pickupLng: deliveryPickupPoint?.lng ?? null,
          destAddress: deliveryDest.trim(),
          destLat: deliveryDestPoint?.lat ?? null,
          destLng: deliveryDestPoint?.lng ?? null,
          packageLabel: packageOption.label,
          vehicle: deliveryVehicle,
          packageSize,
          fare: deliveryFare,
          senderPhone,
          recipientPhone,
          scheduledAt,
        })
          .then(() => {
            onNotice(t('svc.delivUpdated'))
            refreshMyDeliveries()
          })
          .catch((error) => onNotice(error instanceof Error ? error.message : t('svc.delivUpdated')))
        return
      }
      const job: DeliveryJob = {
        id: \`delivery-\${Date.now()}\`,
        ownerId,
        vehicle: deliveryVehicle,
        packageSize,
        packageLabel: packageOption.label,
        fare: deliveryFare,
        pickupAddress: deliveryPickup.trim(),
        pickupLat: deliveryPickupPoint?.lat ?? null,
        pickupLng: deliveryPickupPoint?.lng ?? null,
        destAddress: deliveryDest.trim(),
        destLat: deliveryDestPoint?.lat ?? null,
        destLng: deliveryDestPoint?.lng ?? null,
        scheduledAt,
        senderPhone,
        recipientPhone,
        status: 'requested',
        createdAt: new Date().toISOString(),
      }`)

// ── 4. 예약 칩 + '내 택배' 버튼 — 도착지 행 아래 ────────────────────────────
need(s, `              <RouteSelectRow
                tone="dest"
                label={t('daeri.destLbl')}
                value={deliveryDest}
                placeholder={t('home.destPh')}
                ariaLabel={t('home.destSearchOpen')}
                onClick={() => setDeliverySearchTarget('dest')}
              />
            </div>`, 'H4')
s = s.replace(`              <RouteSelectRow
                tone="dest"
                label={t('daeri.destLbl')}
                value={deliveryDest}
                placeholder={t('home.destPh')}
                ariaLabel={t('home.destSearchOpen')}
                onClick={() => setDeliverySearchTarget('dest')}
              />
            </div>`,
`              <RouteSelectRow
                tone="dest"
                label={t('daeri.destLbl')}
                value={deliveryDest}
                placeholder={t('home.destPh')}
                ariaLabel={t('home.destSearchOpen')}
                onClick={() => setDeliverySearchTarget('dest')}
              />
              <p className="mb-2 mt-3 text-sm font-black">{t('svc.delivSched')}</p>
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
              </div>
              <button
                type="button"
                onClick={() => {
                  refreshMyDeliveries()
                  setMyDeliveriesOpen(true)
                }}
                className="mt-2 w-full rounded-xl border-2 border-dashed border-[#BFDBFE] bg-white py-2 text-[11px] font-black text-[#4A82B8]"
              >
                {t('svc.myDeliveries')}
              </button>
            </div>`)

// ── 5. '내 택배 목록' 모달 — 검색 모달 앞에 렌더 ───────────────────────────
need(s, `      {deliverySearchTarget ? (`, 'H5')
s = s.replace(`      {deliverySearchTarget ? (`,
`      {myDeliveriesOpen ? (
        <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/45" onClick={() => setMyDeliveriesOpen(false)}>
          <div className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-t-3xl bg-white p-4" onClick={(event) => event.stopPropagation()}>
            <p className="text-base font-black text-[#0F172A]">{t('svc.myDeliveries')}</p>
            {myDeliveries.length === 0 ? (
              <p className="mt-4 pb-2 text-center text-sm font-bold text-[#94A3B8]">{t('svc.delivNone')}</p>
            ) : (
              <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pb-1">
                {myDeliveries.map((job) => (
                  <div key={job.id} className="rounded-2xl border-2 border-[#E8F1FA] p-3">
                    <p className="text-sm font-black text-[#0F172A]">{job.pickupAddress} → {job.destAddress}</p>
                    <p className="mt-0.5 text-[11px] font-bold text-[#64748B]">
                      {job.packageLabel} · {job.fare.toFixed(2)} Pi
                      {job.scheduledAt
                        ? \` · \${t('svc.delivScheduled')} \${new Date(job.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}\`
                        : \` · \${t('svc.delivNow')}\`}
                      {job.status === 'assigned' ? \` · \${t('svc.delivAssigned')}\` : ''}
                    </p>
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
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
      {deliverySearchTarget ? (`)

// ── 6. DriverDashboard — 수락 핸들러 추출 + 근접 팝업 상태 ──────────────────
need(s, `  const [openDeliveries, setOpenDeliveries] = useState<PublicDelivery[]>([])`, 'H6')
s = s.replace(`  const [openDeliveries, setOpenDeliveries] = useState<PublicDelivery[]>([])`,
`  const [openDeliveries, setOpenDeliveries] = useState<PublicDelivery[]>([])
  // 근접 택배 팝업 — 수거지가 반경 안에 들어온 건만 띄우고 한 건당 한 번만 알린다.
  const [nearDelivery, setNearDelivery] = useState<PublicDelivery | null>(null)
  const deliveryNearSeen = useRef(new Set<string>())`)

// 근접 팝업 effect — openDeliveries 폴링 effect 뒤에 삽입
need(s, `    const timer = window.setInterval(pull, 2000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [online, partner?.serviceType])`, 'H7')
s = s.replace(`    const timer = window.setInterval(pull, 2000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [online, partner?.serviceType])`,
`    const timer = window.setInterval(pull, 2000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [online, partner?.serviceType])

  // 수거지가 기사 현재 위치 반경 안으로 들어온 택배 — 실시간 팝업 + 알림음.
  const DELIVERY_NEAR_KM = 3
  useEffect(() => {
    if (!online || partner?.serviceType !== '택배') return
    for (const job of openDeliveries) {
      if (deliveryNearSeen.current.has(job.id)) continue
      if (!isUsableCoord(job.pickupLat, job.pickupLng)) continue
      const km = haversineKm({ lat, lng }, { lat: Number(job.pickupLat), lng: Number(job.pickupLng) })
      if (km > DELIVERY_NEAR_KM) continue
      deliveryNearSeen.current.add(job.id)
      setNearDelivery(job)
      alertDriverOffer(\`delivery-near:\${job.id}\`)
      break
    }
  }, [openDeliveries, online, lat, lng, partner?.serviceType])

  const acceptDeliveryJob = (job: PublicDelivery) => {
    const fleet = partnerVehicle(partner)
    if (!driverId || !fleet.vehicle || !fleet.plate) {
      onNotice('프로필에 차량명과 차량번호를 등록한 뒤 수락해 주세요.')
      return
    }
    setBusy(true)
    void acceptDelivery(job.id, { driverId, name: partner?.name, vehicle: fleet.vehicle, plate: fleet.plate })
      .then(() => {
        setOpenDeliveries((items) => items.filter((item) => item.id !== job.id))
        setNearDelivery((cur) => (cur?.id === job.id ? null : cur))
        noteActivity(\`delivery-accept:\${job.id}\`, '배차 수락', \`\${job.pickupAddress} → \${job.destAddress} · \${fleet.vehicle} \${fleet.plate}\`)
        onNotice('택배를 수락했어요. 화주 화면에 차량 정보가 표시됩니다.')
      })
      .catch((error) => onNotice(error instanceof Error ? error.message : '배차 수락에 실패했어요.'))
      .finally(() => setBusy(false))
  }`)

// ── 7. 오픈 택배 단일 카드 → 실시간 리스트(최대 5건, 거리·예약 표시) ─────────
need(s, `      {partner?.serviceType === '택배' && openDeliveries[0] ? (
        <section className="mt-2 rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4">
          <p className="text-xs font-bold text-[#4A82B8]">새로운 택배 요청</p>
          <p className="mt-2 text-base font-bold text-[#0F172A]">{openDeliveries[0].pickupAddress} → {openDeliveries[0].destAddress}</p>
          <p className="mt-1 text-xs font-semibold text-[#475569]">{openDeliveries[0].packageLabel} · {openDeliveries[0].fare.toFixed(1)} Pi</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const job = openDeliveries[0]
              const fleet = partnerVehicle(partner)
              if (!job || !driverId || !fleet.vehicle || !fleet.plate) {
                onNotice('프로필에 차량명과 차량번호를 등록한 뒤 수락해 주세요.')
                return
              }
              setBusy(true)
              void acceptDelivery(job.id, { driverId, name: partner?.name, vehicle: fleet.vehicle, plate: fleet.plate })
                .then(() => {
                  setOpenDeliveries((items) => items.filter((item) => item.id !== job.id))
                  noteActivity(\`delivery-accept:\${job.id}\`, '배차 수락', \`\${job.pickupAddress} → \${job.destAddress} · \${fleet.vehicle} \${fleet.plate}\`)
                  onNotice('택배를 수락했어요. 화주 화면에 차량 정보가 표시됩니다.')
                })
                .catch((error) => onNotice(error instanceof Error ? error.message : '배차 수락에 실패했어요.'))
                .finally(() => setBusy(false))
            }}
            className="mt-3 w-full rounded-2xl bg-[#4A82B8] py-3 font-bold text-white disabled:opacity-60"
          >
            배차 수락
          </button>
        </section>
      ) : null}`, 'H8')
s = s.replace(`      {partner?.serviceType === '택배' && openDeliveries[0] ? (
        <section className="mt-2 rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4">
          <p className="text-xs font-bold text-[#4A82B8]">새로운 택배 요청</p>
          <p className="mt-2 text-base font-bold text-[#0F172A]">{openDeliveries[0].pickupAddress} → {openDeliveries[0].destAddress}</p>
          <p className="mt-1 text-xs font-semibold text-[#475569]">{openDeliveries[0].packageLabel} · {openDeliveries[0].fare.toFixed(1)} Pi</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const job = openDeliveries[0]
              const fleet = partnerVehicle(partner)
              if (!job || !driverId || !fleet.vehicle || !fleet.plate) {
                onNotice('프로필에 차량명과 차량번호를 등록한 뒤 수락해 주세요.')
                return
              }
              setBusy(true)
              void acceptDelivery(job.id, { driverId, name: partner?.name, vehicle: fleet.vehicle, plate: fleet.plate })
                .then(() => {
                  setOpenDeliveries((items) => items.filter((item) => item.id !== job.id))
                  noteActivity(\`delivery-accept:\${job.id}\`, '배차 수락', \`\${job.pickupAddress} → \${job.destAddress} · \${fleet.vehicle} \${fleet.plate}\`)
                  onNotice('택배를 수락했어요. 화주 화면에 차량 정보가 표시됩니다.')
                })
                .catch((error) => onNotice(error instanceof Error ? error.message : '배차 수락에 실패했어요.'))
                .finally(() => setBusy(false))
            }}
            className="mt-3 w-full rounded-2xl bg-[#4A82B8] py-3 font-bold text-white disabled:opacity-60"
          >
            배차 수락
          </button>
        </section>
      ) : null}`,
`      {partner?.serviceType === '택배' && openDeliveries.length ? (
        <section className="mt-2 space-y-2 rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4">
          <p className="text-xs font-bold text-[#4A82B8]">실시간 택배 요청 {openDeliveries.length}건</p>
          {openDeliveries.slice(0, 5).map((job) => {
            const km = isUsableCoord(job.pickupLat, job.pickupLng)
              ? haversineKm({ lat, lng }, { lat: Number(job.pickupLat), lng: Number(job.pickupLng) })
              : null
            return (
              <div key={job.id} className="rounded-2xl border border-[#DBEAFE] bg-white p-3">
                <p className="text-sm font-bold text-[#0F172A]">{job.pickupAddress} → {job.destAddress}</p>
                <p className="mt-1 text-xs font-semibold text-[#475569]">
                  {job.packageLabel} · {job.fare.toFixed(1)} Pi
                  {job.scheduledAt
                    ? \` · 예약 \${new Date(job.scheduledAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}\`
                    : ' · 즉시'}
                  {km !== null ? \` · \${km.toFixed(1)}km\` : ''}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => acceptDeliveryJob(job)}
                  className="mt-2 w-full rounded-xl bg-[#4A82B8] py-2.5 text-xs font-bold text-white disabled:opacity-60"
                >
                  배차 수락
                </button>
              </div>
            )
          })}
        </section>
      ) : null}
      {nearDelivery ? (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/45 px-5" onClick={() => setNearDelivery(null)}>
          <div className="w-full max-w-sm rounded-3xl bg-white p-5" onClick={(event) => event.stopPropagation()}>
            <p className="text-xs font-black text-[#4A82B8]">근처 택배 요청</p>
            <p className="mt-2 text-base font-black text-[#0F172A]">{nearDelivery.pickupAddress} → {nearDelivery.destAddress}</p>
            <p className="mt-1 text-xs font-bold text-[#475569]">
              {nearDelivery.packageLabel} · {nearDelivery.fare.toFixed(1)} Pi
              {isUsableCoord(nearDelivery.pickupLat, nearDelivery.pickupLng)
                ? \` · \${haversineKm({ lat, lng }, { lat: Number(nearDelivery.pickupLat), lng: Number(nearDelivery.pickupLng) }).toFixed(1)}km\`
                : ''}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setNearDelivery(null)}
                className="flex-1 rounded-2xl border-2 border-[#E2E8F0] py-3 text-sm font-black text-[#64748B]"
              >
                나중에
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => acceptDeliveryJob(nearDelivery)}
                className="flex-1 rounded-2xl bg-[#4A82B8] py-3 text-sm font-black text-white disabled:opacity-60"
              >
                배차 수락
              </button>
            </div>
          </div>
        </div>
      ) : null}`)

save(p, s)
console.log('H ok')

// ── 8. i18n ──────────────────────────────────────────────────────────────────
{
  const keys = {
    'messages/ko.json': {
      'svc.delivSched': '발송 예정',
      'svc.delivNow': '즉시',
      'svc.delivAfter': '{min}분 후',
      'svc.delivScheduled': '예약',
      'svc.delivAssigned': '배차 완료',
      'svc.myDeliveries': '내 택배 목록',
      'svc.delivNone': '등록된 택배가 없어요',
      'svc.delivEdit': '수정',
      'svc.delivDelete': '삭제',
      'svc.delivUpdated': '택배 정보를 수정했어요',
      'svc.delivDeleted': '택배를 삭제했어요',
    },
    'messages/en.json': {
      'svc.delivSched': 'Pickup time',
      'svc.delivNow': 'Now',
      'svc.delivAfter': 'in {min} min',
      'svc.delivScheduled': 'Scheduled',
      'svc.delivAssigned': 'Assigned',
      'svc.myDeliveries': 'My deliveries',
      'svc.delivNone': 'No deliveries yet',
      'svc.delivEdit': 'Edit',
      'svc.delivDelete': 'Delete',
      'svc.delivUpdated': 'Delivery request updated',
      'svc.delivDeleted': 'Delivery request removed',
    },
    'messages/ja.json': {
      'svc.delivSched': '発送予定',
      'svc.delivNow': '今すぐ',
      'svc.delivAfter': '{min}分後',
      'svc.delivScheduled': '予約',
      'svc.delivAssigned': '配車済み',
      'svc.myDeliveries': 'マイ配送一覧',
      'svc.delivNone': '依頼がありません',
      'svc.delivEdit': '編集',
      'svc.delivDelete': '削除',
      'svc.delivUpdated': '配送情報を更新しました',
      'svc.delivDeleted': '配送を削除しました',
    },
    'messages/zh.json': {
      'svc.delivSched': '取件时间',
      'svc.delivNow': '立即',
      'svc.delivAfter': '{min}分钟后',
      'svc.delivScheduled': '预约',
      'svc.delivAssigned': '已接单',
      'svc.myDeliveries': '我的快递列表',
      'svc.delivNone': '暂无快递订单',
      'svc.delivEdit': '编辑',
      'svc.delivDelete': '删除',
      'svc.delivUpdated': '已更新快递信息',
      'svc.delivDeleted': '已删除快递订单',
    },
  }
  for (const [file, entries] of Object.entries(keys)) {
    const data = JSON.parse(load(file))
    Object.assign(data, entries)
    save(file, JSON.stringify(data, null, 2) + '\n')
  }
  console.log('i18n ok')
}
