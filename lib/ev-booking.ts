import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { kvCommand, kvConfigured, netFilePath, netKey } from '@/lib/kv'
import { getEvSession, listEvSessions, syncEvChargeFromDisk } from '@/lib/ev-charge-store'
import { sendUserPush } from '@/lib/driver-push'

/**
 * EV 충전 예약·대기열(스마트 밸런싱)
 *
 * - 충전소(EvStation): 충전기 id(스팟 id) 기준 동시 충전 슬롯 수를 관리하는
 *   운영 설정 — 전역 키 'taxitago:ev-stations'(공용 KV / 파일 폴백)에 저장해
 *   네트워크 전환과 무관하게 유지한다. 미등록 충전소는 첫 접근 시 슬롯 1로
 *   자동 등록된다.
 * - 예약(EvBooking): 시간대 예약 + 즉시 대기열. 슬롯이 비면 'reserved'/
 *   'notified', 차 있으면 'queued'로 들어가 선착순(createdAt)으로 승격된다.
 *   결제 장부와 달리 돈은 안 오가지만 충전 세션(네트워크 스코프)과 점유가
 *   맞물려야 하므로 같은 스코프(netKey)에 둔다.
 * - 점유 규칙: 예약 건은 [startAt, endAt](즉시 승격 건은 notifiedAt 기준),
 *   'active' 건과 예약 없는 walk-in 충전 세션은 잠금 시점부터 최대
 *   SLOT_HOLD_MS(3h)를 점유로 본다 — 방치된 세션이 슬롯을 영구 점유하는
 *   것을 막는 상한이다.
 */

export type EvBookingStatus =
  | 'queued'     // 대기열 — 슬롯이 나는 대로 선착순 승격
  | 'reserved'   // 미래 시간대 슬롯 확보 완료
  | 'notified'   // 차례 도착 — checkInBy까지 충전 시작(체크인) 대기
  | 'active'     // 충전 세션과 연결돼 이용 중
  | 'fulfilled'  // 충전 완료로 마감
  | 'cancelled'  // 이용자/관리자 취소
  | 'expired'    // 예약 시각·체크인 기한 경과로 자동 만료

export type EvStation = {
  id: string
  name: string
  /** 동시 충전 가능 슬롯 수 — 관리자가 조정한다(기본 1). */
  slots: number
  /** 슬롯당 출력(kW) — 관제 부하 표시용. */
  powerKw?: number
  providerName?: string
  updatedAt: string
  updatedBy?: string
}

export type EvBooking = {
  id: string
  userId: string
  userUid?: string
  stationId: string
  stationName: string
  /** 희망 시작 시각 — '지금' 예약이면 생성 시각. */
  startAt: string
  durationMin: number
  endAt: string
  /** '지금' 예약 — 슬롯이 나는 즉시 시작 가능한 건. */
  flexible: boolean
  status: EvBookingStatus
  queuePos?: number
  /** queued 건의 예상 시작 시각(추정치 — 앞선 대기열 변동으로 바뀔 수 있다). */
  estStartAt?: string
  notifiedAt?: string
  /** 체크인 마감 — 지나면 expired되고 다음 대기자에게 넘긴다. */
  checkInBy?: string
  checkedInAt?: string
  sessionId?: string
  createdAt: string
  updatedAt: string
}

export type EvStationAvailability = {
  stationId: string
  name: string
  slots: number
  occupiedNow: number
  queueDepth: number
  /** 지금 대기열에 들어가면 예상되는 가장 빠른 시작 시각. */
  nextFreeAt?: string
}

