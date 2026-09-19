import { etaMinutesFromKm, haversineKm } from '@/lib/dispatch-geo'
import { getEscrowByRide } from '@/lib/escrow-store'
import { openEscrowForRide, lockEscrow, refundEscrow, toPublicEscrow } from '@/lib/escrow-engine'
import { archiveRideComms, openRideComms } from '@/lib/comms-engine'
import {
  ensureSeedDrivers,
  getDriver,
  getRide,
  listDrivers,
  listRides,
  listSearchingRides,
  nowIso,
  saveDriver,
  saveRide,
} from '@/lib/dispatch-store'
import {
  DRIVER_STALE_MS,
  MATCH_RADIUS_KM,
  OFFER_TIMEOUT_MS,
  type DriverRecord,
  type PublicRide,
  type RideOfferRecord,
  type RideRequestRecord,
} from '@/lib/dispatch-types'

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function clearRideTimer(rideId: string) {
  const timer = timers.get(rideId)
  if (timer) clearTimeout(timer)
  timers.delete(rideId)
}

export function toPublicRide(ride: RideRequestRecord): PublicRide {
  const assigned = ride.assignedDriverId ? getDriver(ride.assignedDriverId) : null
  const pickupKm = assigned
    ? haversineKm({ lat: assigned.lat, lng: assigned.lng }, ride.pickup)
    : ride.currentOffer?.pickupDistanceKm ?? 0
  return {
    id: ride.id,
    passengerId: ride.passengerId,
    pickup: ride.pickup,
    dest: ride.dest,
    estimatedFare: ride.estimatedFare,
    status: ride.status,
    offerExpiresAt: ride.currentOffer?.decision === 'pending' ? ride.currentOffer.expiresAt : null,
    pendingOffer:
      ride.currentOffer?.decision === 'pending'
        ? {
            driverId: ride.currentOffer.driverId,
            driverName: getDriver(ride.currentOffer.driverId)?.name || '기사',
          }
        : null,
    assignedDriver: assigned
      ? {
          id: assigned.id,
          name: assigned.name,
          vehicle: assigned.vehicle,
          plate: assigned.plate,
          rating: assigned.rating,
          etaMinutes: etaMinutesFromKm(pickupKm),
          pickupDistanceKm: Math.round(pickupKm * 10) / 10,
        }
      : null,
    escrow: toPublicEscrow(getEscrowByRide(ride.id)),
    createdAt: ride.createdAt,
    updatedAt: ride.updatedAt,
  }
}

function isDriverEligible(driver: DriverRecord, ride: RideRequestRecord, now: number) {
  if (driver.status !== 'online') return false
  if (ride.declinedDriverIds.includes(driver.id)) return false
  if (ride.timedOutDriverIds.includes(driver.id)) return false
  const staleMs = now - Date.parse(driver.lastSeenAt)
  if (!driver.virtual && Number.isFinite(staleMs) && staleMs > DRIVER_STALE_MS) return false
  return haversineKm({ lat: driver.lat, lng: driver.lng }, ride.pickup) <= MATCH_RADIUS_KM
}

function rankedCandidates(ride: RideRequestRecord) {
  const now = Date.now()
  return listDrivers()
    .filter((driver) => isDriverEligible(driver, ride, now))
    .map((driver) => ({
      driver,
      km: haversineKm({ lat: driver.lat, lng: driver.lng }, ride.pickup),
    }))
    .sort((a, b) => {
      if (a.km !== b.km) return a.km - b.km
      if (a.driver.virtual !== b.driver.virtual) return Number(a.driver.virtual) - Number(b.driver.virtual)
      return a.driver.id.localeCompare(b.driver.id)
    })
}

function stamp(ride: RideRequestRecord) {
  ride.updatedAt = nowIso()
  return saveRide(ride)
}

function scheduleOfferWatch(ride: RideRequestRecord) {
  clearRideTimer(ride.id)
  const offer = ride.currentOffer
  if (!offer || offer.decision !== 'pending') return
  const delay = Math.max(250, Date.parse(offer.expiresAt) - Date.now())
  const timer = setTimeout(() => {
    timers.delete(ride.id)
    expireCurrentOffer(ride.id)
  }, delay)
  timers.set(ride.id, timer)
}

function offerToDriver(ride: RideRequestRecord, driver: DriverRecord, km: number, rank: number) {
  const offeredAt = Date.now()
  const offer: RideOfferRecord = {
    rideId: ride.id,
    driverId: driver.id,
    rank,
    pickupDistanceKm: Math.round(km * 10) / 10,
    offeredAt: new Date(offeredAt).toISOString(),
    expiresAt: new Date(offeredAt + OFFER_TIMEOUT_MS).toISOString(),
    decision: 'pending',
  }
  ride.status = 'offered'
  ride.currentOffer = offer
  stamp(ride)
  scheduleOfferWatch(ride)
  return ride
}

