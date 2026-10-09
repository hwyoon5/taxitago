import { NextResponse } from 'next/server'
import { adminActor, hasAdminPrivilege, isAdminRequest } from '@/lib/admin-auth'
import {
  getCommissionRates,
  healZeroCommissionEntries,
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
import { isPiWalletAddress, piWalletError } from '@/lib/pi-wallet'
import { depositTotals, listDeposits, recordDeposit } from '@/lib/deposit-store'
import { checkInboundPayment, scanInboundDeposits } from '@/lib/deposit-scan'
import { creditUserDeposit, listUserCredits } from '@/lib/user-credit-store'
import { isDepositPaymentKind, knownServiceTxids, paymentKindOf } from '@/lib/payment-kind-store'
import { listWalletTxs, recordWalletTx, walletTxTotals } from '@/lib/wallet-history'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'
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
    // NaN/누락 필드가 합계 전체를 0으로 오염시키지 않도록 값을 강제한다.
    const g = Number.isFinite(entry.gross) ? entry.gross : 0
    const c = Number.isFinite(entry.commission) ? entry.commission : 0
    const n = Number.isFinite(entry.net) ? entry.net : 0
    const bucket = byService[entry.service]
    if (bucket) {
      bucket.count += 1
      bucket.gross += g
      bucket.commission += c
      bucket.net += n
    }
    gross += g
    commission += c
    net += n
    if (entry.status === 'pending') {
      pendingCount += 1
      pendingNet += n
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
  // 관리자 화면을 여는 것만으로도 체인 입금을 다시 스캔해 장부에 반영한다 —
  // 스캔이 느려도 화면 로딩이 밀리지 않도록 소프트 타임아웃을 둔다.
  await Promise.race([
    scanInboundDeposits(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
  ]).catch((error) => console.error('[Deposit] admin settlements scan failed', error))
  const [rates, entries, audit, fare, adminWallet, deposits, depositTotal, history, historyTotals, userCredits] = await Promise.all([getCommissionRates(), listSettlements(), listAudit(), getFareConfig(), getAdminWallet(), listDeposits(), depositTotals(), listWalletTxs(), walletTxTotals(), listUserCredits()])
  // 크레딧 귀속 백필 — 입금은 기록됐는데 유저 크레딧이 빠진 과거 건을 복구한다(txid 멱등).
  // 단, 서비스 결제로 확정된 txid는 입금이 아니므로 크레딧하지 않는다.
  const serviceTxids = await knownServiceTxids().catch(() => new Set<string>())
  const seenCredit = new Set(userCredits.map((credit) => credit.txid))
  for (const deposit of deposits) {
    if (!deposit.txid || deposit.status !== 'confirmed' || seenCredit.has(deposit.txid) || serviceTxids.has(deposit.txid)) continue
    const credited = await creditUserDeposit({
      txid: deposit.txid,
      wallet: deposit.fromWallet,
      uid: deposit.fromUid,
      amount: deposit.amount,
      source: 'scan',
    }).catch((error) => {
      console.error('[Deposit] admin backfill credit failed', { txid: deposit.txid, error })
      return null
    })
    if (credited) seenCredit.add(deposit.txid)
  }
  // 각 입금이 이용자 잔액에 귀속됐는지 관리자 화면에서 바로 확인할 수 있게 표시한다.
  const depositsView = deposits.map((deposit) => ({
    ...deposit,
    userCredited: seenCredit.has(deposit.txid),
    servicePayment: serviceTxids.has(deposit.txid),
  }))
  // Older ledger rows predate the passengerId column — resolve it from the
  // ride record so exports still show the passenger for every ride:* ref.
  await hydrateDispatchFromKv()
  syncDispatchFromDisk()
  // Backfill: 입금 장부에만 있고 통합 입·출금 내역에 없는 과거 기록을 병합한다.
  // recordWalletTx는 (kind, txid) 멱등이라 중복 기록되지 않는다.
  const knownTx = new Set(history.map((entry) => `${entry.kind}:${entry.txid}`))
  const missing = deposits.filter((deposit) => deposit.txid && !knownTx.has(`deposit:${deposit.txid}`))
  if (missing.length) {
    for (const deposit of missing) {
      await recordWalletTx({
        kind: 'deposit',
        txid: deposit.txid,
        fromWallet: deposit.fromWallet,
        toWallet: deposit.toWallet,
        amount: deposit.amount,
        memo: deposit.memo,
        status: deposit.status === 'pending' ? 'pending' : 'confirmed',
        network: isPiSandboxRequest(request) ? 'testnet' : 'mainnet',
      }).catch(() => undefined)
    }
    const [refreshed, refreshedTotals] = await Promise.all([listWalletTxs(), walletTxTotals()])
    history.length = 0
    history.push(...refreshed)
    historyTotals.deposit = refreshedTotals.deposit
    historyTotals.withdraw = refreshedTotals.withdraw
  }
  const enriched = entries.map((entry) => {
    if (entry.passengerId) return entry
    const rideId = /^ride:([^:]+)/.exec(entry.refId)?.[1]
    const passengerId = rideId ? getRide(rideId)?.passengerId : undefined
    return passengerId ? { ...entry, passengerId } : entry
  })
  return NextResponse.json({ ok: true, rates, entries: enriched, summary: summarize(enriched), storage: settlementStorageBackend(), audit, fare, adminWallet, deposits: depositsView, depositTotal, history, historyTotals })
}

export async function PATCH(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
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
    txid?: unknown
    fromWallet?: unknown
    fromUid?: unknown
    amount?: unknown
  } | null
  const action = body?.action
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

  // 설정 변경(수수료율·요금·수수료 수취 지갑)은 최고책임자 또는 팀장만 허용된다.
  const PRIVILEGED_ACTIONS = new Set(['wallet', 'rates', 'fare'])
  if (typeof action === 'string' && PRIVILEGED_ACTIONS.has(action) && !hasAdminPrivilege(actor)) {
    return NextResponse.json({ error: '설정 변경 권한이 없습니다 (최고책임자 및 팀장만 가능합니다)' }, { status: 403 })
  }

  if (action === 'wallet') {
    const address = typeof body?.wallet === 'string' ? body.wallet.trim() : ''
    if (!isPiWalletAddress(address)) {
      return NextResponse.json({ error: piWalletError(address) ?? 'Pi 지갑 주소 형식이 올바르지 않습니다.' }, { status: 400 })
    }
    const before = await getAdminWallet()
    const adminWallet = await saveAdminWallet(address)
    await recordAudit({ kind: 'wallet', actor: actor.staffId, actorName: actor.staffName, reason, before: { address: before }, after: { address: adminWallet } }).catch(() => undefined)
    return NextResponse.json({ ok: true, adminWallet })
  }

  // Record an inbound testnet deposit to the platform wallet. Idempotent by
  // txid so webhooks/manual syncs can be replayed safely.
  if (action === 'deposit') {
    const txid = typeof body?.txid === 'string' ? body.txid.trim() : ''
    const fromWallet = typeof body?.fromWallet === 'string' ? body.fromWallet.trim() : ''
    const amount = Number(body?.amount)
    if (!txid) return NextResponse.json({ error: 'txid가 필요합니다.' }, { status: 400 })
    if (!fromWallet) return NextResponse.json({ error: '보낸 지갑 주소가 필요합니다.' }, { status: 400 })
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: '입금 금액이 올바르지 않습니다.' }, { status: 400 })
    // 서비스 결제(탑승비 등)로 확정된 txid를 입금으로 등록하면 이용자 잔액이 이중 반영된다.
    const paidKind = await paymentKindOf(txid).catch(() => '')
    if (!isDepositPaymentKind(paidKind)) {
      return NextResponse.json({ error: '해당 txid는 서비스 결제로 이미 처리된 트랜잭션입니다. 입금으로 등록할 수 없습니다.' }, { status: 400 })
    }
    const toWallet = await getAdminWallet()
    // 체인에 실제 존재하는 입금인지 교차 확인 — 불일치(실패 tx, 다른 입금)는 기록하지 않는다.
    // unknown(전파 지연/Horizon 장애)은 관리자 판단으로 기록을 허용하고 상태를 표시한다.
    const chainStatus = await checkInboundPayment({ txid, from: fromWallet, to: toWallet, amount }).catch((error) => {
      console.warn('[Deposit] admin manual deposit chain check failed', { txid, error })
      return 'unknown' as const
    })
    if (chainStatus === 'mismatch') {
      return NextResponse.json({ error: '체인에서 확인된 입금 정보(보낸 주소·수신 주소·금액)와 일치하지 않습니다.', chainStatus }, { status: 400 })
    }
    const deposit = await recordDeposit({
      txid,
      fromWallet,
      toWallet,
      amount,
      fromUid: typeof body?.fromUid === 'string' ? body.fromUid : undefined,
      memo: typeof body?.memo === 'string' ? body.memo : undefined,
      status: 'confirmed',
    })
    if (!deposit) return NextResponse.json({ error: '입금 기록에 실패했습니다.' }, { status: 400 })
    // 수동 동기화도 보낸 지갑/uid 이용자의 잔액 귀속을 즉시 기록한다(txid 멱등).
    await creditUserDeposit({
      txid: deposit.txid,
      wallet: deposit.fromWallet,
      uid: deposit.fromUid,
      amount: deposit.amount,
      source: 'manual',
    }).catch(() => undefined)
    await recordWalletTx({
      kind: 'deposit',
      txid: deposit.txid,
      fromWallet: deposit.fromWallet,
      toWallet: deposit.toWallet,
      amount: deposit.amount,
      memo: deposit.memo || reason,
      status: 'confirmed',
      network: isPiSandboxRequest(request) ? 'testnet' : 'mainnet',
    }).catch(() => undefined)
    await recordAudit({ kind: 'deposit', actor: actor.staffId, actorName: actor.staffName, refId: `deposit:${txid}`, reason, detail: `${fromWallet} → ${toWallet} · ${piRound(amount)}Pi · 체인검증:${chainStatus}`, after: { txid, amount: deposit.amount } }).catch(() => undefined)
    return NextResponse.json({ ok: true, deposit, chainStatus, depositTotal: await depositTotals() })
  }

  if (action === 'fare') {
    const before = await getFareConfig()
    const fare = await saveFareConfig((body?.fare ?? {}) as Partial<FareConfig>)
    await recordAudit({ kind: 'fare', actor: actor.staffId, actorName: actor.staffName, reason, before, after: fare }).catch(() => undefined)
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
    // 과거에 수수료율 0으로 기록된 pending 건을 새 수수료율로 복구한다.
    const healed = await healZeroCommissionEntries(rates).catch(() => 0)
    await recordAudit({ kind: 'rates', actor: actor.staffId, actorName: actor.staffName, reason, before, after: rates }).catch(() => undefined)
    return NextResponse.json({ ok: true, rates, healed })
  }

  if (action === 'settle') {
    const id = typeof body?.id === 'string' ? body.id : ''
    const entry = await markSettlementSettled(id)
    if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await recordAudit({ kind: 'settle', actor: actor.staffId, actorName: actor.staffName, entryId: entry.id, refId: entry.refId, reason, detail: `${entry.driverName || entry.driverId} · ${entry.gross}Pi`, after: { status: entry.status, settledAt: entry.settledAt } }).catch(() => undefined)
    return NextResponse.json({ ok: true, entry })
  }

  if (action === 'settle-all') {
    const count = await markAllSettlementsSettled()
    await recordAudit({ kind: 'settle-all', actor: actor.staffId, actorName: actor.staffName, reason, detail: `${count}건 일괄 정산` }).catch(() => undefined)
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
      actor: actor.staffId, actorName: actor.staffName,
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
    await recordAudit({ kind: 'reconcile', actor: actor.staffId, actorName: actor.staffName, reason, detail: onlyDriverId ? `${onlyDriverId} 기사 ${synced}건 동기화` : `전체 ${synced}건 동기화` }).catch(() => undefined)
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
