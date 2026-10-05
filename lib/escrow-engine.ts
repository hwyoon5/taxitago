import { getDriver, getRide, listRides, nowIso, saveDriver, syncDispatchFromDisk } from '@/lib/dispatch-store'
import { settleMidTripCancelFee } from '@/lib/ride-fare'
import { getFareConfig } from '@/lib/fare-config-server'
import { piRound } from '@/lib/pi-format'
import { getPartnerLink } from '@/lib/partner-ledger-server'
import { listSettlements, recordSettlement } from '@/lib/settlement-store'
import { isPiSandboxEnv } from '@/lib/pi-sandbox'
import { createA2UPayment } from '@/lib/pi-platform'
import {
  addEarning,
  getEscrowByRide,
  getReceipt,
  listEarnings,
  saveEscrow,
  saveReceipt,
  syncEscrowFromDisk,
} from '@/lib/escrow-store'
import type { DriverEarning, DriverEarningsStats, EarningsPeriodRow, EscrowRecord, PublicEscrow, SettlementReceipt } from '@/lib/escrow-types'

function stamp(record: EscrowRecord) {
  record.updatedAt = nowIso()
  return saveEscrow(record)
}

export function toPublicEscrow(record: EscrowRecord | null): PublicEscrow | null {
  if (!record) return null
  return {
    status: record.status,
    amount: record.amount,
    lockTxid: record.lockTxid,
    payoutTxid: record.payoutTxid,
    payoutWallet: record.payoutWallet,
  }
}

function waypointLabels(ride: NonNullable<ReturnType<typeof getRide>>) {
  return (ride.waypoints ?? []).map((point) => point.label || point.address || '경유지').filter(Boolean)
}

function routeLabel(ride: NonNullable<ReturnType<typeof getRide>>) {
  const origin = ride.pickup.address || ride.pickup.label || '출발지'
  const dest = ride.dest.label || ride.dest.address || '목적지'
  return [origin, ...waypointLabels(ride), dest].join(' → ')
}

export function driverPayoutTarget(driverId: string) {
  const linked = getPartnerLink(driverId)
  const driver = getDriver(driverId)
  return {
    wallet: linked?.wallet || driver?.wallet || `GBPI-${driverId.slice(0, 8).toUpperCase()}-WALLET`,
    uid: linked?.uid || driver?.piUid || driverId,
    name: linked?.name || driver?.name || '기사',
  }
}

export function openEscrowForRide(rideId: string) {
  const ride = getRide(rideId)
  if (!ride?.assignedDriverId) return null
  const existing = getEscrowByRide(rideId)
  if (existing) return existing
  const createdAt = nowIso()
  return saveEscrow({
    id: crypto.randomUUID(),
    rideId,
    passengerId: ride.passengerId,
    driverId: ride.assignedDriverId,
    amount: ride.estimatedFare,
    status: 'pending',
    lockPaymentId: null,
    lockTxid: null,
    payoutTxid: null,
    payoutWallet: driverPayoutTarget(ride.assignedDriverId).wallet,
    payoutUid: driverPayoutTarget(ride.assignedDriverId).uid,
    refundTxid: null,
    refundAmount: null,
    heldAt: null,
    releasedAt: null,
    refundedAt: null,
    createdAt,
    updatedAt: createdAt,
  })
}