export function assignNextDriver(rideId: string) {
  const ride = getRide(rideId)
  if (!ride) return null
  if (ride.status === 'assigned' || ride.status === 'cancelled' || ride.status === 'completed') return ride
  const queue = rankedCandidates(ride)
  const next = queue[0]
  if (!next) {
    ride.status = 'unmatched'
    ride.currentOffer = null
    ride.assignedDriverId = null
    return stamp(ride)
  }
  const rank = ride.declinedDriverIds.length + ride.timedOutDriverIds.length + 1
  return offerToDriver(ride, next.driver, next.km, rank)
}

export function expireCurrentOffer(rideId: string) {
  const ride = getRide(rideId)
  if (!ride?.currentOffer || ride.currentOffer.decision !== 'pending') return ride
  ride.timedOutDriverIds = [...new Set([...ride.timedOutDriverIds, ride.currentOffer.driverId])]
  ride.currentOffer = { ...ride.currentOffer, decision: 'timeout' }
  ride.status = 'searching'
  stamp(ride)
  return assignNextDriver(ride.id)
}

export function refreshRideTimers(ride: RideRequestRecord) {
  if (ride.status !== 'offered' || ride.currentOffer?.decision !== 'pending') return ride
  if (Date.now() >= Date.parse(ride.currentOffer.expiresAt)) {
    return expireCurrentOffer(ride.id) ?? ride
  }
  return ride
}

export function createRideAndMatch(input: {
  id: string
  passengerId: string
  pickup: RideRequestRecord['pickup']
  dest: RideRequestRecord['dest']
  estimatedFare: number
}) {
  const createdAt = nowIso()
  const ride = saveRide({
    ...input,
    status: 'searching',
    assignedDriverId: null,
    currentOffer: null,
    declinedDriverIds: [],
    timedOutDriverIds: [],
    createdAt,
    updatedAt: createdAt,
  })
  return assignNextDriver(ride.id) ?? ride
}

export function cancelRide(rideId: string, passengerId?: string) {
  const ride = getRide(rideId)
  if (!ride) return null
  if (passengerId && ride.passengerId !== passengerId) return ride
  if (ride.status === 'completed') return ride
  clearRideTimer(ride.id)
  if (ride.assignedDriverId) {
    const driver = getDriver(ride.assignedDriverId)
    if (driver && driver.status === 'busy' && !driver.virtual) {
      saveDriver({ ...driver, status: 'online', lastSeenAt: nowIso() })
    }
    if (driver?.virtual) {
      saveDriver({ ...driver, status: 'online', lastSeenAt: nowIso() })
    }
  }
  ride.status = 'cancelled'
  if (ride.currentOffer?.decision === 'pending') {
    ride.currentOffer = { ...ride.currentOffer, decision: 'timeout' }
  }
  refundEscrow(ride.id)
  archiveRideComms(ride.id, 'cancelled')
  return stamp(ride)
}

export function respondToOffer(rideId: string, driverId: string, action: 'accept' | 'reject') {
  const latest = getRide(rideId)
  if (!latest) return { ok: false as const, error: 'not_found', ride: null }
  const ride = refreshRideTimers(latest) ?? getRide(rideId)
  if (!ride) return { ok: false as const, error: 'not_found', ride: null }

  if (ride.status === 'assigned') {
    if (ride.assignedDriverId === driverId) return { ok: true as const, ride }
    return { ok: false as const, error: 'already_assigned', ride }
  }
  if (ride.status === 'cancelled' || ride.status === 'unmatched' || ride.status === 'completed') {
    return { ok: false as const, error: ride.status, ride }
  }
  if (!ride.currentOffer || ride.currentOffer.driverId !== driverId || ride.currentOffer.decision !== 'pending') {
    return { ok: false as const, error: 'not_your_offer', ride }
  }

  clearRideTimer(ride.id)
  if (action === 'reject') {
    ride.declinedDriverIds = [...new Set([...ride.declinedDriverIds, driverId])]
    ride.currentOffer = { ...ride.currentOffer, decision: 'rejected' }
    ride.status = 'searching'
    stamp(ride)
    return { ok: true as const, ride: assignNextDriver(ride.id) ?? ride }
  }

  const driver = getDriver(driverId)
  if (!driver || driver.status === 'offline') {
    ride.timedOutDriverIds = [...new Set([...ride.timedOutDriverIds, driverId])]
    ride.currentOffer = { ...ride.currentOffer, decision: 'timeout' }
    ride.status = 'searching'
    stamp(ride)
    return { ok: false as const, error: 'driver_unavailable', ride: assignNextDriver(ride.id) ?? ride }
  }

  ride.currentOffer = { ...ride.currentOffer, decision: 'accepted' }
  ride.assignedDriverId = driverId
  ride.status = 'assigned'
  stamp(ride)
  saveDriver({ ...driver, status: 'busy', lastSeenAt: nowIso() })
  openEscrowForRide(ride.id)
  openRideComms(ride.id)
  return { ok: true as const, ride }
}

