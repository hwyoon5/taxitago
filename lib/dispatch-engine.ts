import { etaMinutesFromKm, haversineKm, headingDegrees, stepToward } from '@/lib/dispatch-geo'
import { getEscrowByRide, syncEscrowFromDisk } from '@/lib/escrow-store'
import { openEscrowForRide, refundEscrow, toPublicEscrow } from '@/lib/escrow-engine'
import { archiveRideComms, openRideComms } from '@/lib/comms-engine'
import {
  driverPenaltyInfo,
  ensureSeedDrivers,
  getDriver,
  getRide,
  listDrivers,
  listRides,
  listSearchingRides,
  noteOfferOutcome,
  nowIso,
  publishDriverLive,
  saveDriver,
  saveRide,
  subscribeRideLive,
  syncDispatchFromDisk,
} from '@/lib/dispatch-store'
import { sendDriverPush } from '@/lib/driver-push'
import { recordZoneOutcome } from '@/lib/avoid-zone-store'
import { resolveNetworkMode } from '@/lib/pi-sandbox'
import { driverServesTier, normalizeRideTier, normalizeVehicleTiers } from '@/lib/ride-tiers'
import { effectiveServiceRoles, normalizeDeliveryVehicles, normalizeServiceRoles } from '@/lib/partner-services'
import { presenceLocation } from '@/lib/presence-store'
import {
  AUTO_BOARD_DEBOUNCE_MS,
  AUTO_BOARD_MAX_DT_MS,
  AUTO_BOARD_MIN_DT_MS,
  AUTO_BOARD_MIN_SPEED_KMH,
  AUTO_BOARD_PAX_MAX_AGE_MS,
  AUTO_BOARD_PROXIMITY_KM,
  DRIVER_STALE_MS,
  MATCH_RADIUS_KM,
  OFFER_TIMEOUT_MS,
  PREMATCH_RADIUS_KM,
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
    passengerPhone: ride.passengerPhone,
    pickup: ride.pickup,
    waypoints: ride.waypoints ?? [],
    dest: ride.dest,
    estimatedFare: ride.estimatedFare,
    avoidSurchargePi: ride.avoidSurchargePi ?? 0,
    tollPi: ride.tollPi ?? 0,
    tollKrw: ride.tollKrw ?? null,
    expectedMinutes: ride.expectedMinutes ?? null,
    waitMinutes: ride.waitMinutes ?? null,
    waitUntil: ride.waitUntil ?? null,
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
    tier: ride.tier,
    assignedDriver: assigned
      ? {
          id: assigned.id,
          name: assigned.name,
          vehicle: assigned.vehicle,
          plate: assigned.plate,
          rating: assigned.rating,
          etaMinutes: etaMinutesFromKm(pickupKm),
          pickupDistanceKm: Math.round(pickupKm * 10) / 10,
          // 실시간 좌표는 활성 매칭('assigned') 동안만 노출 — 운행 종료·취소
          // 후에도 기사 위치가 승객·스트림에 계속 흐르지 않도록 마스킹한다.
          lat: ride.status === 'assigned' ? assigned.lat : null,
          lng: ride.status === 'assigned' ? assigned.lng : null,
          heading: ride.status === 'assigned' ? (assigned.heading ?? 0) : null,
          updatedAt: assigned.lastSeenAt,
          phone: assigned.phone,
        }
      : null,
    escrow: toPublicEscrow(getEscrowByRide(ride.id)),
    boardedAt: ride.boardedAt ?? null,
    actualKm: ride.actualKm ?? null,
    readyToSettleAt: ride.readyToSettleAt ?? null,
    boardedVia: ride.boardedVia ?? null,
    boardConfirmedAt: ride.boardConfirmedAt ?? null,
    boardDisputes: ride.boardDisputes ?? 0,
    createdAt: ride.createdAt,
    updatedAt: ride.updatedAt,
  }
}

/** 운행 중인 기사도 현재 목적지 도착이 임박하면 다음 콜을 사전 배차(pre-match) 후보로 둔다. */
function prematchEligible(driver: DriverRecord, activeRide: RideRequestRecord) {
  if (driver.virtual) return false
  const km = haversineKm({ lat: driver.lat, lng: driver.lng }, activeRide.dest)
  return Number.isFinite(km) && km <= PREMATCH_RADIUS_KM
}