const MIN_DURATION_MIN = 15
const MAX_DURATION_MIN = 240
const DEFAULT_DURATION_MIN = 60
const MAX_ADVANCE_MS = 48 * 3_600_000
/** notified 승격 후 이 시간 안에 충전을 시작해야 한다. */
const NOTIFY_WINDOW_MS = 10 * 60_000
/** reserved 건은 시작 시각 이후 이 유예까지 체크인을 허용한다. */
const CHECKIN_GRACE_MS = 15 * 60_000
/** reserved → notified 안내를 시작 시각 전 이 시점에 보낸다. */
const NOTIFY_LEAD_MS = 10 * 60_000
/** 충전 세션이 슬롯을 점유하는 최대 시간 — 방치 세션의 영구 점유 방지 상한. */
const SLOT_HOLD_MS = 180 * 60_000
const MAX_BOOKINGS = 500
const MAX_STATIONS = 200

const nowIso = () => new Date().toISOString()

// ── 충전소 설정 스토어 (전역) ─────────────────────────────────────────

const STATIONS_KEY = 'taxitago:ev-stations'
const stationsFile = path.join(process.cwd(), 'data', 'ev-stations.json')

// 운영 설정은 네트워크 무관 — 공용 KV 엔드포인트를 직접 쓴다(push-store와 같은 이유).
const commonKvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const commonKvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useCommonKv = Boolean(commonKvUrl && commonKvToken)

type StationStore = { stations: Map<string, EvStation>; loaded: boolean }

function stationDb(): StationStore {
  const g = globalThis as typeof globalThis & { __taxitagoEvStations?: StationStore }
  if (!g.__taxitagoEvStations) {
    g.__taxitagoEvStations = { stations: new Map(), loaded: false }
  }
  const store = g.__taxitagoEvStations
  if (!store.loaded) {
    store.loaded = true
    try {
      if (existsSync(stationsFile)) {
        const parsed = JSON.parse(readFileSync(stationsFile, 'utf8')) as { stations?: EvStation[] }
        for (const row of parsed.stations ?? []) store.stations.set(row.id, row)
      }
    } catch {
      undefined
    }
    if (useCommonKv) {
      void fetch(commonKvUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${commonKvToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['GET', STATIONS_KEY]),
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { result?: string | null } | null) => {
          if (!data?.result) return
          const parsed = JSON.parse(data.result) as { stations?: EvStation[] }
          for (const row of parsed.stations ?? []) {
            const current = store.stations.get(row.id)
            if (!current || row.updatedAt > current.updatedAt) store.stations.set(row.id, row)
          }
        })
        .catch(() => undefined)
    }
  }
  return store
}

function persistStations() {
  const payload = { stations: [...stationDb().stations.values()].slice(-MAX_STATIONS) }
  try {
    mkdirSync(path.dirname(stationsFile), { recursive: true })
    writeFileSync(stationsFile, JSON.stringify(payload), 'utf8')
  } catch {
    undefined
  }
  if (useCommonKv) {
    void fetch(commonKvUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${commonKvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', STATIONS_KEY, JSON.stringify(payload)]),
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    }).catch(() => undefined)
  }
}

export function getEvStation(id: string) {
  return stationDb().stations.get(id) ?? null
}

