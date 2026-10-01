import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { BUSAN_CITY_HALL } from '@/lib/user-location'
import type { DriverRecord, RideRequestRecord } from '@/lib/dispatch-types'

type LiveListener = (payload: string) => void

type DispatchDb = {
  rides: Map<string, RideRequestRecord>
  drivers: Map<string, DriverRecord>
  listeners: Map<string, Set<LiveListener>>
  driverListeners: Map<string, Set<() => void>>
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

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)
const dispatchKvKey = 'taxitago:dispatch:state'

let warnedEphemeral = false
function warnEphemeral() {
  if (warnedEphemeral || !process.env.VERCEL || useKv) return
  warnedEphemeral = true
  console.error('[dispatch-store] no KV configured on Vercel — ride state is NOT shared across instances (set KV_REST_API_URL/KV_REST_API_TOKEN)')
}

async function kvCommand<T>(command: (string | number)[]): Promise<T | null> {
  const res = await fetch(kvUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`kv request failed: ${res.status}`)
  const data = (await res.json()) as { result?: T | null }
  return data.result ?? null
}

async function fetchKvState(): Promise<PersistShape | null> {
  const raw = await kvCommand<string | null>(['GET', dispatchKvKey])
  if (!raw) return null
  try {
    return JSON.parse(raw) as PersistShape
  } catch {
    return null
  }
}

const RIDE_STATUS_RANK: Record<string, number> = {
  searching: 0,
  offered: 0,
  unmatched: 0,
  assigned: 1,
  cancelled: 2,
  completed: 2,
}

function rideShouldReplace(current: RideRequestRecord | undefined, incoming: RideRequestRecord) {
  if (!current) return true
  const currentRank = RIDE_STATUS_RANK[current.status] ?? 0
  const incomingRank = RIDE_STATUS_RANK[incoming.status] ?? 0
  if (incomingRank < currentRank) return false
  if (incomingRank > currentRank) return true
  return !(Date.parse(current.updatedAt || '') > Date.parse(incoming.updatedAt || ''))
}

let kvPullAt = 0
let kvPulling = false

export async function hydrateDispatchFromKv() {
  if (!useKv) {
    warnEphemeral()
    return
  }
  kvPullAt = Date.now()
  try {
    const parsed = await fetchKvState()
    if (parsed) mergePersisted(db(), parsed)
  } catch {
    undefined
  }
}

function mergePersisted(store: DispatchDb, parsed: PersistShape) {
  for (const ride of parsed.rides ?? []) {
    const current = store.rides.get(ride.id)
    if (rideShouldReplace(current, ride)) {
      store.rides.set(ride.id, { ...ride, kind: ride.kind === 'daeri' ? 'daeri' : 'taxi' })
    }
  }
  for (const driver of parsed.drivers ?? []) {
    const current = store.drivers.get(driver.id)
    const incomingAt = Date.parse(driver.lastSeenAt || '')
    const currentAt = Date.parse(current?.lastSeenAt || '')
    if (!current || !(currentAt > incomingAt)) {
      store.drivers.set(driver.id, {
        ...driver,
        heading: Number.isFinite(driver.heading) ? driver.heading : 0,
      })
    }
  }
  store.seeded = store.seeded || Boolean(parsed.seeded)
}

function pullFromKv() {
  if (!useKv) {
    warnEphemeral()
    return
  }
  const now = Date.now()
  if (kvPulling || now - kvPullAt < 1500) return
  kvPullAt = now
  kvPulling = true
  void fetchKvState().then((parsed) => {
    if (parsed) mergePersisted(db(), parsed)
  }).catch(() => undefined).finally(() => {
    kvPulling = false
  })
}

function db(): DispatchDb {
  const globalStore = globalThis as typeof globalThis & { __taxitagoDispatch?: DispatchDb }
  if (!globalStore.__taxitagoDispatch) {
    globalStore.__taxitagoDispatch = {
      rides: new Map(),
      drivers: new Map(),
      listeners: new Map(),
      driverListeners: new Map(),
      seeded: false,
      hydrated: false,
    }
  }
  if (!globalStore.__taxitagoDispatch.hydrated) {
    hydrateFromDisk(globalStore.__taxitagoDispatch)
  }
  return globalStore.__taxitagoDispatch
}

export function syncDispatchFromDisk() {
  const store = db()
  try {
    if (existsSync(persistFile)) {
      mergePersisted(store, JSON.parse(readFileSync(persistFile, 'utf8')) as PersistShape)
    }
  } catch (error) {
    console.error('[dispatch] disk sync failed', error instanceof Error ? error.message : 'read error')
  }
  pullFromKv()
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
    if (useKv) {
      return fetchKvState()
        .then((remote) => {
          let merged = payload
          if (remote) {
            const rideMap = new Map(payload.rides.map((ride) => [ride.id, ride]))
            for (const ride of remote.rides ?? []) {
              const local = rideMap.get(ride.id)
              if (rideShouldReplace(local, ride)) rideMap.set(ride.id, ride)
            }
            const driverMap = new Map(payload.drivers.map((driver) => [driver.id, driver]))
            for (const driver of remote.drivers ?? []) {
              const local = driverMap.get(driver.id)
              if (!local || Date.parse(driver.lastSeenAt || '') > Date.parse(local.lastSeenAt || '')) driverMap.set(driver.id, driver)
            }
            merged = { rides: [...rideMap.values()], drivers: [...driverMap.values()], seeded: payload.seeded || Boolean(remote.seeded) }
          }
          return kvCommand(['SET', dispatchKvKey, JSON.stringify(merged)])
        })
        .then(() => undefined)
        .catch((error) => {
          console.error('[dispatch-store] kv persist failed', error instanceof Error ? error.message : 'write error')
        })
    }
  } catch {
    undefined
  }
}

export async function flushDispatchPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  await writePersistNow()
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

function driverListenerMap() {
  const store = db()
  if (!store.driverListeners) store.driverListeners = new Map()
  return store.driverListeners
}

export function subscribeDriverLive(driverId: string, listener: () => void) {
  const id = driverId.trim()
  if (!id) return () => undefined
  const map = driverListenerMap()
  const set = map.get(id) ?? new Set<() => void>()
  set.add(listener)
  map.set(id, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) map.delete(id)
  }
}

export function publishDriverLive(driverId: string) {
  const set = driverListenerMap().get(driverId.trim())
  if (!set?.size) return
  for (const listener of set) listener()
}
