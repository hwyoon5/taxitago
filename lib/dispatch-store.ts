import { BUSAN_CITY_HALL } from '@/lib/user-location'
import type { DriverRecord, RideRequestRecord } from '@/lib/dispatch-types'

type DispatchDb = {
  rides: Map<string, RideRequestRecord>
  drivers: Map<string, DriverRecord>
  seeded: boolean
}

function db(): DispatchDb {
  const globalStore = globalThis as typeof globalThis & { __taxitagoDispatch?: DispatchDb }
  if (!globalStore.__taxitagoDispatch) {
    globalStore.__taxitagoDispatch = {
      rides: new Map(),
      drivers: new Map(),
      seeded: false,
    }
  }
  return globalStore.__taxitagoDispatch
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
    virtual: true,
  },
]

export function ensureSeedDrivers() {
  const store = db()
  if (store.seeded) return
  const now = new Date().toISOString()
  for (const driver of SEED_DRIVERS) {
    store.drivers.set(driver.id, { ...driver, status: 'online', lastSeenAt: now })
  }
  store.seeded = true
}

export function getRide(id: string) {
  return db().rides.get(id) ?? null
}

export function saveRide(ride: RideRequestRecord) {
  db().rides.set(ride.id, ride)
  return ride
}

export function listSearchingRides() {
  return [...db().rides.values()].filter((ride) => ride.status === 'searching' || ride.status === 'offered')
}

export function getDriver(id: string) {
  ensureSeedDrivers()
  return db().drivers.get(id) ?? null
}

export function saveDriver(driver: DriverRecord) {
  ensureSeedDrivers()
  db().drivers.set(driver.id, driver)
  return driver
}

export function listDrivers() {
  ensureSeedDrivers()
  return [...db().drivers.values()]
}

export function nowIso() {
  return new Date().toISOString()
}
