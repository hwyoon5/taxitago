// 기사 기피 지역 통계 — 목적지 격자(약 5km 셀)별로 콜 제안/수락/거절/타임아웃/미배차
// 횟수를 누적하고, 거절·타임아웃·미배차 비율이 높은 구역을 '기피 지역'으로 수치화한다.
// 서버리스 인스턴스 간 공유는 Upstash/Vercel KV 해시 카운터(HINCRBY)로 원자적 누적하고,
// 로컬 개발은 data/avoid-zones.json 파일로 폴백한다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import type { GeoPoint } from '@/lib/dispatch-types'
import { piRound } from '@/lib/pi-format'

export type AvoidOutcome = 'offer' | 'accept' | 'reject' | 'timeout' | 'unmatched'

export type ZoneCounters = {
  offers: number
  accepts: number
  rejects: number
  timeouts: number
  unmatched: number
}

type ZoneMeta = {
  label: string
  since: string
  lastAt: string
}

type ZoneRow = ZoneCounters & ZoneMeta

export type AvoidZoneScore = ZoneCounters & {
  key: string
  label: string
  /** 기사 회피 비율(0~1) — 거절+타임아웃 ÷ 응답(수락+거절+타임아웃). */
  rate: number
  /** 의사결정 표본 수(수락+거절+타임아웃). */
  samples: number
  avoided: boolean
  reason: 'rate' | 'unmatched' | null
}

// 기피 판정 기준 — 응답 표본이 충분하고 절반 이상이 거절/타임아웃이거나,
// 미배차가 반복적으로 쌓인 구역을 기피 지역으로 본다.
const MIN_DECISIONS = 4
const AVOID_RATE = 0.5
const UNMATCHED_HEAVY = 2

// 기피 할증 — 회피 비율 0.5일 때 약 20%, 1.0일 때 30% (min/cap 클램프).
export const AVOID_SURCHARGE_BASE_RATE = 0.1
export const AVOID_SURCHARGE_SCALE_RATE = 0.2
export const AVOID_SURCHARGE_MIN_PI = 0.02
export const AVOID_SURCHARGE_MAX_PI = 0.8

const ZONE_STEP = 0.05 // 위·경도 0.05° ≈ 5km 격자
const persistFile = path.join(process.cwd(), 'data', 'avoid-zones.json')
const countsHashKey = 'taxitago:avoid:counts'
const metaHashKey = 'taxitago:avoid:meta'

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

type Store = { zones: Map<string, ZoneRow>; hydrated: boolean }

function store(): Store {
  const g = globalThis as typeof globalThis & { __taxitagoAvoidZones?: Store }
  if (!g.__taxitagoAvoidZones) {
    g.__taxitagoAvoidZones = { zones: new Map(), hydrated: false }
    hydrateFromDisk(g.__taxitagoAvoidZones)
  }
  return g.__taxitagoAvoidZones
}

export function zoneKeyFor(dest: Pick<GeoPoint, 'lat' | 'lng' | 'address' | 'label'> | null | undefined) {
  if (!dest || !Number.isFinite(dest.lat) || !Number.isFinite(dest.lng)) return ''
  const latCell = Math.round(dest.lat / ZONE_STEP) * ZONE_STEP
  const lngCell = Math.round(dest.lng / ZONE_STEP) * ZONE_STEP
  return `${latCell.toFixed(2)}:${lngCell.toFixed(2)}`
}

function zoneLabel(dest: Pick<GeoPoint, 'address' | 'label'>) {
  const text = (dest.label || dest.address || '').trim()
  const parts = text.split(/\s+/).filter(Boolean)
  return parts.slice(0, 3).join(' ') || '목적지'
}

const emptyCounters = (): ZoneCounters => ({ offers: 0, accepts: 0, rejects: 0, timeouts: 0, unmatched: 0 })

const COUNTER_FIELDS: Record<AvoidOutcome, keyof ZoneCounters> = {
  offer: 'offers',
  accept: 'accepts',
  reject: 'rejects',
  timeout: 'timeouts',
  unmatched: 'unmatched',
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

function hydrateFromDisk(target: Store) {
  target.hydrated = true
  try {
    if (!existsSync(persistFile)) return
    const parsed = JSON.parse(readFileSync(persistFile, 'utf8')) as { zones?: [string, ZoneRow][] }
    for (const [key, row] of parsed.zones ?? []) {
      target.zones.set(key, { ...emptyCounters(), ...row })
    }
  } catch {
    undefined
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
function scheduleDiskPersist() {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      mkdirSync(path.dirname(persistFile), { recursive: true })
      const payload = { zones: [...store().zones.entries()] }
      writeFileSync(persistFile, JSON.stringify(payload), 'utf8')
    } catch {
      // Vercel read-only filesystem — KV가 진실의 원천이므로 파일 실패는 무시한다.
      undefined
    }
  }, 400)
}

