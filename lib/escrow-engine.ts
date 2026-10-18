import { getDriver, getRide, listRides, nowIso, saveDriver, syncDispatchFromDisk } from '@/lib/dispatch-store'
import { estimateTaxiFarePi, etaMinutesFromKm, trafficDelayMinutes, trafficDelaySurchargePi, waypointRouteQuote } from '@/lib/dispatch-geo'
import { settleMidTripCancelFee } from '@/lib/ride-fare'
import { getFareConfig } from '@/lib/fare-config-server'
import { timeSurchargeRate } from '@/lib/fare-config'
import { piRound } from '@/lib/pi-format'
import { getPartnerLink } from '@/lib/partner-ledger-server'
import { getCommissionRates, listSettlements, markSettlementSettled, recordSettlement } from '@/lib/settlement-store'
import type { SettlementService } from '@/lib/settlement-types'
import { isPiSandboxEnv } from '@/lib/pi-sandbox'
import { createA2UPayment } from '@/lib/pi-platform'
import { creditUserDeposit, listUserSpends, recordUserSpend } from '@/lib/user-credit-store'
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
import { notifyDriverSettled } from '@/lib/push-events'

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
}) {
  const ride = getRide(input.rideId)
  if (!ride) return { ok: false as const, error: 'not_found', escrow: null }
  if (ride.passengerId !== input.passengerId) return { ok: false as const, error: 'forbidden', escrow: null }
  if (ride.status !== 'assigned') return { ok: false as const, error: 'not_assigned', escrow: getEscrowByRide(ride.id) }
  const escrow = openEscrowForRide(ride.id)
  if (!escrow) return { ok: false as const, error: 'no_driver', escrow: null }
  if (escrow.status === 'held' || escrow.status === 'released') return { ok: true as const, escrow }
  if (escrow.status === 'refunded') return { ok: false as const, error: 'refunded', escrow }

  // 결제 증거 없는 잠금은 어떤 네트워크에서도 허용하지 않는다 — 과거에는
  // 샌드박스에서 escrow-*/lock-* 가짜 ID를 만들어 '결제 없는 잠금'이 생겨
  // 이용 종료 시점의 Pi SDK 결제 창이 건너뛰어졌다.
  const paymentId = input.paymentId?.trim() || ''
  const txid = input.txid?.trim() || ''
  if (!paymentId || !txid) return { ok: false as const, error: 'payment_required', escrow }

  escrow.status = 'held'
  escrow.lockPaymentId = paymentId
  escrow.lockTxid = txid
  escrow.heldAt = nowIso()
  return { ok: true as const, escrow: stamp(escrow) }
}

const releasingRides = new Set<string>()

/**
 * 정산 시점의 이용자 잔액 장부 차감 — 두 갈래를 모두 처리한다.
 *
 *  1. 잔액 결제(lockTxid가 balance-*이거나 이 운행의 balance-ride-* 지출이 이미
 *     있는 건): 탑승 완료 시점의 예상 요금으로 미리 차감됐으므로 최종 정산액과의
 *     차액만 대사한다 — 부족분은 지출 장부에 추가 차감(adj), 초과분은 크레딧
 *     환불(refund). 실온체인 Pi 결제 잠금(지출 txid=실제 결제 txid)도 여기서
 *     찾혀 차액만 움직인다.
 *  2. 지출 장부에 이 운행의 차감이 없는데 잠긴 건(테스트넷 자동/모의 잠금):
 *     정산 시점에 최종 정산액을 지출로 기록해 서버 장부(spendable)가 실제로
 *     줄어들게 한다. 승객이 완료를 누르지 않고 기사가 먼저 정산하거나 앱이
 *     닫혀 있어도 장부가 맞는다. 메인넷에서는 모의 잠금 자체가 성립하지 않아
 *     이 경로는 실행되지 않는다(실결제 없는 차감을 만들지 않는다).
 *
 * txid 멱등이라 재정산·재시도가 겹쳐도 한 번만 반영된다.
 */