/** 콜 종류별 기사 자격 — 겸직(serviceRoles)을 포함한 실효 역할로 판정한다.
 *  대리 콜은 대리 역할, 택시 콜은 택시 역할이 있는 기사에게만 간다.
 *  시설형 파트너는 승객 콜 제외. 미등록(레거시) 기사는 택시로 간주. */
function driverMatchesRideKind(driver: DriverRecord, kind: RideRequestRecord['kind']) {
  const roles = effectiveServiceRoles(driver)
  if (kind === 'daeri') return roles.includes('대리운전')
  return !driver.serviceType || roles.includes('택시')
}

function isDriverEligible(driver: DriverRecord, ride: RideRequestRecord, now: number) {
  if (!driverMatchesRideKind(driver, ride.kind)) return false
  // 차량 등급 필터 — 승객이 고른 티어를 기사가 제공해야 매칭 후보가 된다.
  // '일반'/미지정 콜은 모두에게 열리고, 모범·대형·펫동반은 등록 등급 필요.
  if (!driverServesTier(driver.vehicleTiers, ride.tier)) return false
  if (driver.status === 'offline') return false
  // 본인 호출 원천 차단 — 등록 기사/파트너가 승객으로 부른 콜이 자기
  // 단말기(기사 id 또는 piUid가 같은 레코드)로 배정되지 않게 한다.
  // 테스트넷에서는 같은 테스트 계정으로 승객↔기사 end-to-end 검증을
  // 허용하기 위해 이 제외를 적용하지 않는다(메인넷은 그대로 차단).
  if (
    ride.passengerUid &&
    resolveNetworkMode() !== 'testnet' &&
    (driver.id === ride.passengerUid || driver.piUid === ride.passengerUid)
  ) {
    return false
  }
  const assignedRide = listRides().find((item) => item.assignedDriverId === driver.id && item.status === 'assigned')
  if (assignedRide && !prematchEligible(driver, assignedRide)) return false
  if (listRides().some((item) => item.id !== ride.id && item.currentOffer?.driverId === driver.id && item.currentOffer.decision === 'pending')) return false
  if (ride.declinedDriverIds.includes(driver.id)) return false
  if (ride.timedOutDriverIds.includes(driver.id)) return false
  const staleMs = now - Date.parse(driver.lastSeenAt)
  if (!driver.virtual && Number.isFinite(staleMs) && staleMs > DRIVER_STALE_MS) return false
  if (driver.virtual) return haversineKm({ lat: driver.lat, lng: driver.lng }, ride.pickup) <= MATCH_RADIUS_KM
  return Number.isFinite(haversineKm({ lat: driver.lat, lng: driver.lng }, ride.pickup))
}