export function lockEscrow(input: {
  rideId: string
  passengerId: string
  paymentId?: string
  txid?: string
  sandbox?: boolean
}) {
  const ride = getRide(input.rideId)
  if (!ride) return { ok: false as const, error: 'not_found', escrow: null }
  if (ride.passengerId !== input.passengerId) return { ok: false as const, error: 'forbidden', escrow: null }
  if (ride.status !== 'assigned') return { ok: false as const, error: 'not_assigned', escrow: getEscrowByRide(ride.id) }
  const escrow = openEscrowForRide(ride.id)
  if (!escrow) return { ok: false as const, error: 'no_driver', escrow: null }
  if (escrow.status === 'held' || escrow.status === 'released') return { ok: true as const, escrow }
  if (escrow.status === 'refunded') return { ok: false as const, error: 'refunded', escrow }

  const sandbox = Boolean(input.sandbox) || isPiSandboxEnv()
  const paymentId = input.paymentId?.trim() || (sandbox ? `escrow-${escrow.id}` : '')
  const txid = input.txid?.trim() || (sandbox ? `lock-${escrow.id.slice(0, 8)}` : '')
  if (!paymentId || !txid) return { ok: false as const, error: 'payment_required', escrow }

  escrow.status = 'held'
  escrow.lockPaymentId = paymentId
  escrow.lockTxid = txid
  escrow.heldAt = nowIso()
  return { ok: true as const, escrow: stamp(escrow) }
}

const releasingRides = new Set<string>()

/** Passenger arrival is the settlement gate. Recover a lock saved in another process, or a sandbox lock that never landed on this one. */
export function ensureSettlementEscrow(
  rideId: string,
  driverId: string,
  proof?: { status?: string | null; lockTxid?: string | null; lockPaymentId?: string | null },
) {
  syncEscrowFromDisk()
  const ride = getRide(rideId)
  if (!ride || ride.assignedDriverId !== driverId || !ride.readyToSettleAt) return getEscrowByRide(rideId)
  const current = getEscrowByRide(rideId)
  if (current?.status === 'held' || current?.status === 'released' || current?.status === 'refunded') return current
  if (current && (current.lockTxid || current.heldAt)) {
    current.status = 'held'
    return stamp(current)
  }
  const txid = proof?.lockTxid?.trim() || ''
  const paymentId = proof?.lockPaymentId?.trim() || txid
  if (!isPiSandboxEnv() && !txid) return current
  const locked = lockEscrow({
    rideId,
    passengerId: ride.passengerId,
    paymentId: paymentId || undefined,
    txid: txid || undefined,
    sandbox: isPiSandboxEnv(),
  })
  return locked.escrow
}