async function settleRideSpend(
  ride: NonNullable<ReturnType<typeof getRide>>,
  lockTxid: string | null | undefined,
  settledAmount: number,
) {
  const spends = await listUserSpends().catch(() => [])
  const spend = spends.find(
    (entry) => (lockTxid && entry.txid === lockTxid) || entry.txid === `balance-ride-${ride.id}`,
  )
  if (spend) {
    const diff = piRound(settledAmount - spend.amount)
    if (diff > 0.000001) {
      await recordUserSpend({ txid: `${spend.txid}-adj`, wallet: spend.wallet, uid: spend.uid, amount: diff, label: '운행 정산 차액' }).catch((error) => {
        console.error('[Spend] balance adjust debit failed', { lockTxid, diff, error })
      })
    } else if (diff < -0.000001) {
      await creditUserDeposit({ txid: `${spend.txid}-refund`, wallet: spend.wallet, uid: spend.uid, amount: piRound(-diff), source: 'manual' }).catch((error) => {
        console.error('[Spend] balance adjust refund failed', { lockTxid, diff, error })
      })
    }
    return
  }
  if (!isPiSandboxEnv() || !(settledAmount > 0)) return
  // 검증되지 않은 잠금에 차감 장부를 만들면 실결제 없는 '지출'이 생긴다 —
  // 폴백 차감은 서버가 /api/pi/complete(또는 명시적 모의결제)로 검증해
  // payment-kind 레지스트리에 올라간 txid의 잠금에만 허용한다.
  const verified = lockTxid
    ? lockTxid.startsWith('balance-') ||
      Boolean(await (await import('@/lib/payment-kind-store')).paymentKindOf(lockTxid).catch(() => ''))
    : false
  if (!verified) {
    console.warn('[Spend] ride settle skipped: escrow lock txid is not a server-verified payment', {
      rideId: ride.id,
      lockTxid: lockTxid || '(none)',
    })
    return
  }
  const uid = ride.passengerUid || ride.passengerId
  const entry = await recordUserSpend({
    txid: `settle-ride-${ride.id}`,
    uid,
    amount: settledAmount,
    label: '운행 요금 정산',
  }).catch((error) => {
    console.error('[Spend] ride settle debit failed', { rideId: ride.id, settledAmount, error })
    return null
  })
  if (entry) console.log('[Spend] unfunded ride lock debited at settle', { rideId: ride.id, uid, amount: settledAmount })
}


/**
 * Passenger arrival is the settlement gate. Recover a lock saved in another
 * process, or promote a client-supplied proof — but only when the txid is one
 * the server itself verified through /api/pi/complete (or testnet mock-pay)
 * and recorded in the payment-kind registry. A client can send any lockTxid
 * string, so unverified proofs must never produce a 'held' escrow.
 */
export async function ensureSettlementEscrow(
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
  if (!txid) return current
  const { paymentKindOf } = await import('@/lib/payment-kind-store')
  const verifiedKind = await paymentKindOf(txid).catch(() => '')
  if (!verifiedKind) {
    console.warn('[escrow] lock rejected: proof txid not a server-verified payment', { rideId })
    return current
  }
  const locked = lockEscrow({
    rideId,
    passengerId: ride.passengerId,
    paymentId: paymentId || undefined,
    txid,
  })
  return locked.escrow
}

