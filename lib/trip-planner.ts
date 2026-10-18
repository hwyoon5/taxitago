import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { kvCommand, kvConfigured, netFilePath, netKey } from '@/lib/kv'
import { createRideAndMatch, cancelRide } from '@/lib/dispatch-engine'
import { getRide, listRides, syncDispatchFromDisk } from '@/lib/dispatch-store'
import { createEvBooking, cancelEvBooking, getEvBooking, syncEvBookings } from '@/lib/ev-booking'
import { createDeliveryDispatch, deleteDeliveryDispatch, getDeliveryDispatch } from '@/lib/delivery-dispatch'
import { estimateTaxiFarePi, etaMinutesFromKm, haversineKm, waypointRouteQuote, waypointSurchargePi } from '@/lib/dispatch-geo'
import { drivingRouteSummaryOnServer } from '@/lib/server-directions'
import { getFareConfig } from '@/lib/fare-config-server'
import { timeSurchargeRate, tierBaseFarePi, tierFareRate, tollFareToPi } from '@/lib/fare-config'
import { normalizeRideTier } from '@/lib/ride-tiers'
import { b2bOrgForMember } from '@/lib/b2b-store'
import { piRound } from '@/lib/pi-format'
import { isUsableCoord } from '@/lib/ride-session'
import type { GeoPoint } from '@/lib/dispatch-types'

/**
 * 다중 모달 통합 여정 플래너 (Trip Planner)
 *
 * 하나의 여정(Trip) 안에 택시/대리 이동, EV 충전 예약, 택배 발송을 다리(leg)
 * 단위로 묶어 계획·실행한다.
 *
 * - Trip은 각 leg가 만드는 실제 서비스 레코드(라이드·EV 예약·택배)를 refId로
 *   연결하는 오케스트레이션 장부 — 에스크로 잠금·정산·환불은 각 서비스의
 *   기존 라이프사이클이 그대로 처리하고, Trip은 상태를 읽어 통합 전이를
 *   추적한다(lazy sync — 읽기·쓰기 경로마다 갱신).
 * - 위치 연동: EV 다리의 충전소 좌표는 택시 다리의 경유지(waypoints)로 자동
 *   삽입돼 경로·요금·ETA가 한 번에 견적된다.
 * - 시간 연동: 충전 예약 시작 시각과 택배 수거 시각은 출발 시각 + 구간 ETA
 *   기준의 서버 계산 기본값('suggested*')을 갖고, 클라이언트가 조정해
 *   확정한다. 'arrival' 힌트는 도착 시각으로 해석된다.
 * - 네트워크 스코프: 연결되는 모든 레코드가 결제 장부이므로 Trip도
 *   netKey('taxitago:trips')에 저장해 testnet/mainnet이 섞이지 않는다.
 */

export type TripLegKind = 'ride' | 'ev' | 'delivery'

export type TripLegStatus = 'planned' | 'booked' | 'active' | 'completed' | 'cancelled' | 'failed'

export type TripLeg = {
  id: string
  kind: TripLegKind
  /** 화면 표시용 요약 — '해운대 충전소 경유 충전' 등. */
  label: string
  status: TripLegStatus
  /** 실행된 실제 레코드 id — rideId / bookingId / deliveryId. */
  refId?: string
  error?: string

  // ride leg
  rideKind?: 'taxi' | 'daeri'
  tier?: string
  waitMinutes?: number | null
  pickup?: GeoPoint
  dest?: GeoPoint
  waypoints?: GeoPoint[]
  /** 서버 견적 — 활성화 시 요금이 바뀔 수 있다. */
  estimatedFare?: number
  expectedMinutes?: number

  // ev leg
  stationId?: string
  stationName?: string
  stationLat?: number | null
  stationLng?: number | null
  startAt?: string
  durationMin?: number

  // delivery leg
  pickupAddress?: string
  pickupLat?: number | null
  pickupLng?: number | null
  destAddress?: string
  destLat?: number | null
  destLng?: number | null
  packageLabel?: string
  packageSize?: string
  vehicle?: string
  fare?: number
  senderPhone?: string
  recipientPhone?: string
  driverNote?: string
  scheduledAt?: string | null
}

export type TripStatus = 'planned' | 'active' | 'completed' | 'cancelled'

