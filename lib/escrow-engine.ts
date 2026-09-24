import { getDriver, getRide, listRides, nowIso, saveDriver } from '@/lib/dispatch-store'
import { settleMidTripCancelFee } from '@/lib/ride-fare'
import { getPartnerLink } from '@/lib/partner-ledger-server'
import { isPiSandboxEnv } from '@/lib/pi-sandbox'
import { createA2UPayment } from '@/lib/pi-platform'
import {
  addEarning,
  getEscrowByRide,
  getReceipt,
  listEarnings,
  saveEscrow,
  saveReceipt,
} from '@/lib/escrow-store'
import type { DriverEarningsStats, EarningsPeriodRow, EscrowRecord, PublicEscrow, SettlementReceipt } from '@/lib/escrow-types'

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

function routeLabel(ride: NonNullable<ReturnType<typeof getRide>>) {
  const origin = ride.pickup.address || ride.pickup.label || '출발지'
  const dest = ride.dest.label || ride.dest.address || '목적지'
  return `${origin} → ${dest}`
}

function driverPayoutTarget(driverId: string) {
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

export async function releaseEscrow(rideId: string, driverId: string) {
  const ride = getRide(rideId)
  if (!ride) return { ok: false as const, error: 'not_found', escrow: null, receipt: null }
  if (ride.assignedDriverId !== driverId) return { ok: false as const, error: 'forbidden', escrow: getEscrowByRide(rideId), receipt: null }
  if (ride.status !== 'assigned') return { ok: false as const, error: ride.status, escrow: getEscrowByRide(rideId), receipt: null }
  const escrow = getEscrowByRide(rideId)
  if (!escrow || escrow.status !== 'held') return { ok: false as const, error: 'escrow_not_held', escrow, receipt: null }

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
  return { ok: true as const, escrow, receipt }
}

/** Passenger in-trip cancel: pay the cancellation fee to the assigned driver and waive the rest. No driver action. */
export async function settlePassengerCancelFee(rideId: string) {
  const ride = getRide(rideId)
  if (!ride) return { ok: false as const, error: 'not_found' }
  const driverId = ride.assignedDriverId
  if (!driverId || ride.status !== 'assigned') return { ok: false as const, error: 'not_assigned' }
  const settlement = settleMidTripCancelFee(ride.estimatedFare)
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
  const driver = getDriver(driverId)
  saveReceipt({
    rideId,
    passengerId: ride.passengerId,
    driverId,
    driverName: target.name,
    route: routeLabel(ride),
    origin: ride.pickup.address || ride.pickup.label || '출발지',
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
  return { ok: true as const, settlement, payoutTxid }
}

export function refundEscrow(rideId: string) {
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
    const current = map.get(period) || { period, count: 0, amount: 0, trips: 0, done: 0, cancel: 0, note: '진행 중' }
    current.trips += 1
    if (entry.status === 'completed') {
      current.count += 1
      current.done += 1
      current.amount = Math.round((current.amount + entry.amount) * 100) / 100
    } else {
      current.cancel += 1
    }
    map.set(period, current)
  }
  return [...map.values()].sort((a, b) => (a.period < b.period ? 1 : -1))
}

export function driverEarningsStats(driverId: string): DriverEarningsStats {
  const entries = listEarnings(driverId)
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
    todayTrips: today?.done ?? 0,
    rating: getDriver(driverId)?.rating || '5.00',
    daily,
    monthly,
    yearly,
    total: [
      {
        period: '누적 합계',
        count: totalDone,
        amount: Math.round(totalAmount * 100) / 100,
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