export async function releaseEscrow(
  rideId: string,
  driverId: string,
  proof?: { status?: string | null; lockTxid?: string | null; lockPaymentId?: string | null },
  actualKm?: number,
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
  escrow = await ensureSettlementEscrow(rideId, driverId, proof)
  if (escrow?.status === 'released') return { ok: true as const, escrow, receipt: getReceipt(rideId) }
  if (!escrow || escrow.status !== 'held') {
    return { ok: false as const, error: 'escrow_not_held', escrow, receipt: null }
  }
  releasingRides.add(rideId)

  try {
  // 정체 추가 요금: 길찾기 API 기준 예상 소요 시간(expectedMinutes) 대비 실제
  // 운행 시간(boardedAt → readyToSettleAt)이 TRAFFIC_DELAY_FREE_MINUTES 이상
  // 늦어진 경우에만 초과분에 분당 시간 요금율을 곱해 더한다.
  const fareConfig = await getFareConfig()
  const routeKm = waypointRouteQuote(ride.pickup, ride.dest, ride.waypoints ?? []).routeKm
  // 실제 주행 거리 정산 — 대략 목적지(~동) 입력이어도 GPS 실측 거리로 최종 요금을
  // 재산정한다. 기사 앱 오도미터(actualKm 인자)와 서버 presence 누적값 중 큰 쪽을
  // 쓰되, 예상 경로의 최대 4배(+20km)를 넘는 값은 GPS 오류로 보고 예상 요금을 유지.
  const measuredKm = Math.max(ride.actualKm ?? 0, actualKm ?? 0)
  const measuredCap = Math.max(routeKm * 4, routeKm + 20, 15)
  const validMeasured = measuredKm >= 0.3 && measuredKm <= measuredCap ? measuredKm : null
  const rawExpectedMin =
    ride.expectedMinutes && ride.expectedMinutes > 0
      ? ride.expectedMinutes
      : etaMinutesFromKm(routeKm)
  // 실측 거리 정산 시 기준 소요 시간도 실측 거리 비율만큼 스케일한다 — 목적지가
  // 예상보다 멀어진 것이 '정체 지연'으로 잘못 과금되지 않게 하기 위함이다.
  const expectedMin =
    validMeasured != null && routeKm > 0.01 ? rawExpectedMin * (validMeasured / routeKm) : rawExpectedMin
  const actualMin =
    ride.boardedAt && ride.readyToSettleAt
      ? Math.max(0, (Date.parse(ride.readyToSettleAt) - Date.parse(ride.boardedAt)) / 60000)
      : 0
  const delayMin = trafficDelayMinutes(actualMin, expectedMin)
  const trafficSurcharge = trafficDelaySurchargePi(delayMin, fareConfig, ride.kind, ride.tier)
  // 시간대별 할증 — 실측 거리로 재산정할 때도 승차 시각 기준 할증률을 곱한다.
  // 실측이 없어 예상 요금을 그대로 쓰는 경우에는 견적 산정 시 이미 반영돼 있다.
  const nightRate = timeSurchargeRate(fareConfig, ride.boardedAt ? new Date(ride.boardedAt) : new Date())
  // 유료도로 통행료 — 견적 시 서버가 산출해 estimatedFare(=에스크로 잠금액)에 이미
  // 포함된 값이다. 실측 거리로 운임을 재산정할 때는 운임만 새로 계산하므로
  // 통행료를 별도 항목으로 다시 더한다(예상 요금을 그대로 쓰는 경로는
  // escrow.amount에 이미 포함 → 이중 합산 방지).
  const tollPi = Number.isFinite(ride.tollPi) && (ride.tollPi ?? 0) > 0 ? Number(ride.tollPi) : 0
  const baseAmount =
    validMeasured != null
      ? piRound(estimateTaxiFarePi(validMeasured, fareConfig, ride.kind, ride.tier) * (1 + nightRate) + tollPi)
      : escrow.amount
  const settleAmount = piRound(baseAmount + trafficSurcharge)
  // 기본 운임 부분 — 총액에서 통행료를 뺀 값(정체·기피 할증은 운임에 포함).
  const fareBase = piRound(settleAmount - tollPi)

  // 플랫폼 수수료 분리 — 기사에게는 수수료 공제 후 net만 송금하고,
  // 수수료는 승객 결제가 입금된 플랫폼 지갑에 그대로 남는다.
  const settleService: SettlementService = ride.kind === 'daeri' ? 'daeri' : 'taxi'
  const settleRate = (await getCommissionRates().catch(() => null))?.[settleService] ?? 0
  const commission = piRound(settleAmount * settleRate / 100)
  const payoutAmount = piRound(settleAmount - commission)

  const target = driverPayoutTarget(driverId)
  let payoutTxid = `a2u-${escrow.id.slice(0, 10)}`
  let payoutSent = false
  if (!isPiSandboxEnv() && payoutAmount > 0 && target.uid && !target.uid.startsWith('virtual-') && !target.uid.startsWith('driver-')) {
    try {
      const payment = await createA2UPayment({
        amount: payoutAmount,
        memo: '택시 정산',
        uid: target.uid,
        metadata: { kind: 'escrow-release', rideId, escrowId: escrow.id, gross: settleAmount, commission },
      })
      payoutTxid = payment.transaction?.txid || payment.identifier || payoutTxid
      payoutSent = true
    } catch (error) {
      if (!isPiSandboxEnv()) throw error
    }
  }

  escrow.status = 'released'
  escrow.amount = settleAmount
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
    amount: settleAmount,
    estimatedFare: ride.estimatedFare,
    fareBase,
    tollPi: tollPi || undefined,
    tollKrw: ride.tollKrw ?? null,
    trafficSurcharge,
    trafficDelayMinutes: Math.round(delayMin * 10) / 10,
    expectedMinutes: Math.round(expectedMin * 10) / 10,
    actualKm: validMeasured != null ? Math.round(validMeasured * 100) / 100 : undefined,
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
    fareBase,
    tollPi: tollPi || undefined,
    status: 'completed',
    at: receipt.settledAt,
  })
  if (driver) saveDriver({ ...driver, status: 'online', lastSeenAt: nowIso() })
  const settleEntry = await recordSettlement({
    refId: `ride:${rideId}`,
    service: settleService,
    driverId,
    driverName: target.name,
    passengerId: ride.passengerId,
    memo: tollPi > 0 ? `${receipt.route} · 통행료 ${piRound(tollPi)} Pi 포함` : receipt.route,
    gross: escrow.amount,
    driverWallet: target.wallet,
    tollPi: tollPi || undefined,
    tollKrw: ride.tollKrw ?? undefined,
    channel: 'inapp',
  }).catch(() => null)
  // net 송금이 온체인에서 확인됐으면 장부도 즉시 '정산 완료'로 마감하고
  // 송금 txid를 장부에 남겨 기사 net 송금과 수수료 귀속의 증거를 연결한다.
  if (payoutSent && settleEntry) {
    await markSettlementSettled(settleEntry.id, payoutTxid).catch(() => null)
  }
  // 이용자 잔액 장부 — 잔액 결제 건은 차액을 대사하고, 결제 없이 잠긴 건
  // (테스트넷 모의 잠금)은 정산 시점에 최종 요금을 차감한다.
  await settleRideSpend(ride, escrow.lockTxid, settleAmount)
  // 기사 정산 완료 웹 푸시 — 에스크로가 해제돼 장부가 마감된 시점에 알린다.
  if (settleEntry) {
    void notifyDriverSettled(driverId, receipt.route || '운행', settleEntry.net).catch(() => undefined)
  }
  return { ok: true as const, escrow, receipt }
  } finally {
    releasingRides.delete(rideId)
  }
}

