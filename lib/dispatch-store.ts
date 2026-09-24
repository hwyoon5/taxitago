import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { BUSAN_CITY_HALL } from '@/lib/user-location'
import type { DriverRecord, RideRequestRecord } from '@/lib/dispatch-types'

type LiveListener = (payload: string) => void

type DispatchDb = {
  rides: Map<string, RideRequestRecord>
  drivers: Map<string, DriverRecord>
  listeners: Map<string, Set<LiveListener>>
  seeded: boolean
  hydrated: boolean
}

type PersistShape = {
  rides: RideRequestRecord[]
  drivers: DriverRecord[]
  seeded: boolean
}

const persistFile = path.join(process.cwd(), 'data', 'dispatch.json')
let persistTimer: ReturnType<typeof setTimeout> | null = null

function db(): DispatchDb {
  const globalStore = globalThis as typeof globalThis & { __taxitagoDispatch?: DispatchDb }
  if (!globalStore.__taxitagoDispatch) {
    globalStore.__taxitagoDispatch = {
      rides: new Map(),
      drivers: new Map(),
      listeners: new Map(),
      seeded: false,
      hydrated: false,
    }
  }
  if (!globalStore.__taxitagoDispatch.hydrated) {
    hydrateFromDisk(globalStore.__taxitagoDispatch)
  }
  return globalStore.__taxitagoDispatch
}

function hydrateFromDisk(store: DispatchDb) {
  store.hydrated = true
  try {
    if (!existsSync(persistFile)) return
    const parsed = JSON.parse(readFileSync(persistFile, 'utf8')) as PersistShape
    for (const ride of parsed.rides ?? []) {
      store.rides.set(ride.id, { ...ride, kind: ride.kind === 'daeri' ? 'daeri' : 'taxi' })
    }
    for (const driver of parsed.drivers ?? []) {
      store.drivers.set(driver.id, {
        ...driver,
        heading: Number.isFinite(driver.heading) ? driver.heading : 0,
      })
    }
    store.seeded = Boolean(parsed.seeded) || store.drivers.size > 0
  } catch {
    undefined
  }
}

function persist() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    writePersistNow()
  }, 250)
}

function writePersistNow() {
  const store = db()
  try {
    mkdirSync(path.dirname(persistFile), { recursive: true })
    const payload: PersistShape = {
      rides: [...store.rides.values()],
      drivers: [...store.drivers.values()],
      seeded: store.seeded,
    }
    writeFileSync(persistFile, JSON.stringify(payload), 'utf8')
  } catch {
    undefined
  }
}

const SEED_DRIVERS: Omit<DriverRecord, 'lastSeenAt' | 'status'>[] = [
  {
    id: 'virtual-kim',
    name: '김민수',
    vehicle: '현대 아슬란',
    plate: '서울 31바 1842',
    rating: '4.97',
    lat: BUSAN_CITY_HALL.lat + 0.006,
    lng: BUSAN_CITY_HALL.lng + 0.004,
    heading: 140,
    virtual: true,
  },
  {
    id: 'virtual-park',
    name: '박지훈',
    vehicle: '기아 K5',
    plate: '부산 12너 5521',
    rating: '4.91',
    lat: BUSAN_CITY_HALL.lat - 0.01,
    lng: BUSAN_CITY_HALL.lng + 0.008,
    heading: 40,
    virtual: true,
  },
  {
    id: 'virtual-lee',
    name: '이수연',
    vehicle: '현대 소나타',
    plate: '경남 88다 3309',
    rating: '4.88',
    lat: BUSAN_CITY_HALL.lat + 0.014,
    lng: BUSAN_CITY_HALL.lng - 0.007,
    heading: 220,
    virtual: true,
  },
]

export function ensureSeedDrivers() {
  const store = db()
  if (store.seeded) return
  const now = new Date().toISOString()
  for (const driver of SEED_DRIVERS) {
    store.drivers.set(driver.id, {
      ...driver,
      status: 'online',
      lastSeenAt: now,
      wallet: `GBVIRTUAL-${driver.id.replace('virtual-', '').toUpperCase()}-WALLET`,
      piUid: driver.id,
    })
  }
  store.seeded = true
  persist()
}

export function getRide(id: string) {
  return db().rides.get(id) ?? null
}

export function saveRide(ride: RideRequestRecord) {
  db().rides.set(ride.id, ride)
  writePersistNow()
  publishRideLive(ride.id)
  return ride
}

export function listRides() {
  return [...db().rides.values()]
}

export function listSearchingRides() {
  return listRides().filter((ride) => ride.status === 'searching' || ride.status === 'offered')
}

export function getDriver(id: string) {
  ensureSeedDrivers()
  return db().drivers.get(id) ?? null
}

export function saveDriver(driver: DriverRecord) {
  ensureSeedDrivers()
  db().drivers.set(driver.id, driver)
  persist()
  const assigned = listRides().find((ride) => ride.assignedDriverId === driver.id && ride.status === 'assigned')
  if (assigned) publishRideLive(assigned.id)
  return driver
}

export function listDrivers() {
  ensureSeedDrivers()
  return [...db().drivers.values()]
}

export function nowIso() {
  return new Date().toISOString()
}

export function subscribeRideLive(rideId: string, listener: LiveListener) {
  const store = db()
  const set = store.listeners.get(rideId) ?? new Set<LiveListener>()
  set.add(listener)
  store.listeners.set(rideId, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) store.listeners.delete(rideId)
  }
}

export function publishRideLive(rideId: string) {
  const listeners = db().listeners.get(rideId)
  if (!listeners?.size) return
  const encoded = `event: ride\ndata: ${JSON.stringify({ rideId, at: nowIso() })}\n\n`
  for (const listener of listeners) listener(encoded)
}
