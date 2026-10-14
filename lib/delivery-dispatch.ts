import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

export type DeliveryDispatchStatus = 'requested' | 'assigned'

export type DeliveryDispatch = {
  id: string
  /** 발신인 식별자 — 수정·삭제 권한 검사와 '내 택배' 목록 필터에 쓴다. */
  ownerId?: string
  pickupAddress: string
  pickupLat?: number | null
  pickupLng?: number | null
  destAddress: string
  destLat?: number | null
  destLng?: number | null
  /** 예약 수거 시각(ISO) — null/없으면 즉시 배송. */
  scheduledAt?: string | null
  vehicle?: string
  packageSize?: string
  packageLabel: string
  fare: number
  senderPhone: string
  recipientPhone: string
  status: DeliveryDispatchStatus
  driverId: string | null
  driverName: string | null
  /** 배정 기사 연락처 — 수락 시 전달, 발신인이 기사와 직통 연결할 때 노출. */
  driverPhone?: string | null
  driverVehicle: string | null
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
}

type Store = { jobs: Map<string, DeliveryDispatch>; hydrated: boolean }

const filePath = path.join(process.cwd(), 'data', 'deliveries.json')

function db(): Store {
  const globalStore = globalThis as typeof globalThis & { __taxitagoDeliveries?: Store }
  if (!globalStore.__taxitagoDeliveries) {
    globalStore.__taxitagoDeliveries = { jobs: new Map(), hydrated: false }
  }
  const store = globalStore.__taxitagoDeliveries
  if (!store.hydrated) {
    store.hydrated = true
    try {
      if (existsSync(filePath)) {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { jobs?: DeliveryDispatch[] }
        for (const job of parsed.jobs ?? []) store.jobs.set(job.id, job)
      }
    } catch {
      undefined
    }
  }
  return store
}

function persist() {
  const store = db()
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ jobs: [...store.jobs.values()] }), 'utf8')
  } catch {
    undefined
  }
}

export function createDeliveryDispatch(input: Omit<DeliveryDispatch, 'status' | 'driverId' | 'driverName' | 'driverVehicle' | 'driverPlate' | 'updatedAt'>) {
  const job: DeliveryDispatch = {
    ...input,
    status: 'requested',
    driverId: null,
    driverName: null,
    driverVehicle: null,
    driverPlate: null,
    updatedAt: input.createdAt,
  }
  db().jobs.set(job.id, job)
  persist()
  return job
}

export function getDeliveryDispatch(id: string) {
  return db().jobs.get(id) ?? null
}

/** 발신인 소유 건 전체(상태 무관) — 최신순. */
export function listDeliveriesByOwner(ownerId: string) {
  return [...db().jobs.values()]
    .filter((job) => job.ownerId === ownerId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

/** 미배차 건만 발신인 본인이 고칠 수 있다. */
export function updateDeliveryDispatch(id: string, ownerId: string, patch: Partial<DeliveryDispatch>) {
  const job = getDeliveryDispatch(id)
  if (!job) return { ok: false as const, error: 'not_found' as const, job: null }
  if (job.ownerId && job.ownerId !== ownerId) return { ok: false as const, error: 'forbidden' as const, job: null }
  if (job.status !== 'requested') return { ok: false as const, error: 'already_assigned' as const, job }
  const editable = ['pickupAddress', 'pickupLat', 'pickupLng', 'destAddress', 'destLat', 'destLng', 'packageLabel', 'vehicle', 'packageSize', 'fare', 'senderPhone', 'recipientPhone', 'scheduledAt'] as const
  for (const key of editable) {
    if (key in patch) (job as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key]
  }
  job.updatedAt = new Date().toISOString()
  persist()
  return { ok: true as const, job }
}

export function setDeliveryPhotoCount(id: string, count: number) {
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

/** 미배차 건 삭제 — 발신인 취소. */
export function deleteDeliveryDispatch(id: string, ownerId: string) {
  const job = getDeliveryDispatch(id)
  if (!job) return { ok: false as const, error: 'not_found' as const }
  if (job.ownerId && job.ownerId !== ownerId) return { ok: false as const, error: 'forbidden' as const }
  if (job.status !== 'requested') return { ok: false as const, error: 'already_assigned' as const }
  db().jobs.delete(id)
  persist()
  return { ok: true as const }
}

/** 기사에게 배정된 건 — 기사 화면의 수락 건 복원 폴링용. */
export function listAssignedByDriver(driverId: string) {
  return [...db().jobs.values()]
    .filter((job) => job.status === 'assigned' && job.driverId === driverId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function listOpenDeliveries() {
  return [...db().jobs.values()].filter((job) => job.status === 'requested').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function acceptDeliveryDispatch(id: string, driver: { driverId: string; name: string; vehicle: string; plate: string; phone?: string }) {
  const job = getDeliveryDispatch(id)
  if (!job) return { ok: false as const, error: 'not_found', job: null }
  if (job.status === 'assigned') {
    if (job.driverId === driver.driverId) return { ok: true as const, job }
    return { ok: false as const, error: 'already_assigned', job }
  }
  job.status = 'assigned'
  job.driverId = driver.driverId
  job.driverName = driver.name.trim() || '기사'
  job.driverVehicle = driver.vehicle.trim()
  job.driverPlate = driver.plate.trim()
  job.driverPhone = driver.phone?.trim() || null
  job.updatedAt = new Date().toISOString()
  persist()
  return { ok: true as const, job }
}

export function publicDelivery(job: DeliveryDispatch, viewerId?: string) {
  const mine = Boolean(viewerId && job.driverId === viewerId)
  return {
    id: job.id,
    pickupAddress: job.pickupAddress,
    destAddress: job.destAddress,
    packageLabel: job.packageLabel,
    fare: job.fare,
    vehicle: job.vehicle ?? null,
    packageSize: job.packageSize ?? null,
    scheduledAt: job.scheduledAt ?? null,
    pickupLat: job.pickupLat ?? null,
    pickupLng: job.pickupLng ?? null,
    destLat: job.destLat ?? null,
    destLng: job.destLng ?? null,
    status: job.status,
    driverName: job.driverName,
    driverVehicle: job.driverVehicle,
    driverPlate: job.driverPlate,
    photoCount: job.photoCount ?? 0,
    paymentMethod: job.paymentMethod ?? null,
    paidAt: job.paidAt ?? null,
    senderPhone: job.status === 'assigned' && mine ? job.senderPhone : '',
    recipientPhone: job.status === 'assigned' && mine ? job.recipientPhone : '',
    // 발신인·수신인 ↔ 기사 연락처 — 배정된 당사자(기사 또는 발신인)에게만 노출.
    driverPhone: job.status === 'assigned' && (mine || (viewerId && job.ownerId === viewerId)) ? (job.driverPhone ?? '') : '',
    createdAt: job.createdAt,
  }
}
