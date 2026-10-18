import { piRound } from '@/lib/pi-format'
import { dataNetwork } from '@/lib/kv'
import { listSettlements } from '@/lib/settlement-store'
import { listRides, syncDispatchFromDisk } from '@/lib/dispatch-store'
import { listAllDeliveries } from '@/lib/delivery-dispatch'
import { hydrateEvChargeFromKv, listEvSessions, syncEvChargeFromDisk } from '@/lib/ev-charge-store'

/**
 * 파트너 수익 분석·인사이트 집계 — 완료 운행(택시·대리), 배송, EV 충전
 * 정산 건을 일/주/월 단위와 시간대·지역 축으로 집계한다.
 *
 * 수익은 정산 장부(SettlementEntry.net, 수수료 공제 후 실수령)를 기준으로
 * 하고, 운행 시간·지역 통계는 라이드/택배/충전 세션 레코드에서 뽑는다.
 * 모든 소스가 네트워크 스코프 장부라 테스트넷/메인넷이 섞이지 않는다.
 * 시간 버킷은 전부 KST(+09:00) 기준이다.
 */

export type InsightBucket = { label: string; jobs: number; netPi: number }
export type InsightHour = { hour: number; jobs: number; netPi: number }
export type InsightRegion = { label: string; jobs: number; netPi: number }

export type PartnerInsights = {
  network: 'testnet' | 'mainnet'
  days: number
  totals: {
    jobs: number
    /** 수수료 공제 후 실수령 합계(Pi). */
    netPi: number
    grossPi: number
    commissionPi: number
    avgPi: number
    /** 완료 운행·배송·충전 누적 소요 시간(분). */
    minutes: number
    /** EV 충전 파트너의 정산 충전량(kWh). */
    kwh: number
  }
  byService: { service: string; label: string; jobs: number; netPi: number; minutes: number }[]
  /** 최근 days일 일별 집계 — 오래된 날짜 순. */
  daily: InsightBucket[]
  /** ISO 주(월요일 시작)별 집계 — 'MM/DD 주' 라벨. */
  byWeek: InsightBucket[]
  /** 월(YYYY-MM)별 집계 — 최대 24개월. */
  byMonth: InsightBucket[]
  /** 시간대(0~23시)별 완료 건·수익 — 피크 타임 분석용. */
  hourly: InsightHour[]
  /** 요일(0=일)별 완료 건 — 요일 패턴 분석용. */
  dow: { dow: number; jobs: number; netPi: number }[]
  /** 내 완료 건의 픽업 지역 상위 8곳 — 동선 계획용. */
  regions: InsightRegion[]
  /** 플랫폼 전체 수요 — 콜이 몰리는 시간대·지역(익명 집계). */
  demand: {
    hourly: { hour: number; jobs: number }[]
    regions: InsightRegion[]
  }
}

const SERVICE_LABEL: Record<string, string> = {
  taxi: '택시',
  daeri: '대리운전',
  delivery: '택배',
  ev: 'EV 충전',
  bicycle: '자전거',
  kickboard: '킥보드',
  parking: '주차',
}

/** KST(+9h) 기준 날짜·시간·요일 버킷. */
function kstParts(iso: string) {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms + 9 * 3_600_000)
  return {
    day: d.toISOString().slice(0, 10),
    hour: d.getUTCHours(),
    dow: d.getUTCDay(),
  }
}

/** 한국 주소에서 구/동 수준 지역 라벨을 뽑는다 — '부산 해운대구 우동' → '해운대구 우동'. */
function regionLabel(address: string | null | undefined) {
  const tokens = (address || '').split(/[\s,]+/).filter(Boolean)
  if (!tokens.length) return ''
  if (tokens.length >= 3) return `${tokens[1]} ${tokens[2]}`
  if (tokens.length === 2) return tokens[1]
  return tokens[0]
}

/** 완료 시각까지의 소요 시간(분) — 비정상 구간(3시간 초과·음수)은 제외한다. */
function durationMin(fromIso: string | null | undefined, toIso: string | null | undefined) {
  const from = Date.parse(fromIso || '')
  const to = Date.parse(toIso || '')
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  const min = Math.round((to - from) / 60_000)
  return min > 0 && min <= 180 ? min : 0
}