/** 최신 카운터를 KV에서 합쳐 온다 — 인스턴스 간 누락 없이 최대값 병합. */
export async function hydrateAvoidFromKv() {
  if (!useKv) return
  try {
    const [counts, meta] = await Promise.all([
      kvCommand<string[]>(['HGETALL', countsHashKey]),
      kvCommand<string[]>(['HGETALL', metaHashKey]),
    ])
    const local = store()
    if (Array.isArray(counts)) {
      for (let i = 0; i + 1 < counts.length; i += 2) {
        const sep = counts[i].lastIndexOf('|')
        if (sep <= 0) continue
        const key = counts[i].slice(0, sep)
        const field = counts[i].slice(sep + 1) as keyof ZoneCounters
        const value = Number(counts[i + 1]) || 0
        const row = local.zones.get(key) ?? { ...emptyCounters(), label: '', since: '', lastAt: '' }
        if (field in row && typeof row[field] === 'number' && value > (row[field] as number)) {
          row[field] = value
        }
        local.zones.set(key, row)
      }
    }
    if (Array.isArray(meta)) {
      for (let i = 0; i + 1 < meta.length; i += 2) {
        try {
          const parsed = JSON.parse(meta[i + 1]) as Partial<ZoneMeta>
          const row = local.zones.get(meta[i])
          if (!row) continue
          if (parsed.label) row.label = parsed.label
          if (parsed.since && (!row.since || parsed.since < row.since)) row.since = parsed.since
          if (parsed.lastAt && parsed.lastAt > row.lastAt) row.lastAt = parsed.lastAt
        } catch {
          undefined
        }
      }
    }
  } catch {
    undefined
  }
}

/** 콜 결과를 목적지 격자 카운터에 누적한다 — 동기 로컬 반영 + 비동기 KV 원자 증가. */
export function recordZoneOutcome(
  dest: Pick<GeoPoint, 'lat' | 'lng' | 'address' | 'label'> | null | undefined,
  outcome: AvoidOutcome,
) {
  const key = zoneKeyFor(dest)
  if (!key) return
  const now = new Date().toISOString()
  const local = store()
  const row = local.zones.get(key) ?? { ...emptyCounters(), label: zoneLabel(dest ?? {}), since: now, lastAt: now }
  row[COUNTER_FIELDS[outcome]] += 1
  if (!row.label) row.label = zoneLabel(dest ?? {})
  if (!row.since) row.since = now
  row.lastAt = now
  local.zones.set(key, row)
  scheduleDiskPersist()
  if (!useKv) return
  void Promise.all([
    kvCommand(['HINCRBY', countsHashKey, `${key}|${COUNTER_FIELDS[outcome]}`, 1]),
    kvCommand(['HSET', metaHashKey, key, JSON.stringify({ label: row.label, since: row.since, lastAt: row.lastAt } satisfies ZoneMeta)]),
  ]).catch(() => undefined)
}

/** 목적지 격자의 기피 점수 — 표본이 충분하고 회피율이 높으면 avoided=true. */
export function avoidZoneScore(dest: Pick<GeoPoint, 'lat' | 'lng' | 'address' | 'label'> | null | undefined): AvoidZoneScore | null {
  const key = zoneKeyFor(dest)
  if (!key) return null
  const row = store().zones.get(key)
  if (!row) return null
  const samples = row.accepts + row.rejects + row.timeouts
  const avoidedCount = row.rejects + row.timeouts
  const rate = samples > 0 ? avoidedCount / samples : 0
  const rateAvoided = samples >= MIN_DECISIONS && rate >= AVOID_RATE
  const unmatchedAvoided = row.unmatched >= UNMATCHED_HEAVY && row.unmatched > row.accepts
  return {
    key,
    label: row.label,
    offers: row.offers,
    accepts: row.accepts,
    rejects: row.rejects,
    timeouts: row.timeouts,
    unmatched: row.unmatched,
    rate: Math.round(rate * 1000) / 1000,
    samples,
    avoided: rateAvoided || unmatchedAvoided,
    reason: rateAvoided ? 'rate' : unmatchedAvoided ? 'unmatched' : null,
  }
}

/** 기피 지역 할증액(Pi) — 기본 10% + 회피율×20%, min/max 클램프. */
export function avoidSurchargePi(farePi: number, rate: number) {
  if (!(farePi > 0)) return 0
  const raw = farePi * (AVOID_SURCHARGE_BASE_RATE + AVOID_SURCHARGE_SCALE_RATE * Math.max(0, Math.min(1, rate)))
  return piRound(Math.min(AVOID_SURCHARGE_MAX_PI, Math.max(AVOID_SURCHARGE_MIN_PI, raw)))
}

/** 관리자/진단용 — 누적된 구역 점수 전체를 회피율 내림차순으로 반환한다. */
export function listAvoidZones(): AvoidZoneScore[] {
  return [...store().zones.entries()]
    .map(([key, row]) => {
      const samples = row.accepts + row.rejects + row.timeouts
      const rate = samples > 0 ? (row.rejects + row.timeouts) / samples : 0
      const rateAvoided = samples >= MIN_DECISIONS && rate >= AVOID_RATE
      const unmatchedAvoided = row.unmatched >= UNMATCHED_HEAVY && row.unmatched > row.accepts
      return {
        key,
        label: row.label,
        offers: row.offers,
        accepts: row.accepts,
        rejects: row.rejects,
        timeouts: row.timeouts,
        unmatched: row.unmatched,
        rate: Math.round(rate * 1000) / 1000,
        samples,
        avoided: rateAvoided || unmatchedAvoided,
        reason: (rateAvoided ? 'rate' : unmatchedAvoided ? 'unmatched' : null) as AvoidZoneScore['reason'],
      }
    })
    .sort((a, b) => b.rate - a.rate || b.samples - a.samples)
}