export type Trip = {
  id: string
  ownerId: string
  /** 계획 출발 시각(ISO) — 없으면 즉시. */
  departAt?: string | null
  legs: TripLeg[]
  status: TripStatus
  /** 서버가 제안한 시간 연동 값 — 클라이언트가 조정 전 참고용. */
  suggested?: {
    evStartAt?: string
    deliveryPickupAt?: string
    rideMinutes?: number
    arriveAt?: string
  }
  createdAt: string
  updatedAt: string
}

const MAX_LEGS = 4
const MAX_TRIPS = 500

const nowIso = () => new Date().toISOString()
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

// ── 스토어 (네트워크 스코프) ─────────────────────────────────────────

const KV_KEY = netKey('taxitago:trips')
const filePath = netFilePath(path.join(process.cwd(), 'data', 'trips.json'))
const useKv = kvConfigured

type Store = { trips: Map<string, Trip>; hydrated: boolean }

function db(): Store {
  const g = globalThis as typeof globalThis & { __taxitagoTrips?: Store }
  if (!g.__taxitagoTrips) g.__taxitagoTrips = { trips: new Map(), hydrated: false }
  const store = g.__taxitagoTrips
  if (!store.hydrated) {
    store.hydrated = true
    try {
      if (existsSync(filePath)) {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { trips?: Trip[] }
        for (const row of parsed.trips ?? []) store.trips.set(row.id, row)
      }
    } catch {
      /* 손상된 폴백 파일은 무시 */
    }
  }
  return store
}

/** 다른 프로세스가 파일에 쓴 최신 레코드를 병합한다. */
function syncFromDisk() {
  const store = db()
  try {
    if (!existsSync(filePath)) return
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { trips?: Trip[] }
    for (const row of parsed.trips ?? []) {
      const current = store.trips.get(row.id)
      if (!current || Date.parse(current.updatedAt || '') <= Date.parse(row.updatedAt || '')) {
        store.trips.set(row.id, row)
      }
    }
  } catch {
    /* ignore */
  }
}

async function hydrateFromKv() {
  if (!useKv) {
    syncFromDisk()
    return
  }
  try {
    const raw = await kvCommand<string | null>(['GET', KV_KEY])
    if (!raw) return
    const parsed = JSON.parse(raw) as { trips?: Trip[] }
    const store = db()
    for (const row of parsed.trips ?? []) {
      const current = store.trips.get(row.id)
      if (!current || Date.parse(current.updatedAt || '') <= Date.parse(row.updatedAt || '')) {
        store.trips.set(row.id, row)
      }
    }
  } catch {
    /* KV 장애 시 로컬 상태로 진행 */
  }
}

function persist() {
  const store = db()
  const trips = [...store.trips.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-MAX_TRIPS)
  store.trips = new Map(trips.map((t) => [t.id, t]))
  const payload = JSON.stringify({ trips })
  if (useKv) {
    void kvCommand(['SET', KV_KEY, payload]).catch(() => undefined)
  }
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, payload, 'utf8')
  } catch {
    /* 파일 폴백 실패는 무시 */
  }
}

// ── 조회 ────────────────────────────────────────────────────────────

export function getTrip(id: string) {
  return db().trips.get(id) ?? null
}

export function listTrips(ownerId: string) {
  return [...db().trips.values()]
    .filter((trip) => trip.ownerId === ownerId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 20)
}

// ── 상태 동기화 (lazy) ───────────────────────────────────────────────

const LEG_OPEN: TripLegStatus[] = ['planned', 'booked', 'active']

/** 다리의 연결 레코드 상태를 읽어 leg.status를 갱신한다. */
async function syncLeg(leg: TripLeg): Promise<boolean> {
  if (!leg.refId || !LEG_OPEN.includes(leg.status)) return false
  const before = leg.status
  if (leg.kind === 'ride') {
    syncDispatchFromDisk()
    const ride = getRide(leg.refId)
    if (!ride) return false
    if (ride.status === 'assigned') leg.status = 'active'
    else if (ride.status === 'completed') leg.status = 'completed'
    else if (ride.status === 'cancelled' || ride.status === 'unmatched') leg.status = 'cancelled'
    else leg.status = 'booked' // searching/offered
  } else if (leg.kind === 'ev') {
    syncEvBookings()
    const booking = getEvBooking(leg.refId)
    if (!booking) return false
    if (booking.status === 'active') leg.status = 'active'
    else if (booking.status === 'fulfilled') leg.status = 'completed'
    else if (booking.status === 'cancelled' || booking.status === 'expired') leg.status = 'cancelled'
    else leg.status = 'booked' // queued/reserved/notified
  } else {
    const job = await getDeliveryDispatch(leg.refId).catch(() => null)
    if (!job) return false
    if (job.status === 'completed') leg.status = 'completed'
    else if (job.status === 'expired') leg.status = 'cancelled'
    else if (job.status === 'in_transit') leg.status = 'active'
    else leg.status = 'booked' // requested/assigned
  }
  return leg.status !== before
}