/** 배차 우선순위 등급 — 정상 실기사(0) > 거절 패널티 실기사(1) > 가상 기사(2). */
function priorityTier(driver: DriverRecord) {
  if (driver.virtual) return 2
  return driverPenaltyInfo(driver.id).level === 'penalty' ? 1 : 0
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
      const tierA = priorityTier(a.driver)
      const tierB = priorityTier(b.driver)
      if (tierA !== tierB) return tierA - tierB
      if (a.km !== b.km) return a.km - b.km
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
  recordZoneOutcome(ride.dest, 'offer')
  publishDriverLive(driver.id)
  const via = (ride.waypoints ?? []).map((point) => point.label || point.address || '경유지')
  const pickup = ride.pickup.address || ride.pickup.label || '출발지'
  const dest = ride.dest.label || ride.dest.address || '목적지'
  console.log('[dispatch] offered ride', { rideId: ride.id, driverId: driver.id })
  void sendDriverPush(driver.id, {
    title: '새로운 운행 요청',
    body: [pickup, ...via, dest].join(' → '),
    tag: `taxitago-offer-${ride.id}`,
    url: '/?driver=1',
    rideId: ride.id,
    expiresAt: offer.expiresAt,
    pickupDistanceKm: offer.pickupDistanceKm,
    ride: {
      id: ride.id,
      passengerId: ride.passengerId,
      kind: ride.kind === 'daeri' ? 'daeri' : 'taxi',
      tier: ride.tier,
      pickup: ride.pickup,
      waypoints: ride.waypoints,
      dest: ride.dest,
      estimatedFare: ride.estimatedFare,
      avoidSurchargePi: ride.avoidSurchargePi ?? 0,
      tollPi: ride.tollPi ?? 0,
      tollKrw: ride.tollKrw ?? null,
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
    // 대기 시간이 남은 콜은 unmatched로 떨어뜨리지 않고 searching을 유지한다 —
    // 기사 오퍼·조회 폴링이 refreshRideTimers를 거치며 후보를 계속 다시 스캔한다.
    if (ride.waitUntil && Date.parse(ride.waitUntil) > Date.now()) {
      ride.currentOffer = null
      return stamp(ride)
    }
    ride.status = 'unmatched'
    ride.currentOffer = null
    ride.assignedDriverId = null
    recordZoneOutcome(ride.dest, 'unmatched')
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
  if (!getDriver(previousDriverId)?.virtual) noteOfferOutcome(previousDriverId, 'timeout')
  publishDriverLive(previousDriverId)
  recordZoneOutcome(ride.dest, 'timeout')
  return assignNextDriver(ride.id)
}

export function refreshRideTimers(ride: RideRequestRecord) {
  if (ride.status === 'offered' && ride.currentOffer?.decision === 'pending') {
    if (Date.now() >= Date.parse(ride.currentOffer.expiresAt)) {
      return expireCurrentOffer(ride.id) ?? ride
    }
    return ride
  }
  // 대기 중인 콜 — 마감 시각이 지났으면 unmatched로 만료 처리하고, 아니면
  // 새로 온라인이 된 후보가 있는지 다시 스캔해 오퍼를 이어간다.
  if (ride.status === 'searching' && ride.waitUntil) {
    if (Date.now() >= Date.parse(ride.waitUntil)) {
      ride.status = 'unmatched'
      ride.currentOffer = null
      ride.assignedDriverId = null
      recordZoneOutcome(ride.dest, 'unmatched')
      return stamp(ride)
    }
    if (!ride.currentOffer || ride.currentOffer.decision !== 'pending') {
      return assignNextDriver(ride.id) ?? ride
    }
  }
  return ride
}

export function createRideAndMatch(input: {
  id: string
  kind?: RideRequestRecord['kind']
  tier?: string
  passengerId: string
  passengerUid?: string
  passengerPhone?: string
  pickup: RideRequestRecord['pickup']
  waypoints?: RideRequestRecord['waypoints']
  dest: RideRequestRecord['dest']
  estimatedFare: number
  avoidSurchargePi?: number
  tollPi?: number
  tollKrw?: number | null
  expectedMinutes?: number | null
  waitMinutes?: number | null
}) {
  const createdAt = nowIso()
  const waitMinutes = Number(input.waitMinutes)
  const ride = saveRide({
    ...input,
    kind: input.kind === 'daeri' ? 'daeri' : 'taxi',
    tier: normalizeRideTier(input.tier),
    avoidSurchargePi: input.avoidSurchargePi ?? 0,
    tollPi: input.tollPi ?? 0,
    tollKrw: input.tollKrw ?? null,
    waypoints: input.waypoints ?? [],
    waitMinutes: Number.isFinite(waitMinutes) && waitMinutes > 0 ? waitMinutes : null,
    waitUntil:
      Number.isFinite(waitMinutes) && waitMinutes > 0
        ? new Date(Date.now() + waitMinutes * 60_000).toISOString()
        : null,
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
    if (driver && (driver.status === 'busy' || driver.virtual)) {
      const stillBusy = listRides().some((item) => item.id !== ride.id && item.assignedDriverId === driver.id && item.status === 'assigned')
      saveDriver({ ...driver, status: stillBusy ? 'busy' : 'online', lastSeenAt: nowIso() })
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
    waypoints?: RideRequestRecord['waypoints']
    dest?: RideRequestRecord['dest']
    estimatedFare?: number
    tollPi?: number
    tollKrw?: number | null
    expectedMinutes?: number | null
    kind?: RideRequestRecord['kind']
    tier?: string
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
      tier: normalizeRideTier(snapshot.tier),
      passengerId,
      pickup: snapshot.pickup,
      waypoints: snapshot.waypoints?.slice(0, 2),
      dest: snapshot.dest,
      estimatedFare: Number.isFinite(snapshot.estimatedFare) ? Number(snapshot.estimatedFare) : 0,
      tollPi: Number.isFinite(snapshot.tollPi) ? Number(snapshot.tollPi) : 0,
      tollKrw: Number.isFinite(snapshot.tollKrw) ? Number(snapshot.tollKrw) : null,
      expectedMinutes: Number.isFinite(snapshot.expectedMinutes) ? Number(snapshot.expectedMinutes) : null,
      status: 'assigned',
      assignedDriverId: snapshot.driverId || null,
      currentOffer: null,
      declinedDriverIds: [],
      timedOutDriverIds: [],
      boardedAt: snapshot.boardedAt ?? null,
      createdAt,
      updatedAt: createdAt,
    })
  }
  if (!ride) return { ok: false as const, error: 'not_found', ride: null }
  // A ride restored before the snapshot carried waypoints gets them back here.
  if (!ride.waypoints?.length && snapshot?.waypoints?.length) ride.waypoints = snapshot.waypoints.slice(0, 2)
  // A snapshot may only confirm an assignment for the driver actually holding
  // the offer — never let client data pick an arbitrary driver.
  if (
    (ride.status === 'searching' || ride.status === 'offered') &&
    snapshot?.driverId &&
    ride.currentOffer?.driverId === snapshot.driverId
  ) {
    ride.assignedDriverId = snapshot.driverId
    ride.status = 'assigned'
  }
  if (ride.passengerId !== passengerId) return { ok: false as const, error: 'forbidden', ride }
  if (ride.status !== 'assigned') return { ok: false as const, error: ride.status, ride }
  if (step === 'boarded') {
    if (!ride.boardedAt) ride.boardedAt = nowIso()
    // 승객이 직접 탑승을 확인한 증거 — 자동/기사 판정과 별개로 확정 시각을 남긴다.
    ride.boardConfirmedAt = nowIso()
    ride.boardedVia ??= 'passenger'
    ride.autoBoardSince = null
  } else if (!ride.boardedAt) {
    return { ok: false as const, error: 'not_boarded', ride }
  } else if (!ride.readyToSettleAt) {
    ride.readyToSettleAt = nowIso()
  }
  const saved = stamp(ride)
  if (saved.assignedDriverId) publishDriverLive(saved.assignedDriverId)
  return { ok: true as const, ride: saved }
}

/**
 * 기사 주도 진행 — 택시·대리운전 공통. 현장 운영에서는 탑승(운행 시작)과
 * 목적지 도착 확인을 배정된 기사가 진행하고, 이용자 화면은 폴링/SSE로
 * boardedAt → readyToSettleAt 상태 시계를 그대로 따라간다.
 */
export function markRideProgressByDriver(rideId: string, driverId: string, step: 'boarded' | 'arrived') {
  syncDispatchFromDisk()
  const ride = getRide(rideId)
  if (!ride) return { ok: false as const, error: 'not_found', ride: null }
  if (ride.assignedDriverId !== driverId || ride.status !== 'assigned') {
    return { ok: false as const, error: ride.status === 'assigned' ? 'forbidden' : ride.status || 'not_assigned', ride }
  }
  if (step === 'boarded') {
    if (!ride.boardedAt) ride.boardedAt = nowIso()
    // 수동 확인은 GPS 자동 감지 이전의 폴백 경로 — 승객 앱의 탑승 여부
    // 확인 팝업이 착오·임의 조작을 사후에 걸러낸다.
    ride.boardedVia ??= 'driver'
    ride.autoBoardSince = null
  } else if (!ride.boardedAt) {
    return { ok: false as const, error: 'not_boarded', ride }
  } else if (!ride.readyToSettleAt) {
    ride.readyToSettleAt = nowIso()
  }
  const saved = stamp(ride)
  publishDriverLive(driverId)
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
    waypoints?: RideRequestRecord['waypoints']
    dest?: RideRequestRecord['dest']
    estimatedFare?: number
    tollPi?: number
    tollKrw?: number | null
    expectedMinutes?: number | null
    kind?: RideRequestRecord['kind']
    tier?: string
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
      waypoints: snapshot.waypoints?.slice(0, 2),
      dest: snapshot.dest,
      estimatedFare: Number.isFinite(snapshot.estimatedFare) ? Number(snapshot.estimatedFare) : 0,
      tollPi: Number.isFinite(snapshot.tollPi) ? Number(snapshot.tollPi) : 0,
      tollKrw: Number.isFinite(snapshot.tollKrw) ? Number(snapshot.tollKrw) : null,
      expectedMinutes: Number.isFinite(snapshot.expectedMinutes) ? Number(snapshot.expectedMinutes) : null,
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
    if (!getDriver(driverId)?.virtual) noteOfferOutcome(driverId, 'reject')
    publishDriverLive(driverId)
    recordZoneOutcome(ride.dest, 'reject')
    return { ok: true as const, ride: assignNextDriver(ride.id) ?? ride }
  }

  const driver = getDriver(driverId)
  if (!driver || driver.status === 'offline') {
    ride.timedOutDriverIds = [...new Set([...ride.timedOutDriverIds, driverId])]
    ride.currentOffer = { ...ride.currentOffer, decision: 'timeout' }
    ride.status = 'searching'
    stamp(ride)
    if (!driver?.virtual) noteOfferOutcome(driverId, 'timeout')
    publishDriverLive(driverId)
    recordZoneOutcome(ride.dest, 'timeout')
    return { ok: false as const, error: 'driver_unavailable', ride: assignNextDriver(ride.id) ?? ride }
  }

  const busyRide = listRides().find(
    (item) => item.id !== ride.id && item.assignedDriverId === driverId && item.status === 'assigned',
  )
  // 목적지 도착 임박(PREMATCH_RADIUS_KM 이내)이면 사전 배차로 수락을 허용한다.
  const driverBusyOnRide = Boolean(busyRide && !prematchEligible(driver, busyRide))
  if (driverBusyOnRide) {
    ride.timedOutDriverIds = [...new Set([...ride.timedOutDriverIds, driverId])]
    ride.currentOffer = { ...ride.currentOffer, decision: 'timeout' }
    ride.status = 'searching'
    stamp(ride)
    if (!driver.virtual) noteOfferOutcome(driverId, 'timeout')
    publishDriverLive(driverId)
    recordZoneOutcome(ride.dest, 'timeout')
    return { ok: false as const, error: 'driver_busy', ride: assignNextDriver(ride.id) ?? ride }
  }

  ride.currentOffer = { ...ride.currentOffer, decision: 'accepted' }
  ride.assignedDriverId = driverId
  ride.status = 'assigned'
  stamp(ride)
  if (!driver.virtual) noteOfferOutcome(driverId, 'accept')
  publishDriverLive(driverId)
  recordZoneOutcome(ride.dest, 'accept')
  saveDriver({ ...driver, status: 'busy', lastSeenAt: nowIso() })
  // 에스크로는 'pending'으로만 연다 — 잠금은 승객의 Pi SDK 결제가 서버
  // 검증(/api/pi/complete)을 통과했을 때만 일어난다. 결제 없이 잠기면
  // 이용 종료 시점의 결제 창이 건너뛰어진다.
  openEscrowForRide(ride.id)
  void openRideComms(ride.id)
  startLiveDriverTracking(ride.id)
  return { ok: true as const, ride }
}

export function confirmMatchOnDevice(
  rideId: string,
  snapshot?: {
    passengerId?: string
    pickup?: RideRequestRecord['pickup']
    waypoints?: RideRequestRecord['waypoints']
    dest?: RideRequestRecord['dest']
    estimatedFare?: number
    tollPi?: number
    tollKrw?: number | null
    expectedMinutes?: number | null
    kind?: RideRequestRecord['kind']
    tier?: string
  },
  deviceDriverId?: string,
) {
  ensureSeedDrivers()
  let ride = getRide(rideId)
  if (!ride && snapshot?.passengerId && snapshot.pickup && snapshot.dest) {
    const createdAt = nowIso()
    ride = saveRide({
      id: rideId,
      kind: snapshot.kind === 'daeri' ? 'daeri' : 'taxi',
      tier: normalizeRideTier(snapshot.tier),
      passengerId: snapshot.passengerId,
      pickup: snapshot.pickup,
      waypoints: snapshot.waypoints?.slice(0, 2),
      dest: snapshot.dest,
      estimatedFare: Number.isFinite(snapshot.estimatedFare) ? Number(snapshot.estimatedFare) : 0,
      tollPi: Number.isFinite(snapshot.tollPi) ? Number(snapshot.tollPi) : 0,
      tollKrw: Number.isFinite(snapshot.tollKrw) ? Number(snapshot.tollKrw) : null,
      expectedMinutes: Number.isFinite(snapshot.expectedMinutes) ? Number(snapshot.expectedMinutes) : null,
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
  if (!ride.waypoints?.length && snapshot?.waypoints?.length) ride.waypoints = snapshot.waypoints.slice(0, 2)
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
  // The device-accept path simulates the driver logged in on this device.
  // The pending offer's driver wins first so both clients converge on the same
  // driverId — reassigning to the local device driver while another driver's
  // offer is live splits the two screens onto different identities.
  // Never assign a virtual seed or an arbitrary driver while a real driver is
  // eligible — keep the assigned identity synced with the logged-in driver.
  const now = Date.now()
  const ranked = rankedCandidates(ride)
  const offered = ride.currentOffer?.driverId ? getDriver(ride.currentOffer.driverId) : null
  const local = deviceDriverId ? getDriver(deviceDriverId) : null
  const driver =
    (offered && !offered.virtual && isDriverEligible(offered, ride, now) ? offered : null) ??
    (local && !local.virtual && isDriverEligible(local, ride, now) ? local : null) ??
    ranked.find((candidate) => !candidate.driver.virtual)?.driver ??
    offered ??
    ranked[0]?.driver ??
    listDrivers().find((candidate) => candidate.virtual && candidate.status !== 'offline') ??
    null
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
  publishDriverLive(driver.id)
  saveDriver({ ...driver, status: 'busy', lastSeenAt: nowIso() })
  // 결제 없는 자동 잠금 금지 — 실제 잠금은 검증된 Pi 결제 완료 시 발생한다.
  openEscrowForRide(ride.id)
  void openRideComms(ride.id)
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
    waypoints?: RideRequestRecord['waypoints']
    dest?: RideRequestRecord['dest']
    estimatedFare?: number
    tollPi?: number
    tollKrw?: number | null
    expectedMinutes?: number | null
    kind?: RideRequestRecord['kind']
    tier?: string
    boardedAt?: string | null
    readyToSettleAt?: string | null
  },
) {
  syncDispatchFromDisk()
  const existing = getRide(rideId)
  if (existing) {
    if (!existing.waypoints?.length && snapshot?.waypoints?.length) existing.waypoints = snapshot.waypoints.slice(0, 2)
    return existing
  }
  // Reconstruction requires the full lifecycle attestation — never fabricate a
  // boarding/arrival the server never observed.
  if (!snapshot?.passengerId || !snapshot.pickup || !snapshot.dest || !snapshot.boardedAt || !snapshot.readyToSettleAt) return null
  const createdAt = nowIso()
  const ride = saveRide({
    id: rideId,
    kind: snapshot.kind === 'daeri' ? 'daeri' : 'taxi',
    tier: normalizeRideTier(snapshot.tier),
    passengerId: snapshot.passengerId,
    pickup: snapshot.pickup,
    waypoints: snapshot.waypoints?.slice(0, 2),
    dest: snapshot.dest,
    estimatedFare: Number.isFinite(snapshot.estimatedFare) ? Number(snapshot.estimatedFare) : 0,
    tollPi: Number.isFinite(snapshot.tollPi) ? Number(snapshot.tollPi) : 0,
    tollKrw: Number.isFinite(snapshot.tollKrw) ? Number(snapshot.tollKrw) : null,
    expectedMinutes: Number.isFinite(snapshot.expectedMinutes) ? Number(snapshot.expectedMinutes) : null,
    status: 'assigned',
    assignedDriverId: driverId,
    currentOffer: null,
    declinedDriverIds: [],
    timedOutDriverIds: [],
    boardedAt: snapshot.boardedAt,
    readyToSettleAt: snapshot.readyToSettleAt,
    createdAt,
    updatedAt: createdAt,
  })
  openEscrowForRide(ride.id)
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
  if (driver) {
    const stillBusy = listRides().some((item) => item.assignedDriverId === driverId && item.status === 'assigned')
    saveDriver({ ...driver, status: stillBusy ? 'busy' : 'online', lastSeenAt: nowIso() })
  }
  void archiveRideComms(rideId, 'completed')
  return ride
}

const offerLookupLog = { key: '' }

export function getDriverActiveRide(driverId: string) {
  syncDispatchFromDisk()
  syncEscrowFromDisk()
  // 사전 배차로 assigned 콜이 2건이 될 수 있다 — 진행 중(탑승 확인됨)이거나
  // 먼저 생성된 콜이 현재 운행이고, 완료되면 다음 콜이 자동으로 올라온다.
  const ride = listRides()
    .filter((item) => item.assignedDriverId === driverId && item.status === 'assigned')
    .sort((a, b) => Number(Boolean(b.boardedAt)) - Number(Boolean(a.boardedAt)) || a.createdAt.localeCompare(b.createdAt))[0]
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

export function rememberDriverVehicle(
  driverId: string,
  info: { name?: string; vehicle?: string; plate?: string; vehicleTiers?: string[]; serviceRoles?: string[]; deliveryVehicles?: string[] },
) {
  const current = getDriver(driverId)
  if (!current) return null
  const name = info.name?.trim()
  const vehicle = info.vehicle?.trim()
  const plate = info.plate?.trim()
  const vehicleTiers = info.vehicleTiers !== undefined ? normalizeVehicleTiers(info.vehicleTiers) : undefined
  const serviceRoles = info.serviceRoles !== undefined ? normalizeServiceRoles(info.serviceRoles, current.serviceType) : undefined
  const deliveryVehicles = info.deliveryVehicles !== undefined ? normalizeDeliveryVehicles(info.deliveryVehicles) : undefined
  if (!name && !vehicle && !plate && vehicleTiers === undefined && serviceRoles === undefined && deliveryVehicles === undefined) return current
  return saveDriver({
    ...current,
    name: name || current.name,
    vehicle: vehicle || current.vehicle,
    plate: plate || current.plate,
    ...(vehicleTiers !== undefined ? { vehicleTiers } : {}),
    ...(serviceRoles !== undefined ? { serviceRoles } : {}),
    ...(deliveryVehicles !== undefined ? { deliveryVehicles } : {}),
    lastSeenAt: nowIso(),
  })
}

/**
 * 자동 탑승 감지 — 기사 presence 비트마다 호출된다.
 * 배정된 콜에서 ①차량이 실제 주행 속도로 이동하고 ②승객의 최신 위치가 차량
 * 근접권(AUTO_BOARD_PROXIMITY_KM) 안이면, 조건이 AUTO_BOARD_DEBOUNCE_MS 이상
 * 지속됐을 때 boardedAt을 서버가 스탬프한다 — 기사 수동 버튼 없이 요금 시계가
 * 열리고 승객 앱은 SSE/폴링으로 즉시 '운행 중' 상태를 받는다.
 * 기사가 버튼으로 먼저 처리한 건(착오 포함)은 boardedVia='driver'로 남고
 * 승객 앱의 '탑승 여부 확인' 팝업이 사후 안전장치가 된다.
 */
export async function evaluateAutoBoard(
  rideId: string,
  driverId: string,
  prev: { lat: number; lng: number; lastSeenAt: string },
  next: { lat: number; lng: number },
) {
  const ride = getRide(rideId)
  if (!ride || ride.status !== 'assigned' || ride.boardedAt) return
  const now = Date.now()
  // 샘플 간격이 너무 짧으면 GPS 잡음이, 너무 길면 평균 왜곡이 속도를 오염시킨다.
  const dtMs = now - Date.parse(prev.lastSeenAt)
  let speedKmh = 0
  let moving = false
  if (Number.isFinite(dtMs) && dtMs >= AUTO_BOARD_MIN_DT_MS && dtMs <= AUTO_BOARD_MAX_DT_MS) {
    speedKmh = (haversineKm(prev, next) / dtMs) * 3_600_000
    moving = speedKmh >= AUTO_BOARD_MIN_SPEED_KMH
  }
  // 승객 좌표는 presence 비트(passengerUid 우선, 기기 id 폴백)에서만 읽는다 —
  // 기사 단말이 보낸 좌표는 승객 위치의 증거로 쓸 수 없다.
  let paxNear = false
  if (moving) {
    const ids = [...new Set([ride.passengerUid, ride.passengerId].map((v) => (v ?? '').trim()).filter(Boolean))]
    for (const id of ids) {
      const pax = await presenceLocation('passenger', id).catch(() => null)
      if (!pax || !Number.isFinite(pax.lat) || !Number.isFinite(pax.lng)) continue
      if (now - pax.lastSeen > AUTO_BOARD_PAX_MAX_AGE_MS) continue
      if (haversineKm({ lat: pax.lat as number, lng: pax.lng as number }, next) <= AUTO_BOARD_PROXIMITY_KM) {
        paxNear = true
        break
      }
    }
  }
  if (!(moving && paxNear)) {
    if (ride.autoBoardSince) {
      ride.autoBoardSince = null
      stamp(ride)
    }
    return
  }
  if (!ride.autoBoardSince) {
    ride.autoBoardSince = new Date(now).toISOString()
    stamp(ride)
    return
  }
  if (now - Date.parse(ride.autoBoardSince) < AUTO_BOARD_DEBOUNCE_MS) return
  ride.boardedAt = new Date(now).toISOString()
  ride.boardedVia = 'auto'
  ride.autoBoardSince = null
  console.log('[auto-board] boarding stamped', { rideId: ride.id, driverId, speedKmh: Math.round(speedKmh) })
  const saved = stamp(ride)
  if (saved.assignedDriverId) publishDriverLive(saved.assignedDriverId)
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
  phone?: string
  altDriverId?: string
  serviceType?: string
  serviceRoles?: string[]
  deliveryVehicles?: string[]
  vehicleTiers?: string[]
}) {
  syncDispatchFromDisk()
  const current = getDriver(input.id)
  // Count rides assigned to alias identities (e.g. a device-generated id used
  // before partner login) so a busy driver is never offered a second ride.
  const assignedRide =
    input.status !== 'offline'
      ? listRides().find(
          (ride) =>
            (ride.assignedDriverId === input.id || (!!input.altDriverId && ride.assignedDriverId === input.altDriverId)) &&
            ride.status === 'assigned',
        )
      : undefined
  const hasAssignedRide = !!assignedRide
  // 자동 탑승 감지 — 배정 직후 승객·차량이 함께 움직이기 시작하면 서버가
  // boardedAt을 스탬프한다(기사 수동 버튼 없이 요금 시계 개시).
  if (input.status !== 'offline' && assignedRide && !assignedRide.boardedAt && current) {
    void evaluateAutoBoard(assignedRide.id, input.id, current, input).catch(() => undefined)
  }
  // 서버 측 주행 거리계 — presence 비트마다 탑승 이후 실제 이동 거리를 누적한다.
  // 최대 3km/비트를 넘는 점프는 GPS 튐으로 보고 버린다(20s 비트 기준 ~540km/h).
  if (assignedRide?.boardedAt && current && Number.isFinite(current.lat) && Number.isFinite(input.lat)) {
    const deltaKm = haversineKm(current, input)
    if (deltaKm > 0.002 && deltaKm < 3) {
      assignedRide.actualKm = (assignedRide.actualKm ?? 0) + deltaKm
      saveRide(assignedRide)
    }
  }
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
    status: input.status === 'offline' ? 'offline' : hasAssignedRide ? 'busy' : 'online',
    lastSeenAt: nowIso(),
    virtual: false,
    wallet: input.wallet?.trim() || current?.wallet,
    piUid: input.piUid?.trim() || current?.piUid,
    phone: input.phone?.trim() || current?.phone,
    serviceType: input.serviceType?.trim() || current?.serviceType,
    // 겸직·체급·등급은 배열 필드 — 비트가 값을 실어오면 교체하고, 없으면 기존 등록값 유지.
    serviceRoles:
      input.serviceRoles !== undefined
        ? normalizeServiceRoles(input.serviceRoles, input.serviceType?.trim() || current?.serviceType)
        : current?.serviceRoles,
    deliveryVehicles: input.deliveryVehicles !== undefined ? normalizeDeliveryVehicles(input.deliveryVehicles) : current?.deliveryVehicles,
    vehicleTiers: input.vehicleTiers !== undefined ? normalizeVehicleTiers(input.vehicleTiers) : current?.vehicleTiers,
  }
  const saved = saveDriver(next)
  // 온라인으로 돌아온 기사가 대기 중인 콜의 후보가 될 수 있으니 대기열을 즉시 다시 스캔한다.
  if (input.status !== 'offline') {
    const now = Date.now()
    for (const ride of listSearchingRides()) {
      if (ride.status !== 'searching' || !ride.waitUntil || Date.parse(ride.waitUntil) <= now) continue
      if (ride.currentOffer?.decision === 'pending') continue
      assignNextDriver(ride.id)
    }
  }
  return saved
}

export { subscribeRideLive }
