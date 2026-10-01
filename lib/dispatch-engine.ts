import { etaMinutesFromKm, haversineKm, headingDegrees, stepToward } from '@/lib/dispatch-geo'
import { getEscrowByRide, syncEscrowFromDisk } from '@/lib/escrow-store'
import { openEscrowForRide, lockEscrow, refundEscrow, toPublicEscrow } from '@/lib/escrow-engine'
import { isPiSandboxEnv } from '@/lib/pi-sandbox'
import { archiveRideComms, openRideComms } from '@/lib/comms-engine'
import {
  ensureSeedDrivers,
  getDriver,
  getRide,
  listDrivers,
  listRides,
  listSearchingRides,
  nowIso,
  publishDriverLive,
  saveDriver,
  saveRide,
  subscribeRideLive,
  syncDispatchFromDisk,
} from '@/lib/dispatch-store'
import { sendDriverPush } from '@/lib/driver-push'
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
const virtualAcceptTimers = new Map<string, ReturnType<typeof setTimeout>>()
const liveMoveTimers = new Map<string, ReturnType<typeof setInterval>>()

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
    kind: ride.kind === 'daeri' ? 'daeri' : 'taxi',
    assignedDriver: assigned
      ? {
          id: assigned.id,
          name: assigned.name,
          vehicle: assigned.vehicle,
          plate: assigned.plate,
          rating: assigned.rating,
          etaMinutes: etaMinutesFromKm(pickupKm),
          pickupDistanceKm: Math.round(pickupKm * 10) / 10,
          lat: assigned.lat,
          lng: assigned.lng,
          heading: assigned.heading ?? 0,
          updatedAt: assigned.lastSeenAt,
        }
      : null,
    escrow: toPublicEscrow(getEscrowByRide(ride.id)),
    boardedAt: ride.boardedAt ?? null,
    readyToSettleAt: ride.readyToSettleAt ?? null,
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

function scheduleOfferWatch(ride: RideRequestRecord, restart = true) {
  if (!restart && timers.has(ride.id)) return
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
  publishDriverLive(driver.id)
  const pickup = ride.pickup.address || ride.pickup.label || '출발지'
  const dest = ride.dest.label || ride.dest.address || '목적지'
  console.log('[dispatch] offered ride', { rideId: ride.id, driverId: driver.id })
  void sendDriverPush(driver.id, {
    title: '새로운 운행 요청',
    body: `${pickup} → ${dest}`,
    tag: `taxitago-offer-${ride.id}`,
    url: '/?driver=1',
    rideId: ride.id,
    expiresAt: offer.expiresAt,
    pickupDistanceKm: offer.pickupDistanceKm,
    ride: {
      id: ride.id,
      passengerId: ride.passengerId,
      kind: ride.kind === 'daeri' ? 'daeri' : 'taxi',
      pickup: ride.pickup,
      dest: ride.dest,
      estimatedFare: ride.estimatedFare,
    },
  })
  return ride
}

function clearVirtualAccept(rideId: string) {
  const timer = virtualAcceptTimers.get(rideId)
  if (timer) clearTimeout(timer)
  virtualAcceptTimers.delete(rideId)
}

function stopLiveDriverMove(rideId: string) {
  const timer = liveMoveTimers.get(rideId)
  if (timer) clearInterval(timer)
  liveMoveTimers.delete(rideId)
}