export async function releaseEscrow(
  rideId: string,
  driverId: string,
  proof?: { status?: string | null; lockTxid?: string | null; lockPaymentId?: string | null },
) {
  syncDispatchFromDisk()
  syncEscrowFromDisk()
  const ride = getRide(rideId)
  if (!ride) return { ok: false as const, error: 'not_found', escrow: null, receipt: null }
  if (ride.assignedDriverId !== driverId) return { ok: false as const, error: 'forbidden', escrow: getEscrowByRide(rideId), receipt: null }
  let escrow = getEscrowByRide(rideId)
  if (ride.status === 'completed' || escrow?.status === 'released') {
    return { ok: true as const, escrow, receipt: getReceipt(rideId) }
  }
  if (releasingRides.has(rideId)) {
    for (let waited = 0; waited < 4000 && releasingRides.has(rideId); waited += 200) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    const settled = getEscrowByRide(rideId)
    if (settled?.status === 'released' || getRide(rideId)?.status === 'completed') {
      return { ok: true as const, escrow: settled, receipt: getReceipt(rideId) }
    }
    return { ok: false as const, error: 'settling', escrow: settled, receipt: null }
  }
  if (ride.status !== 'assigned') return { ok: false as const, error: ride.status, escrow, receipt: null }
  if (!ride.readyToSettleAt) return { ok: false as const, error: 'passenger_not_ready', escrow, receipt: null }
  escrow = ensureSettlementEscrow(rideId, driverId, proof)
  if (escrow?.status === 'released') return { ok: true as const, escrow, receipt: getReceipt(rideId) }
  if (!escrow || escrow.status !== 'held') {
    return { ok: false as const, error: 'escrow_not_held', escrow, receipt: null }
  }
  releasingRides.add(rideId)

  try {
  const target = driverPayoutTarget(driverId)
  let payoutTxid = `a2u-${escrow.id.slice(0, 10)}`
  if (!isPiSandboxEnv() && target.uid && !target.uid.startsWith('virtual-') && !target.uid.startsWith('driver-')) {
    try {
      const payment = await createA2UPayment({
        amount: escrow.amount,
        memo: '택시 정산',
        uid: target.uid,
        metadata: { kind: 'escrow-release', rideId, escrowId: escrow.id },
      })
      payoutTxid = payment.transaction?.txid || payment.identifier || payoutTxid
    } catch (error) {
      if (!isPiSandboxEnv()) throw error
    }
  }

  escrow.status = 'released'
  escrow.payoutWallet = target.wallet
  escrow.payoutUid = target.uid
  escrow.payoutTxid = payoutTxid
  escrow.releasedAt = nowIso()
  stamp(escrow)

  const driver = getDriver(driverId)
  const receipt: SettlementReceipt = {
    rideId,
    passengerId: ride.passengerId,
    driverId,
    driverName: target.name,
    route: routeLabel(ride),
    origin: ride.pickup.address || ride.pickup.label || '출발지',
    waypoints: waypointLabels(ride),
    dest: ride.dest.label || ride.dest.address || '목적지',
    amount: escrow.amount,
    estimatedFare: ride.estimatedFare,
    lockTxid: escrow.lockTxid || '',
    payoutTxid,
    payoutWallet: target.wallet,
    vehicle: driver?.vehicle || '택시',
    plate: driver?.plate || '',
    settledAt: escrow.releasedAt,
  }
  saveReceipt(receipt)
  addEarning({
    id: crypto.randomUUID(),
    driverId,
    rideId,
    amount: escrow.amount,
    route: receipt.route,
    status: 'completed',
    at: receipt.settledAt,
  })
  if (driver) saveDriver({ ...driver, status: 'online', lastSeenAt: nowIso() })
  await recordSettlement({
    refId: `ride:${rideId}`,
    service: ride.kind === 'daeri' ? 'daeri' : 'taxi',
    driverId,
    driverName: target.name,
    passengerId: ride.passengerId,
    memo: receipt.route,
    gross: escrow.amount,
    driverWallet: target.wallet,
  }).catch(() => null)
  return { ok: true as const, escrow, receipt }
  } finally {
    releasingRides.delete(rideId)
  }
}

