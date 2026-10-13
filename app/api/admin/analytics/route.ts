import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { hydrateDispatchFromKv, listRides, syncDispatchFromDisk } from '@/lib/dispatch-store'
import { listSettlements } from '@/lib/settlement-store'
import { listRegistryUsers } from '@/lib/user-registry'
import { piRound } from '@/lib/pi-format'
import type { SettlementService } from '@/lib/settlement-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type BucketKind = 'hour' | 'day' | 'week' | 'month'

export type AnalyticsBucket = {
  /** 버킷 시작 시각(ISO) */
  at: string
  label: string
  calls: number
  matched: number
  cancelled: number
  unmatched: number
  gmv: number
  commission: number
  newUsers: number
}

const SERVICE_LIST: SettlementService[] = ['taxi', 'daeri', 'delivery', 'bicycle', 'kickboard', 'ev', 'parking']

function bucketKindFor(days: number, bucketParam: string): BucketKind {
  if (bucketParam === 'day' || bucketParam === 'week' || bucketParam === 'month' || bucketParam === 'hour') return bucketParam
  if (days <= 2) return 'hour'
  if (days <= 62) return 'day'
  if (days <= 240) return 'week'
  return 'month'
}

/** 로컬(KST) 기준 버킷 키 — 서버 TZ와 무관하게 Asia/Seoul 달력으로 묶는다. */
const seoul = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
function seoulParts(iso: string): { y: number; m: number; d: number; h: number } | null {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  const parts = Object.fromEntries(seoul.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]))
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour === '24' ? 0 : parts.hour) }
}

function bucketKey(iso: string, kind: BucketKind): { key: string; label: string } | null {
  const p = seoulParts(iso)
  if (!p) return null
  const mm = String(p.m).padStart(2, '0')
  const dd = String(p.d).padStart(2, '0')
  if (kind === 'hour') return { key: `${p.y}-${mm}-${dd}T${String(p.h).padStart(2, '0')}`, label: `${p.h}시` }
  if (kind === 'day') return { key: `${p.y}-${mm}-${dd}`, label: `${p.m}/${p.d}` }
  if (kind === 'month') return { key: `${p.y}-${mm}`, label: `${p.y}.${p.m}` }
  // week — KST 월요일 시작 주 키.
  const utcDay = Date.UTC(p.y, p.m - 1, p.d)
  const dow = (new Date(utcDay).getUTCDay() + 6) % 7 // Mon=0
  const monday = new Date(utcDay - dow * 86_400_000)
  const key = monday.toISOString().slice(0, 10)
  return { key: `W:${key}`, label: `${monday.getUTCMonth() + 1}/${monday.getUTCDate()}~` }
}

export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(request.url)
  const days = Math.min(370, Math.max(1, Math.floor(Number(url.searchParams.get('days')) || 7)))
  const kind = bucketKindFor(days, (url.searchParams.get('bucket') || 'auto').toLowerCase())

  await hydrateDispatchFromKv().catch(() => undefined)
  syncDispatchFromDisk()
  const [rides, settlements, users] = await Promise.all([Promise.resolve(listRides()), listSettlements(), listRegistryUsers()])

  // 기간 경계 — KST 자정 기준 N일 전부터 지금까지.
  const nowParts = seoulParts(new Date().toISOString())!
  const endUtc = Date.now()
  const fromLocalMidnightUtc = Date.UTC(nowParts.y, nowParts.m - 1, nowParts.d) - 9 * 3_600_000
  const fromUtc = fromLocalMidnightUtc - (days - 1) * 86_400_000
  const inRange = (iso?: string) => {
    if (!iso) return false
    const t = Date.parse(iso)
    return Number.isFinite(t) && t >= fromUtc && t <= endUtc
  }

  const rangeRides = rides.filter((r) => inRange(r.createdAt))
  const rangeSettlements = settlements.filter((s) => inRange(s.createdAt))
  const rangeUsers = users.filter((u) => inRange(u.linkedAt))

  const isMatched = (status: string) => status === 'assigned' || status === 'completed'
  const matched = rangeRides.filter((r) => isMatched(r.status)).length
  const gmv = piRound(rangeSettlements.reduce((sum, s) => sum + (Number.isFinite(s.gross) ? s.gross : 0), 0))
  const commission = piRound(rangeSettlements.reduce((sum, s) => sum + (Number.isFinite(s.commission) ? s.commission : 0), 0))
  const totals = {
    calls: rangeRides.length,
    matched,
    matchRate: rangeRides.length ? Math.round((matched / rangeRides.length) * 1000) / 10 : 0,
    cancelled: rangeRides.filter((r) => r.status === 'cancelled').length,
    unmatched: rangeRides.filter((r) => r.status === 'unmatched').length,
    inFlight: rangeRides.filter((r) => r.status === 'searching' || r.status === 'offered').length,
    gmv,
    commission,
    net: piRound(gmv - commission),
    settleCount: rangeSettlements.length,
    avgTicket: rangeSettlements.length ? piRound(gmv / rangeSettlements.length) : 0,
    newUsers: rangeUsers.length,
  }

  const bucketMap = new Map<string, AnalyticsBucket>()
  const bucketOf = (iso: string) => {
    const meta = bucketKey(iso, kind)
    if (!meta) return null
    let bucket = bucketMap.get(meta.key)
    if (!bucket) {
      bucket = { at: meta.key, label: meta.label, calls: 0, matched: 0, cancelled: 0, unmatched: 0, gmv: 0, commission: 0, newUsers: 0 }
      bucketMap.set(meta.key, bucket)
    }
    return bucket
  }
  for (const ride of rangeRides) {
    const bucket = bucketOf(ride.createdAt)
    if (!bucket) continue
    bucket.calls += 1
    if (isMatched(ride.status)) bucket.matched += 1
    if (ride.status === 'cancelled') bucket.cancelled += 1
    if (ride.status === 'unmatched') bucket.unmatched += 1
  }
  for (const entry of rangeSettlements) {
    const bucket = bucketOf(entry.createdAt)
    if (!bucket) continue
    bucket.gmv = piRound(bucket.gmv + (Number.isFinite(entry.gross) ? entry.gross : 0))
    bucket.commission = piRound(bucket.commission + (Number.isFinite(entry.commission) ? entry.commission : 0))
  }
  for (const user of rangeUsers) {
    const bucket = bucketOf(user.linkedAt)
    if (bucket) bucket.newUsers += 1
  }
  const series = [...bucketMap.values()].sort((a, b) => a.at.localeCompare(b.at))

  const byService = Object.fromEntries(
    SERVICE_LIST.map((service) => {
      const rows = rangeSettlements.filter((s) => s.service === service)
      return [service, { count: rows.length, gross: piRound(rows.reduce((sum, s) => sum + s.gross, 0)), commission: piRound(rows.reduce((sum, s) => sum + s.commission, 0)) }]
    }),
  )

  return NextResponse.json({
    ok: true,
    range: { days, bucket: kind, from: new Date(fromUtc).toISOString(), to: new Date(endUtc).toISOString() },
    totals,
    series,
    byService,
  })
}