/** 여정 전체 상태를 다리 상태에서 도출한다. */
function deriveTripStatus(trip: Trip): TripStatus {
  const statuses = trip.legs.map((leg) => leg.status)
  if (statuses.every((s) => s === 'completed')) return 'completed'
  if (statuses.every((s) => s === 'cancelled' || s === 'failed')) return 'cancelled'
  if (statuses.some((s) => s === 'booked' || s === 'active' || s === 'completed')) return 'active'
  return 'planned'
}

/** 읽기 경로마다 호출 — 연결 레코드의 최신 상태를 여정에 반영한다. */
export async function syncTrip(trip: Trip): Promise<Trip> {
  if (trip.status === 'cancelled' || trip.status === 'completed') return trip
  let dirty = false
  for (const leg of trip.legs) {
    if (await syncLeg(leg).catch(() => false)) dirty = true
  }
  const next = deriveTripStatus(trip)
  if (next !== trip.status) {
    trip.status = next
    dirty = true
  }
  if (dirty) {
    trip.updatedAt = nowIso()
    persist()
  }
  return trip
}

// ── 생성 ────────────────────────────────────────────────────────────

type LegInput = Partial<TripLeg> & { kind: TripLegKind }

function asPoint(lat: unknown, lng: unknown, extra?: { address?: unknown; label?: unknown }): GeoPoint | null {
  if (!isUsableCoord(lat, lng)) return null
  return {
    lat: Number(lat),
    lng: Number(lng),
    address: typeof extra?.address === 'string' ? extra.address : undefined,
    label: typeof extra?.label === 'string' ? extra.label : undefined,
  }
}

function normalizeLeg(input: LegInput, index: number): TripLeg | null {
  const base = {
    id: `leg-${index + 1}`,
    kind: input.kind,
    status: 'planned' as TripLegStatus,
    label: clip(input.label, 80),
  }
  if (input.kind === 'ride') {
    const pickup = input.pickup && isUsableCoord(input.pickup.lat, input.pickup.lng) ? input.pickup : null
    const dest = input.dest && isUsableCoord(input.dest.lat, input.dest.lng) ? input.dest : null
    if (!pickup || !dest) return null
    const waypoints = (Array.isArray(input.waypoints) ? input.waypoints : [])
      .slice(0, 2)
      .filter((wp): wp is GeoPoint => Boolean(wp && isUsableCoord(wp.lat, wp.lng)))
    const wait = Number(input.waitMinutes)
    return {
      ...base,
      label: base.label || (input.rideKind === 'daeri' ? '대리운전' : '택시 이동'),
      rideKind: input.rideKind === 'daeri' ? 'daeri' : 'taxi',
      tier: input.rideKind === 'daeri' ? undefined : normalizeRideTier(input.tier),
      waitMinutes: wait === 5 || wait === 10 ? wait : null,
      pickup,
      dest,
      waypoints,
    }
  }
  if (input.kind === 'ev') {
    const stationId = clip(input.stationId, 80)
    if (!stationId) return null
    return {
      ...base,
      label: base.label || clip(input.stationName, 80) || 'EV 충전',
      stationId,
      stationName: clip(input.stationName, 80) || stationId,
      stationLat: Number.isFinite(Number(input.stationLat)) ? Number(input.stationLat) : null,
      stationLng: Number.isFinite(Number(input.stationLng)) ? Number(input.stationLng) : null,
      startAt: typeof input.startAt === 'string' && Date.parse(input.startAt) ? input.startAt : undefined,
      durationMin: Math.min(240, Math.max(15, Math.round(Number(input.durationMin)) || 60)),
    }
  }
  const pickupAddress = clip(input.pickupAddress, 120)
  const destAddress = clip(input.destAddress, 120)
  if (!pickupAddress || !destAddress) return null
  return {
    ...base,
    label: base.label || '택배 발송',
    pickupAddress,
    pickupLat: Number.isFinite(Number(input.pickupLat)) ? Number(input.pickupLat) : null,
    pickupLng: Number.isFinite(Number(input.pickupLng)) ? Number(input.pickupLng) : null,
    destAddress,
    destLat: Number.isFinite(Number(input.destLat)) ? Number(input.destLat) : null,
    destLng: Number.isFinite(Number(input.destLng)) ? Number(input.destLng) : null,
    packageLabel: clip(input.packageLabel, 40) || '소포',
    packageSize: clip(input.packageSize, 20) || undefined,
    vehicle: clip(input.vehicle, 20) || undefined,
    fare: Number.isFinite(Number(input.fare)) && Number(input.fare) >= 0 ? piRound(Number(input.fare)) : 0,
    senderPhone: clip(input.senderPhone, 30),
    recipientPhone: clip(input.recipientPhone, 30),
    driverNote: clip(input.driverNote, 120) || undefined,
    scheduledAt: typeof input.scheduledAt === 'string' && Date.parse(input.scheduledAt) ? input.scheduledAt : null,
  }
}

