import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { kvCommand, kvConfigured, netFilePath, netKey } from '@/lib/kv'

/** 등록 → 수락 → 수행(수거 완료·배송 중) → 완료 — 관리자 현황판의 4단계와 동일 순서. */
export type DeliveryDispatchStatus = 'requested' | 'assigned' | 'in_transit' | 'completed'

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
  /** 발신인이 기사에게 남기는 요청 메모 — 특이사항·찾아오는 길·주의점. */
  driverNote?: string
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

const filePath = netFilePath(path.join(process.cwd(), 'data', 'deliveries.json'))
const useKv = kvConfigured

const jobKey = (id: string) => netKey(`taxitago:deliveries:job:${id}`)
const INDEX_KEY = netKey('taxitago:deliveries:index')

let warnedEphemeral = false
function warnEphemeral() {
  if (warnedEphemeral || !process.env.VERCEL) return
  warnedEphemeral = true
  console.error('[delivery-dispatch] no KV configured on Vercel — delivery data is NOT shared across instances (set KV_REST_API_URL/KV_REST_API_TOKEN)')
}

type Store = { jobs: Map<string, DeliveryDispatch>; hydrated: boolean }

function db(): Store {
  const globalStore = globalThis as typeof globalThis & { __taxitagoDeliveries?: Store }
  if (!globalStore.__taxitagoDeliveries) {
    globalStore.__taxitagoDeliveries = { jobs: new Map(), hydrated: false }
  }
  const store = globalStore.__taxitagoDeliveries
  if (!store.hydrated) {
    store.hydrated = true
    syncFromDisk(store)
  }
  return store
}

function readPersisted(): DeliveryDispatch[] {
  try {
    if (!existsSync(filePath)) return []
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { jobs?: DeliveryDispatch[] }
    return Array.isArray(parsed.jobs) ? parsed.jobs : []
  } catch {
    return []
  }
}

/** 다른 프로세스가 파일에 쓴 최신 레코드를 메모리에 병합 — updatedAt이 새 것이 이긴다. */
function syncFromDisk(store?: Store) {
  const target = store ?? db()
  for (const job of readPersisted()) {
    const current = target.jobs.get(job.id)
    if (!current || Date.parse(current.updatedAt || '') <= Date.parse(job.updatedAt || '')) {
      target.jobs.set(job.id, job)
    }
  }
}

function persist() {
  const store = db()
  warnEphemeral()
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ jobs: [...store.jobs.values()] }), 'utf8')
  } catch {
    undefined
  }
}

async function kvGetJob(id: string): Promise<DeliveryDispatch | null> {
  const raw = await kvCommand<string | null>(['GET', jobKey(id)]).catch(() => null)
  if (!raw) return null
  try {
    return JSON.parse(raw) as DeliveryDispatch
  } catch {
    return null
  }
}

async function kvSaveJob(job: DeliveryDispatch) {
  await kvCommand(['SET', jobKey(job.id), JSON.stringify(job)])
  await kvCommand(['SADD', INDEX_KEY, job.id])
}

async function kvDeleteJob(id: string) {
  await kvCommand(['DEL', jobKey(id)])
  await kvCommand(['SREM', INDEX_KEY, id])
}

async function kvListJobs(): Promise<DeliveryDispatch[]> {
  const ids = (await kvCommand<string[]>(['SMEMBERS', INDEX_KEY]).catch(() => null)) ?? []
  if (!ids.length) return []
  const raw = (await kvCommand<(string | null)[]>(['MGET', ...ids.map(jobKey)]).catch(() => null)) ?? []
  const jobs: DeliveryDispatch[] = []
  for (const value of raw) {
    if (!value) continue
    try {
      jobs.push(JSON.parse(value) as DeliveryDispatch)
    } catch {
      undefined
    }
  }
  return jobs
}

async function getJob(id: string) {
  if (useKv) return kvGetJob(id)
  syncFromDisk()
  return db().jobs.get(id) ?? null
}

async function saveJob(job: DeliveryDispatch) {
  if (useKv) {
    await kvSaveJob(job)
    return
  }
  db().jobs.set(job.id, job)
  persist()
}

async function listJobs() {
  if (useKv) return kvListJobs()
  syncFromDisk()
  return [...db().jobs.values()]
}

export async function createDeliveryDispatch(input: Omit<DeliveryDispatch, 'status' | 'driverId' | 'driverName' | 'driverVehicle' | 'driverPlate' | 'updatedAt'>) {
  const job: DeliveryDispatch = {
    ...input,
    status: 'requested',
    driverId: null,
    driverName: null,
    driverVehicle: null,
    driverPlate: null,
    updatedAt: input.createdAt,
  }
  await saveJob(job)
  return job
}

export async function getDeliveryDispatch(id: string) {
  return getJob(id)
}