/** Passenger in-trip cancel: pay the cancellation fee to the assigned driver and waive the rest. No driver action. */
export async function settlePassengerCancelFee(rideId: string) {
  syncDispatchFromDisk()
  syncEscrowFromDisk()
  const ride = getRide(rideId)
  if (!ride) return { ok: false as const, error: 'not_found' }
  const driverId = ride.assignedDriverId
  if (!driverId || ride.status !== 'assigned') return { ok: false as const, error: 'not_assigned' }
  const fareConfig = await getFareConfig()
  const settlement = settleMidTripCancelFee(ride.estimatedFare, { rate: fareConfig.cancel.rate / 100, min: fareConfig.cancel.min })
  const target = driverPayoutTarget(driverId)
  let payoutTxid = `cancel-fee-${rideId.slice(0, 10)}`
  if (settlement.cancelFee > 0 && !isPiSandboxEnv() && target.uid && !target.uid.startsWith('virtual-') && !target.uid.startsWith('driver-')) {
    try {
      const payment = await createA2UPayment({
        amount: settlement.cancelFee,
        memo: '취소 수수료',
        uid: target.uid,
        metadata: { kind: 'cancel-fee', rideId },
      })
      payoutTxid = payment.transaction?.txid || payment.identifier || payoutTxid
    } catch (error) {
      if (!isPiSandboxEnv()) throw error
    }
  }
  const escrow = getEscrowByRide(rideId)
  const settledAt = nowIso()
  if (escrow && escrow.status !== 'released') {
    escrow.payoutWallet = target.wallet
    escrow.payoutUid = target.uid
    escrow.payoutTxid = payoutTxid
    if (settlement.cancelFee > 0) {
      escrow.status = 'released'
      escrow.releasedAt = settledAt
    } else {
      escrow.status = 'refunded'
      escrow.refundedAt = settledAt
    }
    stamp(escrow)
  }
  // The locked fare covers more than the cancellation fee — return the waived
  // remainder to the passenger so nothing is silently kept.
  if (escrow && settlement.waived > 0 && !escrow.refundTxid) {
    await payPassengerRefund(escrow, settlement.waived, '중도 취소 차액 환불')
    stamp(escrow)
  }
  const driver = getDriver(driverId)
  saveReceipt({
    rideId,
    passengerId: ride.passengerId,
    driverId,
    driverName: target.name,
    route: routeLabel(ride),
    origin: ride.pickup.address || ride.pickup.label || '출발지',
    waypoints: waypointLabels(ride),
    dest: ride.dest.label || ride.dest.address || '목적지',
    amount: settlement.cancelFee,
    estimatedFare: ride.estimatedFare,
    lockTxid: escrow?.lockTxid || '',
    payoutTxid,
    payoutWallet: target.wallet,
    vehicle: driver?.vehicle || '택시',
    plate: driver?.plate || '',
    settledAt,
  })
  addEarning({
    id: crypto.randomUUID(),
    driverId,
    rideId,
    amount: settlement.cancelFee,
    route: routeLabel(ride),
    status: 'cancelled',
    at: settledAt,
  })
  if (driver) saveDriver({ ...driver, status: 'online', lastSeenAt: settledAt })
  await recordSettlement({
    refId: `ride:${rideId}:cancel`,
    service: ride.kind === 'daeri' ? 'daeri' : 'taxi',
    driverId,
    driverName: target.name,
    passengerId: ride.passengerId,
    memo: `취소 수수료 · ${routeLabel(ride)}`,
    gross: settlement.cancelFee,
    driverWallet: target.wallet,
  }).catch(() => null)
  return { ok: true as const, settlement, payoutTxid }
}

function passengerRefundTarget(passengerId: string) {
  const linked = getPartnerLink(passengerId)
  const uid = linked?.uid || passengerId
  const external = Boolean(uid) && !uid.startsWith('virtual-') && !uid.startsWith('driver-') && !uid.startsWith('passenger-') && !uid.startsWith('guest-')
  return {
    uid,
    wallet: linked?.wallet || '',
    external,
  }
}

/** Send Pi back to the passenger for a refunded escrow amount. Idempotent via refundTxid. */
async function payPassengerRefund(escrow: EscrowRecord, amount: number, memo: string) {
  const target = passengerRefundTarget(escrow.passengerId)
  let refundTxid = `refund-${escrow.id.slice(0, 10)}`
  if (amount > 0 && !isPiSandboxEnv() && target.external) {
    try {
      const payment = await createA2UPayment({
        amount,
        memo,
        uid: target.uid,
        metadata: { kind: 'refund', rideId: escrow.rideId },
      })
      refundTxid = payment.transaction?.txid || payment.identifier || refundTxid
    } catch (error) {
      if (!isPiSandboxEnv()) throw error
    }
  }
  escrow.refundTxid = refundTxid
  escrow.refundAmount = amount
}

/**
 * Called after a ride is cancelled/abandoned — returns the locked escrow to the
 * passenger. Safe to call repeatedly: once refundTxid is written it no-ops.
 */
export async function processPassengerRefund(rideId: string) {
  const escrow = getEscrowByRide(rideId)
  if (!escrow || escrow.status !== 'refunded' || escrow.refundTxid) return null
  // An escrow that never locked never moved real Pi — book the refund without paying out.
  const amount = escrow.lockTxid ? (escrow.refundAmount ?? escrow.amount) : 0
  if (!amount || amount <= 0) {
    escrow.refundTxid = `refund-${escrow.id.slice(0, 10)}`
    escrow.refundAmount = escrow.refundAmount ?? 0
    stamp(escrow)
    return escrow
  }
  await payPassengerRefund(escrow, amount, '호출 취소 환불')
  stamp(escrow)
  return escrow
}

