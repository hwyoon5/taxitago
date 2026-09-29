import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

export type DeliveryDispatchStatus = 'requested' | 'assigned'

export type DeliveryDispatch = {
  id: string
  pickupAddress: string
  destAddress: string
  packageLabel: string
  fare: number
  senderPhone: string
  recipientPhone: string
  status: DeliveryDispatchStatus
  driverId: string | null
  driverName: string | null
  driverVehicle: string | null
  driverPlate: string | null
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

export function listOpenDeliveries() {
  return [...db().jobs.values()].filter((job) => job.status === 'requested').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function acceptDeliveryDispatch(id: string, driver: { driverId: string; name: string; vehicle: string; plate: string }) {
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
    status: job.status,
    driverName: job.driverName,
    driverVehicle: job.driverVehicle,
    driverPlate: job.driverPlate,
    senderPhone: job.status === 'assigned' && mine ? job.senderPhone : '',
    recipientPhone: job.status === 'assigned' && mine ? job.recipientPhone : '',
    createdAt: job.createdAt,
  }
}
