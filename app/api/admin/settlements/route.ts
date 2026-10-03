import { NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import {
  getCommissionRates,
  listSettlements,
  markAllSettlementsSettled,
  markSettlementSettled,
  saveCommissionRates,
  settlementStorageBackend,
  updateSettlementEntry,
} from '@/lib/settlement-store'
import { addEarning, flushEscrowPersist, hydrateEscrowFromKv, listEarnings } from '@/lib/escrow-store'
import { listAudit, recordAudit } from '@/lib/audit-store'
import { getRide, hydrateDispatchFromKv, syncDispatchFromDisk } from '@/lib/dispatch-store'
import { piRound } from '@/lib/pi-format'
import { getFareConfig, saveFareConfig } from '@/lib/fare-config-server'
import { getAdminWallet, saveAdminWallet } from '@/lib/admin-wallet'
import type { FareConfig } from '@/lib/fare-config'
import type { CommissionRates, SettlementEntry, SettlementService } from '@/lib/settlement-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SERVICES: SettlementService[] = ['taxi', 'daeri', 'delivery', 'bicycle', 'kickboard', 'ev', 'parking']
const SERVICE_LABEL: Record<SettlementService, string> = {
  taxi: '택시',
  daeri: '대리운전',
  delivery: '택배',
  bicycle: '자전거',
  kickboard: '킥보드',
  ev: 'EV충전',
  parking: '주차',
}

function summarize(entries: SettlementEntry[]) {
  const byService = Object.fromEntries(
    SERVICES.map((service) => [service, { label: SERVICE_LABEL[service], count: 0, gross: 0, commission: 0, net: 0 }]),
  ) as Record<SettlementService, { label: string; count: number; gross: number; commission: number; net: number }>
  let gross = 0
  let commission = 0
  let net = 0
  let pendingCount = 0
  let pendingNet = 0
  for (const entry of entries) {
    const bucket = byService[entry.service]
    if (bucket) {
      bucket.count += 1
      bucket.gross += entry.gross
      bucket.commission += entry.commission
      bucket.net += entry.net
    }
    gross += entry.gross
    commission += entry.commission
    net += entry.net
    if (entry.status === 'pending') {
      pendingCount += 1
      pendingNet += entry.net
    }
  }
  const round = (value: number) => piRound(value)
  for (const service of SERVICES) {
    byService[service].gross = round(byService[service].gross)
    byService[service].commission = round(byService[service].commission)
    byService[service].net = round(byService[service].net)
  }
  return {
    count: entries.length,
    gross: round(gross),
    commission: round(commission),
    net: round(net),
    pendingCount,
    pendingNet: round(pendingNet),
    byService,
  }
}

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const [rates, entries, audit, fare, adminWallet] = await Promise.all([getCommissionRates(), listSettlements(), listAudit(), getFareConfig(), getAdminWallet()])
  // Older ledger rows predate the passengerId column — resolve it from the
  // ride record so exports still show the passenger for every ride:* ref.
  await hydrateDispatchFromKv()
  syncDispatchFromDisk()
  const enriched = entries.map((entry) => {
    if (entry.passengerId) return entry
    const rideId = /^ride:([^:]+)/.exec(entry.refId)?.[1]
    const passengerId = rideId ? getRide(rideId)?.passengerId : undefined
    return passengerId ? { ...entry, passengerId } : entry
  })
  return NextResponse.json({ ok: true, rates, entries: enriched, summary: summarize(enriched), storage: settlementStorageBackend(), audit, fare, adminWallet })
}