/**
 * 시간·위치 연동 — EV 다리 좌표를 택시 경유지로 삽입하고, 출발 시각 기준으로
 * 충전 예약 시작·택배 수거·도착 시각의 제안값을 계산한다.
 */
async function suggestSchedule(legs: TripLeg[], departAt: string | null): Promise<Trip['suggested']> {
  const ride = legs.find((leg) => leg.kind === 'ride')
  const ev = legs.find((leg) => leg.kind === 'ev')
  const delivery = legs.find((leg) => leg.kind === 'delivery')
  if (!ride?.pickup || !ride.dest) return undefined
  const departMs = departAt ? Date.parse(departAt) : Date.now()
  const depart = Number.isFinite(departMs) ? departMs : Date.now()

  // EV 충전소가 좌표를 갖고 있고 아직 경유지에 없으면 경유지로 삽입한다.
  if (ev && isUsableCoord(ev.stationLat, ev.stationLng)) {
    const stationPoint: GeoPoint = {
      lat: Number(ev.stationLat),
      lng: Number(ev.stationLng),
      label: ev.stationName,
      address: ev.stationName,
    }
    const already = (ride.waypoints ?? []).some(
      (wp) => haversineKm(wp, stationPoint) < 0.15,
    )
    if (!already) ride.waypoints = [stationPoint, ...(ride.waypoints ?? [])].slice(0, 2)
  }

  const summary = await Promise.race([
    drivingRouteSummaryOnServer(ride.pickup, ride.dest, ride.waypoints ?? []),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 6500)),
  ]).catch(() => null)
  const rideKm = waypointRouteQuote(ride.pickup, ride.dest, ride.waypoints ?? []).routeKm
  const rideMinutes =
    summary && Number.isFinite(summary.durationMin)
      ? (summary.durationMin as number)
      : etaMinutesFromKm(rideKm)

  // 충전소까지의 구간 시간 — 경유지가 있으면 출발→충전소 구간만 별도 추정.
  let evLegMinutes = rideMinutes
  if (ev && ride.waypoints?.length) {
    const legSummary = await Promise.race([
      drivingRouteSummaryOnServer(ride.pickup, ride.waypoints[0], []),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]).catch(() => null)
    evLegMinutes =
      legSummary && Number.isFinite(legSummary.durationMin)
        ? (legSummary.durationMin as number)
        : etaMinutesFromKm(haversineKm(ride.pickup, ride.waypoints[0]) * 1.3)
  }

  const chargeMs = (ev?.durationMin ?? 60) * 60_000
  return {
    // 충전 예약은 출발 + 충전소 도착 예상 시각, 도착은 그 뒤 충전 시간 + 나머지 구간.
    evStartAt: ev ? new Date(depart + evLegMinutes * 60_000).toISOString() : undefined,
    rideMinutes: Math.round(rideMinutes + (ev ? chargeMs / 60_000 : 0)),
    arriveAt: new Date(depart + (rideMinutes + (ev ? chargeMs / 60_000 : 0)) * 60_000).toISOString(),
    deliveryPickupAt: delivery ? (delivery.scheduledAt ?? new Date(depart + rideMinutes * 60_000 + chargeMs).toISOString()) : undefined,
  }
}