export function refundEscrow(rideId: string) {
  syncEscrowFromDisk()
  const escrow = getEscrowByRide(rideId)
  if (!escrow) return null
  if (escrow.status === 'released') return escrow
  if (escrow.status === 'held' || escrow.status === 'pending') {
    escrow.status = 'refunded'
    escrow.refundedAt = nowIso()
    stamp(escrow)
    addEarning({
      id: crypto.randomUUID(),
      driverId: escrow.driverId,
      rideId,
      amount: 0,
      route: rideId,
      status: 'cancelled',
      at: escrow.refundedAt,
    })
  }
  return escrow
}

function kstDate(iso: string) {
  return new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000)
}

function periodKeys(iso: string) {
  const date = kstDate(iso)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getUTCDay()]
  return {
    day: `${y}-${m}-${d} (${weekday})`,
    month: `${y}-${m}`,
    year: `${y}`,
    dayKey: `${y}-${m}-${d}`,
  }
}

function rollup(entries: ReturnType<typeof listEarnings>, pick: (keys: ReturnType<typeof periodKeys>) => string): EarningsPeriodRow[] {
  const map = new Map<string, EarningsPeriodRow>()
  for (const entry of entries) {
    const keys = periodKeys(entry.at)
    const period = pick(keys)
    const current = map.get(period) || { period, count: 0, amount: 0, trips: 0, done: 0, cancel: 0, note: '정산됨' }
    current.trips += 1
    if (entry.status === 'completed') {
      current.count += 1
      current.done += 1
      current.amount = piRound(current.amount + entry.amount)
    } else {
      current.cancel += 1
    }
    current.note = current.cancel > 0 && current.done > 0 ? '정산·취소' : current.cancel > 0 ? '취소' : '정산됨'
    map.set(period, current)
  }
  return [...map.values()].sort((a, b) => (a.period < b.period ? 1 : -1))
}

function recordedEarnings(driverId: string): DriverEarning[] {
  syncEscrowFromDisk()
  syncDispatchFromDisk()
  const byRide = new Map<string, DriverEarning>()
  for (const entry of listEarnings(driverId)) byRide.set(`${entry.rideId}:${entry.status}`, entry)
  for (const ride of listRides()) {
    if (ride.assignedDriverId !== driverId) continue
    if (ride.status !== 'completed' && ride.status !== 'cancelled') continue
    const status = ride.status === 'completed' ? 'completed' : 'cancelled'
    const key = `${ride.id}:${status}`
    if (byRide.has(key)) continue
    const receipt = getReceipt(ride.id)
    const amount = status === 'completed' ? (receipt?.amount ?? ride.estimatedFare) : (receipt?.amount ?? 0)
    byRide.set(key, {
      id: `ride-${ride.id}-${status}`,
      driverId,
      rideId: ride.id,
      amount,
      route: routeLabel(ride),
      status,
      at: receipt?.settledAt || ride.updatedAt,
    })
  }
  return [...byRide.values()].sort((a, b) => (a.at < b.at ? 1 : -1))
}