export async function partnerInsights(driverId: string, aliasIds: string[] = [], days = 30): Promise<PartnerInsights> {
  syncDispatchFromDisk()
  syncEvChargeFromDisk()
  await hydrateEvChargeFromKv().catch(() => undefined)
  const ids = [driverId, ...aliasIds].filter((id, index, list) => Boolean(id) && list.indexOf(id) === index)
  const rangeDays = Math.min(90, Math.max(7, Math.round(days) || 30))
  const cutoff = Date.now() - rangeDays * 86_400_000
  const inRange = (iso: string | null | undefined) => {
    const ms = Date.parse(iso || '')
    return Number.isFinite(ms) && ms >= cutoff
  }

  const settlements = await listSettlements().catch(() => [])
  const rides = listRides()
  const deliveries = await listAllDeliveries().catch(() => [])
  const evSessions = listEvSessions()

  const mine = (id: string | null | undefined) => Boolean(id && ids.includes(id))

  // 정산 장부 — 수익의 확정 소스(수수료 공제 후 net).
  const mySettlements = settlements.filter((entry) => mine(entry.driverId) && inRange(entry.createdAt))

  // 시간·지역 지표용 완료 건 — 라이드/택배/충전 세션.
  type Job = { at: string; minutes: number; region: string; service: string }
  const jobs: Job[] = []
  for (const ride of rides) {
    if (!mine(ride.assignedDriverId) || ride.status !== 'completed' || !inRange(ride.updatedAt)) continue
    jobs.push({
      at: ride.updatedAt,
      minutes: durationMin(ride.boardedAt || ride.createdAt, ride.updatedAt),
      region: regionLabel(ride.pickup?.address || ride.pickup?.label),
      service: ride.kind === 'daeri' ? 'daeri' : 'taxi',
    })
  }
  for (const job of deliveries) {
    if (!mine(job.driverId) || job.status !== 'completed' || !inRange(job.updatedAt)) continue
    jobs.push({
      at: job.updatedAt,
      minutes: durationMin(job.createdAt, job.updatedAt),
      region: regionLabel(job.pickupAddress),
      service: 'delivery',
    })
  }
  let kwh = 0
  for (const session of evSessions) {
    if (!mine(session.providerId) || session.status !== 'settled' || !inRange(session.settledAt)) continue
    kwh += session.finalKwh ?? 0
    jobs.push({
      at: session.settledAt || session.updatedAt,
      minutes: durationMin(session.startedAt || session.heldAt, session.endedAt || session.settledAt),
      region: '',
      service: 'ev',
    })
  }

  // 정산 금액 집계 — 서비스별.
  const byServiceMap = new Map<string, { jobs: number; netPi: number; minutes: number }>()
  let netPi = 0
  let grossPi = 0
  let commissionPi = 0
  for (const entry of mySettlements) {
    netPi += entry.net
    grossPi += entry.gross
    commissionPi += entry.commission
    const row = byServiceMap.get(entry.service) ?? { jobs: 0, netPi: 0, minutes: 0 }
    row.jobs += 1
    row.netPi = piRound(row.netPi + entry.net)
    byServiceMap.set(entry.service, row)
  }
  // 서비스별 소요 시간은 완료 건 레코드에서 합산한다(정산 건과 1:1이 아닐 수 있음).
  let minutes = 0
  for (const job of jobs) {
    minutes += job.minutes
    const row = byServiceMap.get(job.service) ?? { jobs: 0, netPi: 0, minutes: 0 }
    row.minutes += job.minutes
    byServiceMap.set(job.service, row)
  }

  // 일별 버킷 — 수익은 정산일 기준, 건수는 완료일 기준으로 함께 채운다.
  const dayMap = new Map<string, InsightBucket>()
  for (let i = rangeDays - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() + 9 * 3_600_000 - i * 86_400_000)
    const label = d.toISOString().slice(0, 10)
    dayMap.set(label, { label, jobs: 0, netPi: 0 })
  }
  const bump = (map: Map<string, InsightBucket>, iso: string, net: number) => {
    const parts = kstParts(iso)
    if (!parts) return
    const bucket = map.get(parts.day)
    if (!bucket) return
    bucket.jobs += 1
    bucket.netPi = piRound(bucket.netPi + net)
  }
  for (const entry of mySettlements) bump(dayMap, entry.createdAt, entry.net)

  /** KST 기준 ISO 주 시작(월요일) — 'MM/DD~' 라벨 키로 쓴다. */
  const weekKey = (iso: string) => {
    const parts = kstParts(iso)
    if (!parts) return ''
    const day = new Date(`${parts.day}T00:00:00Z`)
    const shift = (parts.dow + 6) % 7 // 월요일 시작
    day.setUTCDate(day.getUTCDate() - shift)
    return `${day.toISOString().slice(5, 10)}~`
  }
  const weekMap = new Map<string, InsightBucket>()
  const monthMap = new Map<string, InsightBucket>()
  const bumpKeyed = (map: Map<string, InsightBucket>, key: string, net: number) => {
    if (!key) return
    const bucket = map.get(key) ?? { label: key, jobs: 0, netPi: 0 }
    bucket.jobs += 1
    bucket.netPi = piRound(bucket.netPi + net)
    map.set(key, bucket)
  }

  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, jobs: 0, netPi: 0 }))
  const dow = Array.from({ length: 7 }, (_, d) => ({ dow: d, jobs: 0, netPi: 0 }))
  for (const entry of mySettlements) {
    const parts = kstParts(entry.createdAt)
    if (!parts) continue
    hourly[parts.hour].jobs += 1
    hourly[parts.hour].netPi = piRound(hourly[parts.hour].netPi + entry.net)
    dow[parts.dow].jobs += 1
    dow[parts.dow].netPi = piRound(dow[parts.dow].netPi + entry.net)
    bumpKeyed(weekMap, weekKey(entry.createdAt), entry.net)
    bumpKeyed(monthMap, parts.day.slice(0, 7), entry.net)
  }

  const regionMap = new Map<string, { jobs: number; netPi: number }>()
  for (const job of jobs) {
    if (!job.region) continue
    const row = regionMap.get(job.region) ?? { jobs: 0, netPi: 0 }
    row.jobs += 1
    regionMap.set(job.region, row)
  }
  const regions = [...regionMap.entries()]
    .map(([label, row]) => ({ label, jobs: row.jobs, netPi: piRound(row.netPi) }))
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, 8)

  // 플랫폼 전체 수요 — 호출 시점(createdAt) 기준의 익명 집계.
  const demandHourly = Array.from({ length: 24 }, (_, hour) => ({ hour, jobs: 0 }))
  const demandRegion = new Map<string, { jobs: number; netPi: number }>()
  const noteDemand = (iso: string, region: string) => {
    const parts = kstParts(iso)
    if (!parts) return
    demandHourly[parts.hour].jobs += 1
    if (region) {
      const row = demandRegion.get(region) ?? { jobs: 0, netPi: 0 }
      row.jobs += 1
      demandRegion.set(region, row)
    }
  }
  for (const ride of rides) {
    if (!inRange(ride.createdAt) || ride.status === 'unmatched') continue
    noteDemand(ride.createdAt, regionLabel(ride.pickup?.address || ride.pickup?.label))
  }
  for (const job of deliveries) {
    if (!inRange(job.createdAt) || job.status === 'expired') continue
    noteDemand(job.createdAt, regionLabel(job.pickupAddress))
  }

  const jobCount = mySettlements.length
  return {
    network: dataNetwork(),
    days: rangeDays,
    totals: {
      jobs: jobCount,
      netPi: piRound(netPi),
      grossPi: piRound(grossPi),
      commissionPi: piRound(commissionPi),
      avgPi: jobCount ? piRound(netPi / jobCount) : 0,
      minutes,
      kwh: Math.round(kwh * 100) / 100,
    },
    byService: [...byServiceMap.entries()]
      .map(([service, row]) => ({ service, label: SERVICE_LABEL[service] ?? service, jobs: row.jobs, netPi: row.netPi, minutes: row.minutes }))
      .sort((a, b) => b.netPi - a.netPi),
    daily: [...dayMap.values()],
    byWeek: [...weekMap.values()].slice(-12),
    byMonth: [...monthMap.values()].slice(-24),
    hourly,
    dow,
    regions,
    demand: {
      hourly: demandHourly,
      regions: [...demandRegion.entries()]
        .map(([label, row]) => ({ label, jobs: row.jobs, netPi: piRound(row.netPi) }))
        .sort((a, b) => b.jobs - a.jobs)
        .slice(0, 8),
    },
  }
}