export async function createTrip(ownerId: string, input: { departAt?: unknown; legs?: unknown }) {
  const uid = clip(ownerId, 80)
  if (!uid) return { ok: false as const, error: 'owner_required', trip: null }
  const rawLegs = Array.isArray(input.legs) ? (input.legs as LegInput[]) : []
  if (!rawLegs.length || rawLegs.length > MAX_LEGS) return { ok: false as const, error: 'legs_required', trip: null }
  const legs: TripLeg[] = []
  for (const [index, raw] of rawLegs.entries()) {
    if (!raw || (raw.kind !== 'ride' && raw.kind !== 'ev' && raw.kind !== 'delivery')) {
      return { ok: false as const, error: 'invalid_leg', trip: null }
    }
    const leg = normalizeLeg(raw, index)
    if (!leg) return { ok: false as const, error: `invalid_${raw.kind}_leg`, trip: null }
    legs.push(leg)
  }
  const departAt = typeof input.departAt === 'string' && Date.parse(input.departAt) ? input.departAt : null
  const suggested = await suggestSchedule(legs, departAt)
  // 제안값을 다리 기본값에 반영한다(클라이언트가 명시한 값은 유지).
  for (const leg of legs) {
    if (leg.kind === 'ev' && !leg.startAt && suggested?.evStartAt) leg.startAt = suggested.evStartAt
    if (leg.kind === 'delivery' && !leg.scheduledAt && suggested?.deliveryPickupAt) leg.scheduledAt = suggested.deliveryPickupAt
  }
  const now = nowIso()
  const trip: Trip = {
    id: `trip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ownerId: uid,
    departAt,
    legs,
    status: 'planned',
    suggested,
    createdAt: now,
    updatedAt: now,
  }
  db().trips.set(trip.id, trip)
  persist()
  return { ok: true as const, trip }
}

// ── 실행 (다리별 실제 서비스 레코드 생성) ────────────────────────────

async function activateRideLeg(trip: Trip, leg: TripLeg, ctx: { passengerId: string; passengerUid?: string; passengerPhone?: string }) {
  if (!leg.pickup || !leg.dest) return { ok: false as const, error: 'invalid_ride_leg' }
  // 진행 중인 다른 콜이 있으면 새 콜을 만들지 않는다(기존 정책과 동일한 dedupe).
  const existing = listRides().find(
    (ride) =>
      ride.passengerId === ctx.passengerId &&
      (ride.status === 'searching' || ride.status === 'offered' || ride.status === 'assigned'),
  )
  if (existing) return { ok: false as const, error: 'ride_in_progress', refId: existing.id }
  const b2b = await b2bOrgForMember(ctx.passengerId).catch(() => null)
  const fareQuote = waypointRouteQuote(leg.pickup, leg.dest, leg.waypoints ?? [])
  const config = await getFareConfig()
  const tier = leg.rideKind === 'taxi' ? leg.tier : undefined
  const tierRate = tierFareRate(config, tier)
  const tierBase = tierBaseFarePi(config, tier)
  const baseQuoted =
    typeof leg.estimatedFare === 'number' && Number.isFinite(leg.estimatedFare) && leg.estimatedFare > 0
      ? piRound(Math.max(tierBase, piRound(Math.max(0, leg.estimatedFare) * tierRate)) + waypointSurchargePi(fareQuote.chargeableDetourKm, config, leg.rideKind ?? 'taxi', tier))
      : estimateTaxiFarePi(fareQuote.chargeableKm, config, leg.rideKind ?? 'taxi', tier)
  const nightRate = timeSurchargeRate(config)
  const quoted = nightRate > 0 ? piRound(baseQuoted * (1 + nightRate)) : baseQuoted
  const summary = await Promise.race([
    drivingRouteSummaryOnServer(leg.pickup, leg.dest, leg.waypoints ?? []),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 6500)),
  ]).catch(() => null)
  const expectedMinutes =
    summary && Number.isFinite(summary.durationMin)
      ? (summary.durationMin as number)
      : etaMinutesFromKm(fareQuote.routeKm)
  const tollKrw = summary?.tollFare != null && summary.tollFare > 0 ? summary.tollFare : null
  const tollPi = tollKrw ? tollFareToPi(tollKrw, config) : 0
  const ride = createRideAndMatch({
    id: `trip-${trip.id}-${leg.id}`,
    kind: leg.rideKind ?? 'taxi',
    tier,
    passengerId: ctx.passengerId,
    passengerUid: ctx.passengerUid,
    passengerPhone: ctx.passengerPhone,
    b2bOrgId: b2b?.org.id || null,
    pickup: leg.pickup,
    waypoints: leg.waypoints ?? [],
    dest: leg.dest,
    estimatedFare: quoted,
    tollPi,
    tollKrw,
    expectedMinutes,
    waitMinutes: leg.waitMinutes,
  })
  return { ok: true as const, refId: ride.id }
}

async function activateEvLeg(trip: Trip, leg: TripLeg, ctx: { passengerId: string; passengerUid?: string }) {
  const result = createEvBooking({
    userId: ctx.passengerId,
    userUid: ctx.passengerUid,
    stationId: leg.stationId!,
    stationName: leg.stationName,
    startAt: leg.startAt,
    durationMin: leg.durationMin,
  })
  if (!result.ok) return { ok: false as const, error: result.error }
  return { ok: true as const, refId: result.booking!.id }
}

async function activateDeliveryLeg(trip: Trip, leg: TripLeg, ctx: { passengerId: string }) {
  const b2b = await b2bOrgForMember(ctx.passengerId).catch(() => null)
  const job = await createDeliveryDispatch({
    ownerId: ctx.passengerId,
    pickupAddress: leg.pickupAddress!,
    pickupLat: leg.pickupLat ?? null,
    pickupLng: leg.pickupLng ?? null,
    destAddress: leg.destAddress!,
    destLat: leg.destLat ?? null,
    destLng: leg.destLng ?? null,
    scheduledAt: leg.scheduledAt ?? null,
    vehicle: leg.vehicle,
    packageSize: leg.packageSize,
    packageLabel: leg.packageLabel || '소포',
    fare: leg.fare ?? 0,
    senderPhone: leg.senderPhone || '',
    recipientPhone: leg.recipientPhone || '',
    driverNote: leg.driverNote,
    b2bOrgId: b2b?.org.id || null,
    createdAt: nowIso(),
    id: `trip-${trip.id}-${leg.id}`,
  })
  return { ok: true as const, refId: job.id }
}

/**
 * 다리 실행 — 실제 서비스 레코드를 만들어 refId로 연결한다.
 * 에스크로 잠금·예치금·정산은 각 서비스의 기존 라이프사이클이 처리하고,
 * 여정은 refId로 상태를 추적한다.
 */
export async function activateTripLeg(
  tripId: string,
  legId: string | null,
  ctx: { passengerId: string; passengerUid?: string; passengerPhone?: string },
) {
  await hydrateFromKv()
  const trip = getTrip(tripId)
  if (!trip || trip.ownerId !== ctx.passengerId) return { ok: false as const, error: 'not_found', trip: null }
  if (trip.status === 'cancelled') return { ok: false as const, error: 'trip_cancelled', trip }
  const targets = trip.legs.filter((leg) => leg.status === 'planned' && (!legId || leg.id === legId))
  if (legId && !targets.length) return { ok: false as const, error: 'leg_not_found', trip }
  for (const leg of targets) {
    const result =
      leg.kind === 'ride'
        ? await activateRideLeg(trip, leg, ctx)
        : leg.kind === 'ev'
          ? await activateEvLeg(trip, leg, ctx)
          : await activateDeliveryLeg(trip, leg, ctx)
    if (result.ok) {
      leg.refId = result.refId
      leg.status = 'booked'
      leg.error = undefined
    } else {
      leg.status = 'failed'
      leg.error = result.error
    }
  }
  trip.status = deriveTripStatus(trip)
  trip.updatedAt = nowIso()
  persist()
  return { ok: true as const, trip }
}

// ── 취소 ────────────────────────────────────────────────────────────

/** 여정 취소 — 실행된 각 다리를 해당 서비스의 취소 경로로 되돌린다. */
export async function cancelTrip(tripId: string, ownerId: string) {
  await hydrateFromKv()
  const trip = getTrip(tripId)
  if (!trip || trip.ownerId !== ownerId) return { ok: false as const, error: 'not_found', trip: null }
  for (const leg of trip.legs) {
    if (!LEG_OPEN.includes(leg.status)) continue
    try {
      if (leg.kind === 'ride' && leg.refId) {
        cancelRide(leg.refId, ownerId)
      } else if (leg.kind === 'ev' && leg.refId) {
        cancelEvBooking(leg.refId, { userId: ownerId })
      } else if (leg.kind === 'delivery' && leg.refId) {
        await deleteDeliveryDispatch(leg.refId, ownerId)
      }
    } catch {
      /* 개별 다리 취소 실패는 여정 취소를 막지 않는다 */
    }
    leg.status = 'cancelled'
  }
  trip.status = 'cancelled'
  trip.updatedAt = nowIso()
  persist()
  return { ok: true as const, trip }
}