export function confirmMatchOnDevice(rideId: string) {
  ensureSeedDrivers()
  const ride = getRide(rideId)
  if (!ride) return { ok: false as const, error: 'not_found', ride: null }
  if (ride.status === 'assigned') return { ok: true as const, ride }
  if (ride.status === 'cancelled' || ride.status === 'completed') {
    return { ok: false as const, error: ride.status, ride }
  }
  if (ride.status === 'unmatched') {
    ride.status = 'searching'
    ride.timedOutDriverIds = []
    ride.declinedDriverIds = []
    ride.currentOffer = null
  }
  clearRideTimer(ride.id)
  const offeredId = ride.currentOffer?.driverId
  let driver = offeredId ? getDriver(offeredId) : null
  if (!driver) driver = rankedCandidates(ride)[0]?.driver ?? listDrivers()[0] ?? null
  if (!driver) return { ok: false as const, error: 'no_driver', ride }
  saveDriver({ ...driver, status: 'online', lastSeenAt: nowIso() })
  ride.currentOffer = {
    rideId: ride.id,
    driverId: driver.id,
    rank: ride.currentOffer?.rank ?? 1,
    pickupDistanceKm: ride.currentOffer?.pickupDistanceKm ?? 0,
    offeredAt: ride.currentOffer?.offeredAt ?? nowIso(),
    expiresAt: ride.currentOffer?.expiresAt ?? nowIso(),
    decision: 'accepted',
  }
  ride.assignedDriverId = driver.id
  ride.status = 'assigned'
  stamp(ride)
  saveDriver({ ...driver, status: 'busy', lastSeenAt: nowIso() })
  openEscrowForRide(ride.id)
  openRideComms(ride.id)
  lockEscrow({ rideId: ride.id, passengerId: ride.passengerId, sandbox: true })
  return { ok: true as const, ride: getRide(ride.id) ?? ride }
}

export function getPublicRide(rideId: string) {
  const ride = getRide(rideId)
  if (!ride) return null
  return toPublicRide(refreshRideTimers(ride) ?? ride)
}

export function completeAssignedRide(rideId: string, driverId: string) {
  const ride = getRide(rideId)
  if (!ride) return null
  if (ride.assignedDriverId !== driverId) return ride
  ride.status = 'completed'
  stamp(ride)
  archiveRideComms(rideId, 'completed')
  return ride
}

export function getDriverActiveRide(driverId: string) {
  const ride = listRides().find((item) => item.assignedDriverId === driverId && item.status === 'assigned')
  return ride ? toPublicRide(ride) : null
}

export function getDriverOffer(driverId: string) {
  for (const ride of listSearchingRides()) {
    const live = refreshRideTimers(ride) ?? getRide(ride.id)
    if (!live) continue
    if (live.currentOffer?.driverId === driverId && live.currentOffer.decision === 'pending') {
      return { ride: toPublicRide(live), offer: live.currentOffer }
    }
  }
  return null
}

export function upsertDriverPresence(input: {
  id: string
  name?: string
  vehicle?: string
  plate?: string
  rating?: string
  lat: number
  lng: number
  status: 'online' | 'offline'
  wallet?: string
  piUid?: string
}) {
  const current = getDriver(input.id)
  const next: DriverRecord = {
    id: input.id,
    name: input.name?.trim() || current?.name || '파트너 기사',
    vehicle: input.vehicle?.trim() || current?.vehicle || '택시',
    plate: input.plate?.trim() || current?.plate || '미등록',
    rating: input.rating?.trim() || current?.rating || '5.00',
    lat: input.lat,
    lng: input.lng,
    status: input.status === 'offline' ? 'offline' : current?.status === 'busy' ? 'busy' : 'online',
    lastSeenAt: nowIso(),
    virtual: false,
    wallet: input.wallet?.trim() || current?.wallet,
    piUid: input.piUid?.trim() || current?.piUid,
  }
  return saveDriver(next)
}