/** 발신인 소유 건 전체(상태 무관) — 최신순. */
export async function listDeliveriesByOwner(ownerId: string) {
  return (await listJobs())
    .filter((job) => job.ownerId === ownerId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

/** 미배차 건만 발신인 본인이 고칠 수 있다. */
export async function updateDeliveryDispatch(id: string, ownerId: string, patch: Partial<DeliveryDispatch>) {
  const job = await getJob(id)
  if (!job) return { ok: false as const, error: 'not_found' as const, job: null }
  if (job.ownerId && job.ownerId !== ownerId) return { ok: false as const, error: 'forbidden' as const, job: null }
  if (job.status !== 'requested') return { ok: false as const, error: 'already_assigned' as const, job }
  const editable = ['pickupAddress', 'pickupLat', 'pickupLng', 'destAddress', 'destLat', 'destLng', 'packageLabel', 'vehicle', 'packageSize', 'fare', 'senderPhone', 'recipientPhone', 'scheduledAt', 'driverNote'] as const
  for (const key of editable) {
    if (key in patch) (job as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key]
  }
  job.updatedAt = new Date().toISOString()
  await saveJob(job)
  return { ok: true as const, job }
}

export async function setDeliveryPhotoCount(id: string, count: number) {
  const job = await getJob(id)
  if (!job) return
  job.photoCount = count
  job.updatedAt = new Date().toISOString()
  await saveJob(job)
}

/** 배송비 결제 수단/완료 기록 — 발신인 소유 건만. 배정 후에도 결제 표시는 허용한다. */
export async function markDeliveryPayment(id: string, ownerId: string, method: 'prepay_pi' | 'onsite_qr', txid: string | null) {
  const job = await getJob(id)
  if (!job) return { ok: false as const, error: 'not_found' as const, job: null }
  if (job.ownerId && job.ownerId !== ownerId) return { ok: false as const, error: 'forbidden' as const, job: null }
  job.paymentMethod = method
  if (txid) {
    job.paymentTxid = txid
    job.paidAt = new Date().toISOString()
  }
  job.updatedAt = new Date().toISOString()
  await saveJob(job)
  return { ok: true as const, job }
}

/** 미배차 건 삭제 — 발신인 취소. */
export async function deleteDeliveryDispatch(id: string, ownerId: string) {
  const job = await getJob(id)
  if (!job) return { ok: false as const, error: 'not_found' as const }
  if (job.ownerId && job.ownerId !== ownerId) return { ok: false as const, error: 'forbidden' as const }
  if (job.status !== 'requested') return { ok: false as const, error: 'already_assigned' as const }
  if (useKv) {
    await kvDeleteJob(id)
  } else {
    db().jobs.delete(id)
    persist()
  }
  return { ok: true as const }
}

/** 기사에게 배정·수행 중인 건 — 기사 화면의 수락 건 복원 폴링용. */
export async function listAssignedByDriver(driverId: string) {
  return (await listJobs())
    .filter((job) => (job.status === 'assigned' || job.status === 'in_transit') && job.driverId === driverId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

/** 전체 이력(상태 무관) — 관리자 택배 현황·과거 검색용, 최신순. */
export async function listAllDeliveries() {
  return (await listJobs()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

const DELIVERY_STAGE_ORDER: Record<DeliveryDispatchStatus, number> = { requested: 0, assigned: 1, in_transit: 2, completed: 3 }

/** 배정 기사의 진행 표시 — assigned → in_transit → completed 순방향만 허용한다. */
export async function progressDeliveryDispatch(id: string, driverId: string, next: 'in_transit' | 'completed') {
  const job = await getJob(id)
  if (!job) return { ok: false as const, error: 'not_found' as const, job: null }
  if (!job.driverId || job.driverId !== driverId) return { ok: false as const, error: 'forbidden' as const, job }
  if (job.status === 'requested') return { ok: false as const, error: 'invalid_transition' as const, job }
  if (DELIVERY_STAGE_ORDER[job.status] === DELIVERY_STAGE_ORDER[next]) return { ok: true as const, job }
  if (DELIVERY_STAGE_ORDER[next] < DELIVERY_STAGE_ORDER[job.status]) return { ok: false as const, error: 'invalid_transition' as const, job }
  job.status = next
  job.updatedAt = new Date().toISOString()
  await saveJob(job)
  return { ok: true as const, job }
}

export async function listOpenDeliveries() {
  return (await listJobs()).filter((job) => job.status === 'requested').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export async function acceptDeliveryDispatch(id: string, driver: { driverId: string; name: string; vehicle: string; plate: string; phone?: string }) {
  const job = await getJob(id)
  if (!job) return { ok: false as const, error: 'not_found', job: null }
  if (job.status !== 'requested') {
    if (job.status === 'assigned' && job.driverId === driver.driverId) return { ok: true as const, job }
    return { ok: false as const, error: 'already_assigned', job }
  }
  job.status = 'assigned'
  job.driverId = driver.driverId
  job.driverName = driver.name.trim() || '기사'
  job.driverVehicle = driver.vehicle.trim()
  job.driverPlate = driver.plate.trim()
  job.driverPhone = driver.phone?.trim() || null
  job.updatedAt = new Date().toISOString()
  await saveJob(job)
  return { ok: true as const, job }
}

export function publicDelivery(job: DeliveryDispatch, viewerId?: string) {
  const mine = Boolean(viewerId && job.driverId === viewerId)
  const owner = Boolean(viewerId && job.ownerId === viewerId)
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
    driverNote: job.driverNote || '',
    driverName: job.driverName,
    driverVehicle: job.driverVehicle,
    driverPlate: job.driverPlate,
    photoCount: job.photoCount ?? 0,
    paymentMethod: job.paymentMethod ?? null,
    paidAt: job.paidAt ?? null,
    // 발신·수신 연락처 — 배정된 기사(mine)와 등록한 발신인(owner) 본인에게만 노출.
    senderPhone: (job.status !== 'requested' && mine) || owner ? job.senderPhone : '',
    recipientPhone: (job.status !== 'requested' && mine) || owner ? job.recipientPhone : '',
    // 기사 연락처 — 배정 후 당사자(기사 또는 발신인)에게만 노출.
    driverPhone: job.status !== 'requested' && (mine || owner) ? (job.driverPhone ?? '') : '',
    createdAt: job.createdAt,
  }
}