export function startLiveDriverTracking(rideId: string) {
  if (liveMoveTimers.has(rideId)) return
  const timer = setInterval(() => {
    const ride = getRide(rideId)
    if (!ride || ride.status !== 'assigned' || !ride.assignedDriverId) {
      stopLiveDriverMove(rideId)
      return
    }
    const driver = getDriver(ride.assignedDriverId)
    if (!driver?.virtual) return
    const pickupKm = haversineKm({ lat: driver.lat, lng: driver.lng }, ride.pickup)
    const target = pickupKm > 0.08 ? ride.pickup : ride.dest
    const next = stepToward(driver, target, 0.18)
    saveDriver({
      ...driver,
      lat: next.lat,
      lng: next.lng,
      heading: headingDegrees(driver, next),
      lastSeenAt: nowIso(),
      status: 'busy',
    })
  }, 1000)
  liveMoveTimers.set(rideId, timer)
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
  const previousDriverId = ride.currentOffer.driverId
  ride.timedOutDriverIds = [...new Set([...ride.timedOutDriverIds, previousDriverId])]
  ride.currentOffer = { ...ride.currentOffer, decision: 'timeout' }
  ride.status = 'searching'
  stamp(ride)
  publishDriverLive(previousDriverId)
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
  kind?: RideRequestRecord['kind']
  passengerId: string
  pickup: RideRequestRecord['pickup']
  dest: RideRequestRecord['dest']
  estimatedFare: number
}) {
  const createdAt = nowIso()
  const ride = saveRide({
    ...input,
    kind: input.kind === 'daeri' ? 'daeri' : 'taxi',
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
  syncDispatchFromDisk()
  const ride = getRide(rideId)
  if (!ride) return null
  if (passengerId && ride.passengerId !== passengerId) return ride
  if (ride.status === 'completed') return ride
  clearRideTimer(ride.id)
  clearVirtualAccept(ride.id)
  stopLiveDriverMove(ride.id)
  const offeredDriverId = ride.currentOffer?.decision === 'pending' ? ride.currentOffer.driverId : ''
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
  void archiveRideComms(ride.id, 'cancelled')
  const cancelled = stamp(ride)
  if (offeredDriverId) publishDriverLive(offeredDriverId)
  if (ride.assignedDriverId) publishDriverLive(ride.assignedDriverId)
  return cancelled
}

export function markRideProgress(
  rideId: string,
  passengerId: string,
  step: 'boarded' | 'arrived',
  snapshot?: {
    pickup?: RideRequestRecord['pickup']
    dest?: RideRequestRecord['dest']
    estimatedFare?: number
    kind?: RideRequestRecord['kind']
    boardedAt?: string | null
    driverId?: string | null
  },
) {
  syncDispatchFromDisk()
  let ride = getRide(rideId)
  if (!ride && snapshot?.pickup && snapshot.dest) {
    const createdAt = nowIso()
    ride = saveRide({
      id: rideId,
      kind: snapshot.kind === 'daeri' ? 'daeri' : 'taxi',
      passengerId,
      pickup: snapshot.pickup,
      dest: snapshot.dest,
      estimatedFare: Number.isFinite(snapshot.estimatedFare) ? Number(snapshot.estimatedFare) : 0,
      status: 'assigned',
      assignedDriverId: snapshot.driverId || null,
      currentOffer: null,
      declinedDriverIds: [],
      timedOutDriverIds: [],
      boardedAt: snapshot.boardedAt || (step === 'arrived' ? createdAt : null),
      createdAt,
      updatedAt: createdAt,
    })
  }
  if (!ride) return { ok: false as const, error: 'not_found', ride: null }
  if ((ride.status === 'searching' || ride.status === 'offered') && snapshot?.driverId) {
    ride.assignedDriverId = snapshot.driverId
    ride.status = 'assigned'
  }
  if (ride.passengerId !== passengerId) return { ok: false as const, error: 'forbidden', ride }
  if (ride.status !== 'assigned') return { ok: false as const, error: ride.status, ride }
  if (step === 'boarded') {
    if (!ride.boardedAt) ride.boardedAt = nowIso()
  } else if (!ride.boardedAt) {
    return { ok: false as const, error: 'not_boarded', ride }
  } else if (!ride.readyToSettleAt) {
    ride.readyToSettleAt = nowIso()
  }
  const saved = stamp(ride)
  if (saved.assignedDriverId) publishDriverLive(saved.assignedDriverId)
  return { ok: true as const, ride: saved }
}

export function abandonAssignedRide(rideId: string, driverId: string) {
  syncDispatchFromDisk()
  const ride = getRide(rideId)
  if (!ride) return { ok: false as const, error: 'not_found', ride: null }
  if (ride.assignedDriverId !== driverId || ride.status !== 'assigned') {
    return { ok: false as const, error: ride.status === 'assigned' ? 'forbidden' : ride.status || 'not_assigned', ride }
  }
  const cancelled = cancelRide(rideId)
  return cancelled ? { ok: true as const, ride: cancelled } : { ok: false as const, error: 'not_found', ride: null }
}

export function restorePendingOffer(
  rideId: string,
  driverId: string,
  snapshot?: {
    passengerId?: string
    pickup?: RideRequestRecord['pickup']
    dest?: RideRequestRecord['dest']
    estimatedFare?: number
    kind?: RideRequestRecord['kind']
  },
) {
  syncDispatchFromDisk()
  let ride = getRide(rideId)
  if (ride?.currentOffer?.driverId === driverId && ride.currentOffer.decision === 'pending') return ride
  if (ride && (ride.status === 'assigned' || ride.status === 'cancelled' || ride.status === 'completed')) return ride
  if (!ride && snapshot?.passengerId && snapshot.pickup && snapshot.dest) {
    const createdAt = nowIso()
    ride = saveRide({
      id: rideId,
      kind: snapshot.kind === 'daeri' ? 'daeri' : 'taxi',
      passengerId: snapshot.passengerId,
      pickup: snapshot.pickup,
      dest: snapshot.dest,
      estimatedFare: Number.isFinite(snapshot.estimatedFare) ? Number(snapshot.estimatedFare) : 0,
      status: 'searching',
      assignedDriverId: null,
      currentOffer: null,
      declinedDriverIds: [],
      timedOutDriverIds: [],
      createdAt,
      updatedAt: createdAt,
    })
  }
  if (!ride || ride.status === 'assigned' || ride.status === 'cancelled' || ride.status === 'completed') return ride
  console.log('[dispatch] restore offer', { rideId, driverId })
  ride.status = 'offered'
  ride.currentOffer = {
    rideId,
    driverId,
    rank: ride.currentOffer?.rank ?? 1,
    pickupDistanceKm: ride.currentOffer?.pickupDistanceKm ?? 0,
    offeredAt: nowIso(),
    expiresAt: new Date(Date.now() + OFFER_TIMEOUT_MS).toISOString(),
    decision: 'pending',
  }
  const driver = getDriver(driverId)
  if (driver?.status === 'offline') saveDriver({ ...driver, status: 'online', lastSeenAt: nowIso() })
  return stamp(ride)
}

export function respondToOffer(rideId: string, driverId: string, action: 'accept' | 'reject') {
  syncDispatchFromDisk()
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
  clearVirtualAccept(ride.id)
  if (action === 'reject') {
    ride.declinedDriverIds = [...new Set([...ride.declinedDriverIds, driverId])]
    ride.currentOffer = { ...ride.currentOffer, decision: 'rejected' }
    ride.status = 'searching'
    stamp(ride)
    publishDriverLive(driverId)
    return { ok: true as const, ride: assignNextDriver(ride.id) ?? ride }
  }

  const driver = getDriver(driverId)
  if (!driver || driver.status === 'offline') {
    ride.timedOutDriverIds = [...new Set([...ride.timedOutDriverIds, driverId])]
    ride.currentOffer = { ...ride.currentOffer, decision: 'timeout' }
    ride.status = 'searching'
    stamp(ride)
    publishDriverLive(driverId)
    return { ok: false as const, error: 'driver_unavailable', ride: assignNextDriver(ride.id) ?? ride }
  }

  ride.currentOffer = { ...ride.currentOffer, decision: 'accepted' }
  ride.assignedDriverId = driverId
  ride.status = 'assigned'
  stamp(ride)
  publishDriverLive(driverId)
  saveDriver({ ...driver, status: 'busy', lastSeenAt: nowIso() })
  openEscrowForRide(ride.id)
  if (isPiSandboxEnv()) lockEscrow({ rideId: ride.id, passengerId: ride.passengerId, sandbox: true })
  void openRideComms(ride.id)
  startLiveDriverTracking(ride.id)
  return { ok: true as const, ride }
}

export function confirmMatchOnDevice(
  rideId: string,
  snapshot?: {
    passengerId?: string
    pickup?: RideRequestRecord['pickup']
    dest?: RideRequestRecord['dest']
    estimatedFare?: number
    kind?: RideRequestRecord['kind']
  },
) {
  ensureSeedDrivers()
  let ride = getRide(rideId)
  if (!ride && snapshot?.passengerId && snapshot.pickup && snapshot.dest) {
    const createdAt = nowIso()
    ride = saveRide({
      id: rideId,
      kind: snapshot.kind === 'daeri' ? 'daeri' : 'taxi',
      passengerId: snapshot.passengerId,
      pickup: snapshot.pickup,
      dest: snapshot.dest,
      estimatedFare: Number.isFinite(snapshot.estimatedFare) ? Number(snapshot.estimatedFare) : 0,
      status: 'searching',
      assignedDriverId: null,
      currentOffer: null,
      declinedDriverIds: [],
      timedOutDriverIds: [],
      createdAt,
      updatedAt: createdAt,
    })
  }
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
  clearVirtualAccept(ride.id)
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
  void openRideComms(ride.id)
  lockEscrow({ rideId: ride.id, passengerId: ride.passengerId, sandbox: true })
  startLiveDriverTracking(ride.id)
  return { ok: true as const, ride: getRide(ride.id) ?? ride }
}

export function getPublicRide(rideId: string) {
  syncDispatchFromDisk()
  syncEscrowFromDisk()
  resumeAssignedTracking()
  const ride = getRide(rideId)
  if (!ride) return null
  return toPublicRide(refreshRideTimers(ride) ?? ride)
}

export function resumeAssignedTracking() {
  for (const ride of listRides()) {
    if (ride.status === 'assigned') startLiveDriverTracking(ride.id)
    else if (ride.status === 'offered' && ride.currentOffer?.decision === 'pending') {
      scheduleOfferWatch(ride, false)
    }
  }
}

export function ensureRideForCompletion(
  rideId: string,
  driverId: string,
  snapshot?: {
    passengerId?: string
    pickup?: RideRequestRecord['pickup']
    dest?: RideRequestRecord['dest']
    estimatedFare?: number
    kind?: RideRequestRecord['kind']
    boardedAt?: string | null
    readyToSettleAt?: string | null
  },
) {
  syncDispatchFromDisk()
  const existing = getRide(rideId)
  if (existing) return existing
  if (!snapshot?.passengerId || !snapshot.pickup || !snapshot.dest || !snapshot.readyToSettleAt) return null
  const createdAt = nowIso()
  const ride = saveRide({
    id: rideId,
    kind: snapshot.kind === 'daeri' ? 'daeri' : 'taxi',
    passengerId: snapshot.passengerId,
    pickup: snapshot.pickup,
    dest: snapshot.dest,
    estimatedFare: Number.isFinite(snapshot.estimatedFare) ? Number(snapshot.estimatedFare) : 0,
    status: 'assigned',
    assignedDriverId: driverId,
    currentOffer: null,
    declinedDriverIds: [],
    timedOutDriverIds: [],
    boardedAt: snapshot.boardedAt || createdAt,
    readyToSettleAt: snapshot.readyToSettleAt,
    createdAt,
    updatedAt: createdAt,
  })
  openEscrowForRide(ride.id)
  lockEscrow({ rideId: ride.id, passengerId: ride.passengerId, sandbox: true })
  return getRide(ride.id) ?? ride
}

export function completeAssignedRide(rideId: string, driverId: string) {
  const ride = getRide(rideId)
  if (!ride) return null
  if (ride.assignedDriverId !== driverId) return ride
  ride.status = 'completed'
  stamp(ride)
  publishDriverLive(driverId)
  stopLiveDriverMove(rideId)
  const driver = getDriver(driverId)
  if (driver) saveDriver({ ...driver, status: 'online', lastSeenAt: nowIso() })
  void archiveRideComms(rideId, 'completed')
  return ride
}

const offerLookupLog = { key: '' }

export function getDriverActiveRide(driverId: string) {
  syncDispatchFromDisk()
  syncEscrowFromDisk()
  const ride = listRides().find((item) => item.assignedDriverId === driverId && item.status === 'assigned')
  return ride ? toPublicRide(ride) : null
}

export function getDriverOffer(driverId: string) {
  syncDispatchFromDisk()
  let matched: { ride: ReturnType<typeof toPublicRide>; offer: RideOfferRecord } | null = null
  for (const ride of listSearchingRides()) {
    const live = refreshRideTimers(ride) ?? getRide(ride.id)
    if (!live) continue
    if (live.currentOffer?.driverId === driverId && live.currentOffer.decision === 'pending') {
      matched = { ride: toPublicRide(live), offer: live.currentOffer }
      break
    }
  }
  const key = `${driverId}:${matched?.ride.id ?? 'none'}`
  if (offerLookupLog.key !== key) {
    offerLookupLog.key = key
    console.log('[dispatch] offer lookup', {
      driverId,
      rideId: matched?.ride.id ?? null,
      pendingRides: listSearchingRides().length,
    })
  }
  return matched
}

export function rememberDriverVehicle(driverId: string, info: { name?: string; vehicle?: string; plate?: string }) {
  const current = getDriver(driverId)
  if (!current) return null
  const name = info.name?.trim()
  const vehicle = info.vehicle?.trim()
  const plate = info.plate?.trim()
  if (!name && !vehicle && !plate) return current
  return saveDriver({
    ...current,
    name: name || current.name,
    vehicle: vehicle || current.vehicle,
    plate: plate || current.plate,
    lastSeenAt: nowIso(),
  })
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
    heading:
      current && (current.lat !== input.lat || current.lng !== input.lng)
        ? headingDegrees(current, input)
        : current?.heading ?? 0,
    status: input.status === 'offline' ? 'offline' : current?.status === 'busy' ? 'busy' : 'online',
    lastSeenAt: nowIso(),
    virtual: false,
    wallet: input.wallet?.trim() || current?.wallet,
    piUid: input.piUid?.trim() || current?.piUid,
  }
  return saveDriver(next)
}

export { subscribeRideLive }