const cancelSettlingRides = new Set<string>()

/**
 * Passenger in-trip cancel: pay the cancellation fee to the assigned driver and waive the rest. No driver action.
 *
 * 감사·대사 안전 순서 — 정산 장부를 송금보다 먼저 기록해 A2U 송금이나 환불이
 * 실패해도 미정산 채권이 장부에 남아 운영자가 재정산할 수 있다. 재호출은
 * 멱등: 이미 released/refunded 에스크로면 A2U를 다시 보내지 않는다.
 */
export async function settlePassengerCancelFee(rideId: string) {
  syncDispatchFromDisk()
  syncEscrowFromDisk()
  const ride = getRide(rideId)
  if (!ride) return { ok: false as const, error: 'not_found' }
  const driverId = ride.assignedDriverId
  if (!driverId || ride.status !== 'assigned') return { ok: false as const, error: 'not_assigned' }
  const fareConfig = await getFareConfig()
  // 수수료 기준 금액은 운임만 — 예상 통행료(미주행 구간)에는 위약금을 얹지 않는다.
  const fareQuoted = piRound(ride.estimatedFare - Math.max(0, ride.tollPi ?? 0))
  const settlement = settleMidTripCancelFee(fareQuoted, { rate: (fareConfig.cancel?.rate ?? 40) / 100, min: fareConfig.cancel?.min ?? 0.5 })

  // 이미 정산된 취소 건 — 이중 송금을 막고 이전 결과를 그대로 돌려준다.
  // 단, 이전 시도에서 면제분 환불만 실패했다면 여기서 재시도한다.
  const prior = getEscrowByRide(rideId)
  if (prior?.status === 'released' || prior?.status === 'refunded') {
    if (prior.status === 'released' && !prior.refundTxid && settlement.waived > 0 && !prior.lockTxid?.startsWith('balance-')) {
      try {
        await payPassengerRefund(prior, settlement.waived, '중도 취소 차액 환불')
        stamp(prior)
        console.log('[cancel-fee] pending waived refund retried', { rideId, amount: settlement.waived, refundTxid: prior.refundTxid })
      } catch (error) {
        console.error('[cancel-fee] waived refund retry failed', { rideId, waived: settlement.waived, error: error instanceof Error ? error.message : 'error' })
      }
    }
    return { ok: true as const, settlement, payoutTxid: prior.payoutTxid || '', duplicate: true as const }
  }

  // 잠긴 결제가 없는 취소는 공제할 자금이 없다 — 미잠금 에스크로에는 A2U
  // 송금·환불을 보내지 않는다(플랫폼 지갑의 무담보 출금 방지). 미결제 상태의
  // 배정 후 취소는 수수료 없이 종료된다.
  if (!prior || !prior.lockTxid) {
    console.log('[cancel-fee] skipped: no funded escrow', { rideId, escrowStatus: prior?.status || 'none' })
    return {
      ok: true as const,
      settlement: { ...settlement, cancelFee: 0, waived: settlement.quoted, driverPayout: 0 },
      payoutTxid: '',
      unfunded: true as const,
    }
  }

  // 동시 호출 가드 — 이중 탭·재시도·다중 프로세스가 겹쳐도 정산은 한 번만 진행한다.
  if (cancelSettlingRides.has(rideId)) {
    for (let waited = 0; waited < 4000 && cancelSettlingRides.has(rideId); waited += 200) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    const settled = getEscrowByRide(rideId)
    if (settled?.status === 'released' || settled?.status === 'refunded' || getRide(rideId)?.status === 'cancelled') {
      return { ok: true as const, settlement, payoutTxid: settled?.payoutTxid || '', duplicate: true as const }
    }
    return { ok: false as const, error: 'settling' }
  }
  cancelSettlingRides.add(rideId)
  try {
    const cancelService: SettlementService = ride.kind === 'daeri' ? 'daeri' : 'taxi'
    const cancelRate = (await getCommissionRates().catch(() => null))?.[cancelService] ?? 0
    const cancelCommission = piRound(settlement.cancelFee * cancelRate / 100)
    // 취소 수수료에도 동일한 수수료율을 적용 — 기사에게는 net만 송금.
    const cancelPayout = piRound(settlement.cancelFee - cancelCommission)
    const target = driverPayoutTarget(driverId)
    const driver = getDriver(driverId)
    const settledAt = nowIso()
    console.log('[cancel-fee] settle start', {
      rideId,
      quoted: settlement.quoted,
      cancelFee: settlement.cancelFee,
      waived: settlement.waived,
      feeRate: settlement.feeRate,
      minFee: fareConfig.cancel?.min ?? 0.5,
      commission: cancelCommission,
      payout: cancelPayout,
      network: isPiSandboxEnv() ? 'testnet' : 'mainnet',
    })

    // 장부를 송금보다 먼저 기록한다 — refId 멱등이라 재시도도 1건만 남는다.
    const cancelEntry = await recordSettlement({
      refId: `ride:${rideId}:cancel`,
      service: cancelService,
      driverId,
      driverName: target.name,
      passengerId: ride.passengerId,
      memo: `취소 수수료 · ${routeLabel(ride)}`,
      gross: settlement.cancelFee,
      driverWallet: target.wallet,
      channel: 'inapp',
    }).catch((error) => {
      console.error('[cancel-fee] settlement ledger write failed', { rideId, error: error instanceof Error ? error.message : 'error' })
      return null
    })

    let payoutTxid = `cancel-fee-${rideId.slice(0, 10)}`
    let cancelPayoutSent = false
    if (cancelPayout > 0 && !isPiSandboxEnv() && target.uid && !target.uid.startsWith('virtual-') && !target.uid.startsWith('driver-')) {
      try {
        const payment = await createA2UPayment({
          amount: cancelPayout,
          memo: '취소 수수료',
          uid: target.uid,
          metadata: { kind: 'cancel-fee', rideId, gross: settlement.cancelFee, commission: cancelCommission },
        })
        payoutTxid = payment.transaction?.txid || payment.identifier || payoutTxid
        cancelPayoutSent = true
      } catch (error) {
        // 송금 실패가 취소 자체를 가로막지 않는다 — 장부에 pending으로 남겨
        // 관리자가 수수료 장부에서 재정산한다.
        console.error('[cancel-fee] driver payout failed — left pending for reconciliation', { rideId, payout: cancelPayout, error: error instanceof Error ? error.message : 'error' })
      }
    }
    if (cancelPayoutSent && cancelEntry) {
      await markSettlementSettled(cancelEntry.id, payoutTxid).catch(() => null)
    }

    const escrow = getEscrowByRide(rideId)
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
    // remainder to the passenger so nothing is silently kept. 잔액 결제 건은
    // 온체인 잠금이 없었으므로 A2U가 아니라 아래 잔액 크레딧 환불로 대사한다.
    const balanceLocked = Boolean(escrow?.lockTxid?.startsWith('balance-'))
    if (escrow && settlement.waived > 0 && !escrow.refundTxid && !balanceLocked) {
      try {
        await payPassengerRefund(escrow, settlement.waived, '중도 취소 차액 환불')
        stamp(escrow)
      } catch (error) {
        // 환불 송금 실패 — 의도한 환불액을 남겨 다음 정산 패스에서 재시도한다.
        escrow.refundAmount = settlement.waived
        stamp(escrow)
        console.error('[cancel-fee] waived refund failed — retryable on next settle pass', { rideId, waived: settlement.waived, error: error instanceof Error ? error.message : 'error' })
      }
    }
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
    // 잔액 결제 건 — 예상 요금 전액이 이미 차감됐으므로 취소 수수료와의 차액(면제분)을
    // 크레딧으로 돌려준다. 모의 잠금 등 미차감 건은 취소 수수료를 정산 시점에 차감한다.
    await settleRideSpend(ride, escrow?.lockTxid, settlement.cancelFee)
    console.log('[cancel-fee] settle done', {
      rideId,
      cancelFee: settlement.cancelFee,
      waived: settlement.waived,
      payoutTxid,
      refundTxid: escrow?.refundTxid || null,
      payoutPending: !cancelPayoutSent && cancelPayout > 0 && !isPiSandboxEnv(),
      refundPending: Boolean(escrow && settlement.waived > 0 && !escrow.refundTxid && !balanceLocked),
    })
    return { ok: true as const, settlement, payoutTxid }
  } finally {
    cancelSettlingRides.delete(rideId)
  }
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