export async function PATCH(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as {
    action?: unknown
    id?: unknown
    rates?: Record<string, unknown>
    gross?: unknown
    status?: unknown
    memo?: unknown
    driverId?: unknown
    driverName?: unknown
    reason?: unknown
    fare?: unknown
    wallet?: unknown
  } | null
  const action = body?.action
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

  if (action === 'wallet') {
    const before = await getAdminWallet()
    const adminWallet = await saveAdminWallet(body?.wallet)
    await recordAudit({ kind: 'wallet', actor: 'admin', reason, before: { address: before }, after: { address: adminWallet } }).catch(() => undefined)
    return NextResponse.json({ ok: true, adminWallet })
  }

  if (action === 'fare') {
    const before = await getFareConfig()
    const fare = await saveFareConfig((body?.fare ?? {}) as Partial<FareConfig>)
    await recordAudit({ kind: 'fare', actor: 'admin', reason, before, after: fare }).catch(() => undefined)
    return NextResponse.json({ ok: true, fare })
  }

  if (action === 'rates') {
    const next = {} as CommissionRates
    for (const service of SERVICES) {
      const raw = Number(body?.rates?.[service])
      next[service] = Number.isFinite(raw) ? Math.min(50, Math.max(0, Math.round(raw * 10) / 10)) : 0
    }
    const before = await getCommissionRates()
    const rates = await saveCommissionRates(next)
    await recordAudit({ kind: 'rates', actor: 'admin', reason, before, after: rates }).catch(() => undefined)
    return NextResponse.json({ ok: true, rates })
  }

  if (action === 'settle') {
    const id = typeof body?.id === 'string' ? body.id : ''
    const entry = await markSettlementSettled(id)
    if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await recordAudit({ kind: 'settle', actor: 'admin', entryId: entry.id, refId: entry.refId, reason, detail: `${entry.driverName || entry.driverId} · ${entry.gross}Pi`, after: { status: entry.status, settledAt: entry.settledAt } }).catch(() => undefined)
    return NextResponse.json({ ok: true, entry })
  }

  if (action === 'settle-all') {
    const count = await markAllSettlementsSettled()
    await recordAudit({ kind: 'settle-all', actor: 'admin', reason, detail: `${count}건 일괄 정산` }).catch(() => undefined)
    return NextResponse.json({ ok: true, count })
  }

  // Manual adjustment of a single ledger row — then push the corrected figures
  // into the driver earnings store so the driver dashboard matches the ledger.
  if (action === 'adjust') {
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    const before = (await listSettlements()).find((row) => row.id === id) ?? null
    const gross = body?.gross === undefined ? undefined : Number(body.gross)
    const status = body?.status === 'pending' || body?.status === 'settled' ? body.status : undefined
    const entry = await updateSettlementEntry(id, {
      gross,
      status,
      memo: typeof body?.memo === 'string' ? body.memo : undefined,
      driverId: typeof body?.driverId === 'string' ? body.driverId : undefined,
      driverName: typeof body?.driverName === 'string' ? body.driverName : undefined,
    })
    if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await hydrateEscrowFromKv()
    const synced = syncEntryToEarning(entry)
    if (synced) await flushEscrowPersist()
    await recordAudit({
      kind: 'adjust',
      actor: 'admin',
      entryId: entry.id,
      refId: entry.refId,
      reason,
      before: before ? { gross: before.gross, net: before.net, status: before.status, driverId: before.driverId, driverName: before.driverName, memo: before.memo } : null,
      after: { gross: entry.gross, net: entry.net, status: entry.status, driverId: entry.driverId, driverName: entry.driverName, memo: entry.memo },
      detail: synced ? '기사 수익 반영됨' : '기사 수익 변동 없음',
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, entry, synced })
  }

  // Force driver dashboards to agree with the admin ledger: materialize a
  // driver earnings row for every settlement entry that lacks one (or whose
  // amount drifted), then flush to shared storage.
  if (action === 'reconcile') {
    const onlyDriverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
    await hydrateEscrowFromKv()
    const entries = await listSettlements()
    let synced = 0
    for (const entry of entries) {
      if (onlyDriverId && entry.driverId !== onlyDriverId) continue
      if (syncEntryToEarning(entry)) synced += 1
    }
    if (synced) await flushEscrowPersist()
    await recordAudit({ kind: 'reconcile', actor: 'admin', reason, detail: onlyDriverId ? `${onlyDriverId} 기사 ${synced}건 동기화` : `전체 ${synced}건 동기화` }).catch(() => undefined)
    return NextResponse.json({ ok: true, synced })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

/** Upsert a driver earnings row matching a settlement entry. Returns true when it wrote. */
function syncEntryToEarning(entry: SettlementEntry): boolean {
  const ref = /^ride:([^:]+)(:cancel)?$/.exec(entry.refId)
  if (!ref) return false
  const rideId = ref[1]
  const status = ref[2] ? ('cancelled' as const) : ('completed' as const)
  const existing = listEarnings(entry.driverId).find((row) => row.rideId === rideId && row.status === status)
  if (existing && existing.amount === entry.gross) return false
  addEarning({
    id: crypto.randomUUID(),
    driverId: entry.driverId,
    rideId,
    amount: entry.gross,
    route: entry.memo || '정산 보정',
    status,
    at: entry.settledAt || entry.createdAt,
  })
  return true
}