export async function driverEarningsStats(driverId: string, aliasIds: string[] = []): Promise<DriverEarningsStats> {
  // A driver may have history under a device-generated id (pre-login) and a
  // partner uid (post-login) — merge both identities so stats never vanish.
  const ids = [driverId, ...aliasIds].filter((id, index, list) => Boolean(id) && list.indexOf(id) === index)
  const merged = new Map<string, DriverEarning>()
  for (const id of ids) {
    for (const entry of recordedEarnings(id)) {
      const key = `${entry.rideId}:${entry.status}`
      if (!merged.has(key)) merged.set(key, entry)
    }
  }
  // The settlement ledger is written with awaited KV writes and is the most
  // durable record — merge it so rides whose store rows were lost still count.
  let settlements: Awaited<ReturnType<typeof listSettlements>> = []
  try {
    settlements = await listSettlements()
  } catch {
    settlements = []
  }
  const mergeSettlement = (entry: (typeof settlements)[number]) => {
    const ref = /^ride:([^:]+)(:cancel)?$/.exec(entry.refId)
    if (!ref) return
    const status: DriverEarning['status'] = ref[2] ? 'cancelled' : 'completed'
    const key = `${ref[1]}:${status}`
    if (merged.has(key)) return
    merged.set(key, {
      id: `settlement-${entry.id}`,
      driverId: entry.driverId,
      rideId: ref[1],
      amount: entry.gross,
      route: entry.memo || '정산',
      status,
      at: entry.settledAt || entry.createdAt,
    })
  }
  const mergeRide = (ride: ReturnType<typeof listRides>[number], earningDriverId: string) => {
    if (ride.status !== 'completed' && ride.status !== 'cancelled') return
    const status: DriverEarning['status'] = ride.status === 'completed' ? 'completed' : 'cancelled'
    const key = `${ride.id}:${status}`
    if (merged.has(key)) return
    const receipt = getReceipt(ride.id)
    const amount = status === 'completed' ? (receipt?.amount ?? ride.estimatedFare) : (receipt?.amount ?? 0)
    merged.set(key, {
      id: `ride-${ride.id}-${status}`,
      driverId: earningDriverId,
      rideId: ride.id,
      amount,
      route: routeLabel(ride),
      status,
      at: receipt?.settledAt || ride.updatedAt,
    })
  }
  for (const entry of settlements) {
    if (ids.includes(entry.driverId)) mergeSettlement(entry)
  }
  // Last-resort identity bridge: records booked under an id this device no
  // longer knows (lost profile, other browser) still belong to the same
  // named driver. Only fires when the id-based merge found nothing matching
  // that name-derived record, so a matched driver's figures can't be skewed.
  const driverNames = new Set<string>()
  for (const id of ids) {
    const name = getDriver(id)?.name?.trim() || getPartnerLink(id)?.name?.trim()
    if (name) driverNames.add(name)
  }
  if (driverNames.size) {
    for (const ride of listRides()) {
      if (!ride.assignedDriverId || ids.includes(ride.assignedDriverId)) continue
      const assignedName = getDriver(ride.assignedDriverId)?.name?.trim()
      if (!assignedName || !driverNames.has(assignedName)) continue
      mergeRide(ride, ride.assignedDriverId)
    }
    for (const entry of settlements) {
      if (ids.includes(entry.driverId)) continue
      const name = entry.driverName?.trim()
      if (name && driverNames.has(name)) mergeSettlement(entry)
    }
  }
  const entries = [...merged.values()].sort((a, b) => (a.at < b.at ? 1 : -1))
  const daily = rollup(entries, (keys) => keys.day)
  const monthly = rollup(entries, (keys) => keys.month)
  const yearly = rollup(entries, (keys) => keys.year)
  const todayKey = periodKeys(nowIso()).day
  const today = daily.find((row) => row.period === todayKey)
  const totalAmount = entries.filter((item) => item.status === 'completed').reduce((sum, item) => sum + item.amount, 0)
  const totalDone = entries.filter((item) => item.status === 'completed').length
  const totalCancel = entries.filter((item) => item.status === 'cancelled').length
  return {
    todayAmount: today?.amount ?? 0,
    todayTrips: today?.trips ?? 0,
    rating: ids.map((id) => getDriver(id)?.rating).find(Boolean) || '5.00',
    daily,
    monthly,
    yearly,
    total: [
      {
        period: '누적 합계',
        count: totalDone,
        amount: piRound(totalAmount),
        trips: entries.length,
        done: totalDone,
        cancel: totalCancel,
        note: '전체',
      },
    ],
    recent: entries.slice(0, 20),
  }
}

export function rideReceipt(rideId: string) {
  return getReceipt(rideId)
}

export function getDriverActiveRideId(driverId: string) {
  const ride = listRides().find((item) => item.assignedDriverId === driverId && item.status === 'assigned')
  return ride?.id ?? null
}