export function listEvStations() {
  return [...stationDb().stations.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function saveEvStation(station: EvStation) {
  station.updatedAt = nowIso()
  stationDb().stations.set(station.id, station)
  persistStations()
  return station
}

/** 미등록 충전소는 슬롯 1로 자동 등록 — 관리자가 이후 슬롯 수를 조정한다. */
export function ensureEvStation(id: string, init?: { name?: string; powerKw?: number; providerName?: string }) {
  const key = id.trim().slice(0, 80) || 'ev-station'
  const existing = getEvStation(key)
  if (existing) {
    let dirty = false
    if (init?.name && init.name !== existing.name) {
      existing.name = init.name.slice(0, 80)
      dirty = true
    }
    if (init?.powerKw && !existing.powerKw) {
      existing.powerKw = init.powerKw
      dirty = true
    }
    if (dirty) saveEvStation(existing)
    return existing
  }
  return saveEvStation({
    id: key,
    name: (init?.name || key).slice(0, 80),
    slots: 1,
    powerKw: init?.powerKw,
    providerName: init?.providerName?.slice(0, 60),
    updatedAt: nowIso(),
  })
}

// ── 예약 스토어 (네트워크 스코프) ─────────────────────────────────────

type BookingPersist = { bookings?: EvBooking[] }

const bookingFile = netFilePath(path.join(process.cwd(), 'data', 'ev-booking.json'))
const useKv = kvConfigured
const bookingKvKey = netKey('taxitago:ev-booking:bookings')

type BookingStore = { bookings: Map<string, EvBooking>; hydrated: boolean }

const OPEN_STATUS = new Set<EvBookingStatus>(['queued', 'reserved', 'notified', 'active'])

function bookingDb(): BookingStore {
  const g = globalThis as typeof globalThis & { __taxitagoEvBooking?: BookingStore }
  if (!g.__taxitagoEvBooking) g.__taxitagoEvBooking = { bookings: new Map(), hydrated: false }
  const store = g.__taxitagoEvBooking
  if (!store.hydrated) {
    store.hydrated = true
    const parsed = readBookingFile()
    for (const row of parsed?.bookings ?? []) store.bookings.set(row.id, row)
  }
  return store
}

function readBookingFile(): BookingPersist | null {
  try {
    if (!existsSync(bookingFile)) return null
    return JSON.parse(readFileSync(bookingFile, 'utf8')) as BookingPersist
  } catch {
    return null
  }
}

async function fetchBookingKv(): Promise<BookingPersist | null> {
  const raw = await kvCommand<string | null>(['GET', bookingKvKey])
  if (!raw) return null
  try {
    return JSON.parse(raw) as BookingPersist
  } catch {
    return null
  }
}

function mergeBookings(parsed: BookingPersist) {
  const store = bookingDb()
  for (const row of parsed.bookings ?? []) {
    const current = store.bookings.get(row.id)
    if (!current || row.updatedAt >= current.updatedAt) store.bookings.set(row.id, row)
  }
}

let kvPullAt = 0
let kvPulling = false
function pullBookingsFromKv() {
  if (!useKv) return
  const now = Date.now()
  if (kvPulling || now - kvPullAt < 1500) return
  kvPullAt = now
  kvPulling = true
  void fetchBookingKv()
    .then((parsed) => {
      if (parsed) mergeBookings(parsed)
    })
    .catch(() => undefined)
    .finally(() => {
      kvPulling = false
    })
}

export function syncEvBookings() {
  const parsed = readBookingFile()
  if (parsed) mergeBookings(parsed)
  pullBookingsFromKv()
  syncEvChargeFromDisk()
}

function persistBookings() {
  const payload: BookingPersist = { bookings: [...bookingDb().bookings.values()].slice(-MAX_BOOKINGS) }
  try {
    mkdirSync(path.dirname(bookingFile), { recursive: true })
    writeFileSync(bookingFile, JSON.stringify(payload), 'utf8')
  } catch {
    undefined
  }
  if (useKv) {
    void kvCommand(['SET', bookingKvKey, JSON.stringify(payload)]).catch((error) => {
      console.error('[ev-booking] kv persist failed', error instanceof Error ? error.message : 'write error')
    })
  }
}

function saveBooking(booking: EvBooking) {
  booking.updatedAt = nowIso()
  bookingDb().bookings.set(booking.id, booking)
  persistBookings()
  return booking
}

export function getEvBooking(id: string) {
  return bookingDb().bookings.get(id) ?? null
}

export function listEvBookings(filter?: { userId?: string; stationId?: string; openOnly?: boolean }) {
  let rows = [...bookingDb().bookings.values()]
  if (filter?.userId) rows = rows.filter((row) => row.userId === filter.userId || row.userUid === filter.userId)
  if (filter?.stationId) rows = rows.filter((row) => row.stationId === filter.stationId)
  if (filter?.openOnly) rows = rows.filter((row) => OPEN_STATUS.has(row.status))
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** 이용자의 미마감 예약 — 한 번에 하나의 활성 예약만 허용한다. */
export function openBookingForUser(userId: string) {
  const id = userId.trim()
  if (!id) return null
  return listEvBookings({ openOnly: true }).find((row) => row.userId === id || row.userUid === id) ?? null
}

// ── 점유·가용 계산 ────────────────────────────────────────────────────

function overlap(aFrom: number, aTo: number, bFrom: number, bTo: number) {
  return aFrom < bTo && bFrom < aTo
}

/** 예약 건의 실제 점유 윈도우 — 즉시 승격 건은 notifiedAt부터 duration이다. */
function bookingWindow(booking: EvBooking): { from: number; to: number } | null {
  if (booking.status === 'reserved' || (booking.status === 'notified' && !booking.flexible)) {
    const from = Date.parse(booking.startAt)
    return Number.isFinite(from) ? { from, to: from + booking.durationMin * 60_000 } : null
  }
  if (booking.status === 'notified' && booking.flexible) {
    const from = Date.parse(booking.notifiedAt || booking.updatedAt)
    return Number.isFinite(from) ? { from, to: from + booking.durationMin * 60_000 } : null
  }
  if (booking.status === 'active') {
    const from = Date.parse(booking.checkedInAt || booking.updatedAt)
    return Number.isFinite(from) ? { from, to: from + SLOT_HOLD_MS } : null
  }
  return null
}

/** 예약 없이 충전 중인 walk-in 세션의 점유 윈도우 — 3h 상한으로 방치를 흡수한다. */
function walkInWindows(stationId: string): { from: number; to: number }[] {
  return listEvSessions()
    .filter((session) => session.chargerId === stationId && session.status === 'charging' && !session.bookingId)
    .map((session) => {
      const from = Date.parse(session.heldAt || session.startedAt || session.createdAt)
      return { from, to: from + SLOT_HOLD_MS }
    })
    .filter((w) => Number.isFinite(w.from))
}

/** 윈도우[from,to) 동안 점유 중인 슬롯 수 — excludeId로 특정 예약을 제외할 수 있다. */
export function stationOccupancy(stationId: string, from: number, to: number, excludeId?: string) {
  let count = 0
  for (const booking of bookingDb().bookings.values()) {
    if (booking.stationId !== stationId || booking.id === excludeId) continue
    const window = bookingWindow(booking)
    if (window && overlap(from, to, window.from, window.to)) count += 1
  }
  for (const window of walkInWindows(stationId)) {
    if (overlap(from, to, window.from, window.to)) count += 1
  }
  return count
}

export function stationQueueDepth(stationId: string) {
  let depth = 0
  for (const booking of bookingDb().bookings.values()) {
    if (booking.stationId === stationId && booking.status === 'queued') depth += 1
  }
  return depth
}

/**
 * notBefore 이후 슬롯이 비는 가장 빠른 시작 시각 — 점유 윈도우들의 끝 시점만
 * 후보로 검사한다(점유는 윈도우 경계에서만 줄어든다). 최대 48시간까지만 본다.
 */
export function earliestFreeAt(stationId: string, slots: number, notBefore: number, durationMin: number, excludeId?: string) {
  const dur = durationMin * 60_000
  const horizon = notBefore + MAX_ADVANCE_MS
  const candidates = new Set<number>([notBefore])
  for (const booking of bookingDb().bookings.values()) {
    if (booking.stationId !== stationId || booking.id === excludeId) continue
    const window = bookingWindow(booking)
    if (window && window.to >= notBefore) candidates.add(window.to)
  }
  for (const window of walkInWindows(stationId)) {
    if (window.to >= notBefore) candidates.add(window.to)
  }
  const sorted = [...candidates].filter((t) => t >= notBefore && t <= horizon).sort((a, b) => a - b)
  for (const start of sorted) {
    if (stationOccupancy(stationId, start, start + dur, excludeId) < slots) return start
  }
  return null
}

export function stationAvailability(stationId: string): EvStationAvailability {
  const station = getEvStation(stationId)
  const slots = Math.max(1, station?.slots ?? 1)
  const now = Date.now()
  return {
    stationId,
    name: station?.name || stationId,
    slots,
    occupiedNow: stationOccupancy(stationId, now, now + 60_000),
    queueDepth: stationQueueDepth(stationId),
    nextFreeAt: undefined,
  }
}

// ── 스윕: 만료 → 승격 → 순번/ETA 갱신 ────────────────────────────────

function notifyTurn(booking: EvBooking, label: 'turn' | 'soon') {
  const ownerId = booking.userUid || booking.userId
  void sendUserPush(
    ownerId,
    label === 'turn'
      ? {
          title: 'EV 충전 차례가 됐어요',
          body: `${booking.stationName} — 지금 충전을 시작할 수 있어요. 10분 안에 체크인해 주세요.`,
          tag: `ev-booking-${booking.id}`,
          url: '/',
          type: 'user',
        }
      : {
          title: 'EV 충전 예약 시간이 다가와요',
          body: `${booking.stationName} — 예약한 충전 시간이 곧 시작돼요.`,
          tag: `ev-booking-${booking.id}`,
          url: '/',
          type: 'user',
        },
    { kind: 'ev-booking' },
  ).catch(() => undefined)
}

/**
 * 충전소 상태 정리 — 읽기·쓰기 경로마다 호출해 서버리스 환경에서도
 * 스케줄러 없이 정합성을 유지한다(lazy sweep).
 * 1) 기한이 지난 notified/reserved를 만료, 종료된 세션의 active를 마감
 * 2) 대기열을 선착순으로 승격(방금 확정된 건이 점유를 잡으므로 중복 배정 없음)
 * 3) 남은 대기 건의 순번·예상 시작 시각을 갱신
 */
export function sweepEvStation(stationId: string) {
  const now = Date.now()
  const station = getEvStation(stationId)
  const slots = Math.max(1, station?.slots ?? 1)
  let dirty = false

  for (const booking of bookingDb().bookings.values()) {
    if (booking.stationId !== stationId) continue
    if (booking.status === 'reserved') {
      const start = Date.parse(booking.startAt)
      if (now > start + CHECKIN_GRACE_MS) {
        booking.status = 'expired'
        saveBooking(booking)
        dirty = true
      } else if (now >= start - NOTIFY_LEAD_MS) {
        // 예약 시간이 임박 — 슬롯이 유지되면 체크인 대기로 전환하고 알린다.
        if (stationOccupancy(stationId, start, start + booking.durationMin * 60_000, booking.id) < slots) {
          booking.status = 'notified'
          booking.notifiedAt = nowIso()
          booking.checkInBy = new Date(start + CHECKIN_GRACE_MS).toISOString()
          saveBooking(booking)
          notifyTurn(booking, 'soon')
        } else {
          // 슬롯 축소 등으로 자기 윈도우가 넘쳤다 — 대기열로 되돌린다.
          booking.status = 'queued'
          booking.checkInBy = undefined
          saveBooking(booking)
        }
        dirty = true
      }
    } else if (booking.status === 'notified') {
      const deadline = Date.parse(booking.checkInBy || '')
      if (Number.isFinite(deadline) && now > deadline) {
        booking.status = 'expired'
        saveBooking(booking)
        dirty = true
      }
    } else if (booking.status === 'active') {
      const session = booking.sessionId ? getEvSession(booking.sessionId) : null
      if (!session || session.status === 'settled' || session.status === 'refunded' || session.status === 'cancelled') {
        booking.status = session && session.status === 'cancelled' ? 'expired' : 'fulfilled'
        saveBooking(booking)
        dirty = true
      }
    }
  }

  // 대기열 승격 — createdAt 선착순, 승격된 건이 즉시 점유를 잡아 다음 건 계산에 반영된다.
  const queue = listEvBookings({ stationId, openOnly: true })
    .filter((row) => row.status === 'queued')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const remaining: EvBooking[] = []
  for (const booking of queue) {
    const start = Date.parse(booking.startAt)
    const due = booking.flexible || start <= now
    if (due) {
      if (stationOccupancy(stationId, now, now + booking.durationMin * 60_000) < slots) {
        booking.status = 'notified'
        booking.notifiedAt = nowIso()
        booking.checkInBy = new Date(now + NOTIFY_WINDOW_MS).toISOString()
        saveBooking(booking)
        notifyTurn(booking, 'turn')
        dirty = true
        continue
      }
    } else if (stationOccupancy(stationId, start, start + booking.durationMin * 60_000, booking.id) < slots) {
      // 미래 윈도우가 비었다 — 미리 'reserved'로 확정해 이용자가 시간을 알게 한다.
      booking.status = 'reserved'
      booking.checkInBy = new Date(start + CHECKIN_GRACE_MS).toISOString()
      saveBooking(booking)
      dirty = true
      continue
    }
    remaining.push(booking)
  }

  // 남은 대기 건 — 순번 매기고 앞 건의 예상 시작을 누적해 ETA를 추정한다.
  let cursor = now
  remaining.forEach((booking, index) => {
    const earliest = earliestFreeAt(
      stationId,
      slots,
      Math.max(cursor, booking.flexible ? now : Date.parse(booking.startAt)),
      booking.durationMin,
      booking.id,
    )
    const pos = index + 1
    const est = earliest != null ? new Date(earliest).toISOString() : undefined
    if (booking.queuePos !== pos || booking.estStartAt !== est) {
      booking.queuePos = pos
      booking.estStartAt = est
      saveBooking(booking)
    }
    if (earliest != null) cursor = Math.max(cursor, earliest + booking.durationMin * 60_000)
  })
  return dirty
}

export function sweepAllEvStations() {
  syncEvChargeFromDisk()
  for (const station of listEvStations()) sweepEvStation(station.id)
  // 설정 없이 예약만 있는 충전소도 스윕한다.
  const known = new Set(listEvStations().map((row) => row.id))
  for (const booking of bookingDb().bookings.values()) {
    if (!known.has(booking.stationId)) {
      ensureEvStation(booking.stationId, { name: booking.stationName })
      sweepEvStation(booking.stationId)
    }
  }
}

// ── 예약 생성·취소 ────────────────────────────────────────────────────

function clip(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function createEvBooking(input: {
  userId: string
  userUid?: string
  stationId: string
  stationName?: string
  startAt?: string
  durationMin?: number
  powerKw?: number
  providerName?: string
}) {
  syncEvBookings()
  const userId = clip(input.userId, 80)
  if (!userId) return { ok: false as const, error: 'user_required', booking: null }
  const stationId = clip(input.stationId, 80)
  if (!stationId) return { ok: false as const, error: 'station_required', booking: null }
  const station = ensureEvStation(stationId, {
    name: clip(input.stationName, 80) || stationId,
    powerKw: typeof input.powerKw === 'number' && Number.isFinite(input.powerKw) ? input.powerKw : undefined,
    providerName: clip(input.providerName, 60) || undefined,
  })
  sweepEvStation(stationId)

  // 이용자당 활성 예약은 하나 — 재요청은 기존 건을 돌려준다(멱등).
  const open = openBookingForUser(userId) || (input.userUid ? openBookingForUser(clip(input.userUid, 80)) : null)
  if (open) return { ok: true as const, booking: open, deduped: true as const }

  const now = Date.now()
  const duration = Math.round(Number(input.durationMin))
  const durationMin = Number.isFinite(duration)
    ? Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, duration))
    : DEFAULT_DURATION_MIN
  const requested = input.startAt ? Date.parse(input.startAt) : NaN
  const flexible = !Number.isFinite(requested) || requested <= now + 2 * 60_000
  const startMs = flexible ? now : requested
  if (!flexible && startMs > now + MAX_ADVANCE_MS) {
    return { ok: false as const, error: 'too_far', booking: null }
  }

  const booking: EvBooking = {
    id: crypto.randomUUID(),
    userId,
    userUid: clip(input.userUid, 80) || undefined,
    stationId,
    stationName: station.name,
    startAt: new Date(startMs).toISOString(),
    durationMin,
    endAt: new Date(startMs + durationMin * 60_000).toISOString(),
    flexible,
    status: 'queued',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  const slots = Math.max(1, station.slots)
  if (flexible) {
    if (stationOccupancy(stationId, now, now + durationMin * 60_000) < slots) {
      booking.status = 'notified'
      booking.notifiedAt = nowIso()
      booking.checkInBy = new Date(now + NOTIFY_WINDOW_MS).toISOString()
    }
  } else if (stationOccupancy(stationId, startMs, startMs + durationMin * 60_000, booking.id) < slots) {
    booking.status = 'reserved'
    booking.checkInBy = new Date(startMs + CHECKIN_GRACE_MS).toISOString()
  }
  saveBooking(booking)
  if (booking.status === 'notified') notifyTurn(booking, 'turn')
  if (booking.status === 'queued') sweepEvStation(stationId)
  return { ok: true as const, booking }
}

export function cancelEvBooking(id: string, actor: { userId?: string; admin?: string }) {
  syncEvBookings()
  const booking = getEvBooking(id)
  if (!booking) return { ok: false as const, error: 'not_found', booking: null }
  if (!actor.admin) {
    const uid = (actor.userId || '').trim()
    if (!uid || (booking.userId !== uid && booking.userUid !== uid)) {
      return { ok: false as const, error: 'forbidden', booking: null }
    }
  }
  if (!OPEN_STATUS.has(booking.status)) return { ok: true as const, booking, duplicate: true as const }
  booking.status = 'cancelled'
  saveBooking(booking)
  sweepEvStation(booking.stationId)
  return { ok: true as const, booking }
}

// ── 충전 세션 연동 훅 ─────────────────────────────────────────────────

/**
 * 세션 생성 전 슬롯 게이트 — 슬롯이 비면 누구나 즉시 이용(예약 불필요),
 * 차 있으면 차례가 온 예약자(notified)만 통과시킨다. 예약 없는 이용자는
 * 'station_busy'로 거절해 대기열 도약을 막는다.
 */
export function evSessionGate(chargerId: string, userId: string) {
  syncEvBookings()
  const station = ensureEvStation(chargerId)
  sweepEvStation(chargerId)
  const now = Date.now()
  const mine = listEvBookings({ stationId: chargerId, openOnly: true }).find(
    (row) => row.status === 'notified' && (row.userId === userId || row.userUid === userId),
  )
  if (mine) return { allow: true as const, booking: mine }
  const occupied = stationOccupancy(chargerId, now, now + 60_000)
  if (occupied < Math.max(1, station.slots)) return { allow: true as const, booking: null }
  return { allow: false as const, error: 'station_busy' as const, queueDepth: stationQueueDepth(chargerId) }
}

/** 세션 생성 시 예약 연결 — 체크인 대기(notified) 건만 허용한다. */
export function linkEvSessionToBooking(session: { id: string; userId: string; chargerId: string }, bookingId: string, userId: string) {
  syncEvBookings()
  const booking = getEvBooking(bookingId)
  if (!booking || booking.userId !== userId && booking.userUid !== userId) return null
  if (booking.stationId !== session.chargerId) return null
  if (booking.status !== 'notified') return null
  booking.sessionId = session.id
  saveBooking(booking)
  return booking
}

/** 예치금 잠금 완료 — 예약을 'active'(이용 중)로 전환한다. */
export function onEvSessionLocked(session: { id: string; bookingId?: string }) {
  if (!session.bookingId) return
  syncEvBookings()
  const booking = getEvBooking(session.bookingId)
  if (!booking || booking.status === 'active') return
  if (!OPEN_STATUS.has(booking.status)) return
  booking.status = 'active'
  booking.checkedInAt = nowIso()
  saveBooking(booking)
}

/** 세션 종료(정산·환불·취소) — 예약을 마감하고 대기열을 승격한다. */
export function onEvSessionEnded(session: { id: string; chargerId: string; bookingId?: string; status: string }) {
  if (!session.bookingId) return
  syncEvBookings()
  const booking = getEvBooking(session.bookingId)
  if (booking) {
    if (session.status === 'settled' || session.status === 'refunded') {
      if (booking.status === 'active') {
        booking.status = 'fulfilled'
        saveBooking(booking)
      }
    } else if (session.status === 'cancelled') {
      // 잠금 전 취소 — 체크인 기한이 남아 있으면 예약을 유지해 재시도를 허용한다.
      const deadline = Date.parse(booking.checkInBy || '')
      if (booking.status === 'notified' && Number.isFinite(deadline) && Date.now() <= deadline) {
        booking.sessionId = undefined
        saveBooking(booking)
      } else if (OPEN_STATUS.has(booking.status)) {
        booking.status = 'expired'
        saveBooking(booking)
      }
    }
    sweepEvStation(session.chargerId)
  }
}

// ── 관리자 모니터링 ──────────────────────────────────────────────────

export type EvStationLoad = {
  station: EvStation
  occupiedNow: number
  queueDepth: number
  /** 현재 충전 중인 슬롯의 합산 출력(kW) — 세션/충전소 출력 추정 기반. */
  chargingKw: number
  reservedNext24h: number
  today: { created: number; fulfilled: number; expired: number; cancelled: number }
}

export function adminEvOverview() {
  syncEvBookings()
  sweepAllEvStations()
  const now = Date.now()
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const dayMs = dayStart.getTime()
  const stationIds = new Set<string>(listEvStations().map((row) => row.id))
  for (const booking of bookingDb().bookings.values()) stationIds.add(booking.stationId)
  for (const session of listEvSessions()) {
    if (session.status === 'charging') stationIds.add(session.chargerId)
  }
  const stations: EvStationLoad[] = [...stationIds].map((id) => {
    const station = ensureEvStation(id)
    let chargingKw = 0
    const active = listEvBookings({ stationId: id, openOnly: true })
    for (const booking of active) {
      if (booking.status === 'active') {
        const session = booking.sessionId ? getEvSession(booking.sessionId) : null
        chargingKw += session?.powerKw || station.powerKw || 0
      }
    }
    for (const session of listEvSessions()) {
      if (session.chargerId === id && session.status === 'charging' && !session.bookingId) {
        chargingKw += session.powerKw || station.powerKw || 0
      }
    }
    const today = { created: 0, fulfilled: 0, expired: 0, cancelled: 0 }
    let reservedNext24h = 0
    for (const booking of bookingDb().bookings.values()) {
      if (booking.stationId !== id) continue
      if (Date.parse(booking.createdAt) >= dayMs) today.created += 1
      if (booking.status === 'reserved' && Date.parse(booking.startAt) <= now + 24 * 3_600_000) reservedNext24h += 1
      if (booking.status === 'fulfilled' && Date.parse(booking.updatedAt) >= dayMs) today.fulfilled += 1
      if (booking.status === 'expired' && Date.parse(booking.updatedAt) >= dayMs) today.expired += 1
      if (booking.status === 'cancelled' && Date.parse(booking.updatedAt) >= dayMs) today.cancelled += 1
    }
    return {
      station,
      occupiedNow: stationOccupancy(id, now, now + 60_000),
      queueDepth: stationQueueDepth(id),
      chargingKw: Math.round(chargingKw * 10) / 10,
      reservedNext24h,
      today,
    }
  })
  stations.sort((a, b) => b.occupiedNow + b.queueDepth - (a.occupiedNow + a.queueDepth) || a.station.name.localeCompare(b.station.name))
  return {
    stations,
    bookings: listEvBookings().slice(0, 200),
  }
}
