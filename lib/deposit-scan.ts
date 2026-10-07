import { Horizon } from '@stellar/stellar-sdk'
import { getAdminWallet } from '@/lib/admin-wallet'
import { isPiWalletAddress } from '@/lib/pi-wallet'
import { recordDeposit } from '@/lib/deposit-store'
import { creditUserDeposit, uidForWallet } from '@/lib/user-credit-store'
import { knownServiceTxids } from '@/lib/payment-kind-store'
import { recordWalletTx } from '@/lib/wallet-history'
import { isPiSandboxEnv } from '@/lib/pi-sandbox'

const SCAN_LIMIT = 60

function horizonUrl() {
  const override = (process.env.PI_HORIZON_URL || '').trim()
  if (override) return override
  return isPiSandboxEnv() ? 'https://api.testnet.minepi.com' : 'https://api.mainnet.minepi.com'
}

type HorizonPayment = {
  type?: string
  transaction_hash?: string
  from?: string
  to?: string
  amount?: string
  created_at?: string
}

export type DepositScanResult = {
  configured: boolean
  scanned: number
  scanError?: boolean
  adminWallet: string
}

/**
 * 플랫폼 입금 지갑으로 들어온 Pi 결제를 Horizon에서 스캔해 장부에 기록한다.
 * 수동 승인 없이 즉시 confirmed로 반영되고 (txid) 멱등이라 폴링 중복도 안전하다.
 */
export async function scanInboundDeposits(viewerWallet = '', viewerUid = ''): Promise<DepositScanResult> {
  const adminWallet = (await getAdminWallet()).trim()
  if (!isPiWalletAddress(adminWallet)) {
    console.warn('[Deposit] scan skipped: admin wallet not configured', { adminWallet: adminWallet || '(empty)' })
    return { configured: false, scanned: 0, adminWallet }
  }
  let records: HorizonPayment[] = []
  try {
    const server = new Horizon.Server(horizonUrl())
    const page = await server.payments().forAccount(adminWallet).order('desc').limit(SCAN_LIMIT).call()
    records = page.records as HorizonPayment[]
  } catch (error) {
    console.error('[Deposit] horizon scan failed', { adminWallet, error })
    return { configured: true, scanned: 0, scanError: true, adminWallet }
  }
  const inbound = records.filter(
    (record) => record.type === 'payment' && record.to === adminWallet && record.transaction_hash && record.from,
  )
  // 서비스 결제(탑승비 등)로 확정된 txid는 입금 장부·유저 크레딧에서 제외한다 —
  // 승객이 낸 요금이 '입금'으로 되돌아가는 이중 크레딧 방지.
  const serviceTxids = await knownServiceTxids().catch(() => new Set<string>())
  console.log('[Deposit] scan', { inbound: inbound.length, viewerUid: viewerUid || '(none)', serviceTxids: serviceTxids.size })
  for (const record of inbound) {
    if (serviceTxids.has(record.transaction_hash!)) {
      console.log('[Deposit] scan skip: service payment txid', { txid: record.transaction_hash })
      continue
    }
    const amount = Number(record.amount)
    // 이용자 귀속 uid: ①호출자 지갑 직접 일치 ②지갑→uid 매핑(과거 결제로 확인된 연결)
    const knownUid =
      record.from === viewerWallet && viewerUid
        ? viewerUid
        : await uidForWallet(record.from!).catch(() => '')
    const deposit = await recordDeposit({
      txid: record.transaction_hash!,
      fromWallet: record.from!,
      fromUid: knownUid || undefined,
      toWallet: adminWallet,
      amount,
      seenAt: record.created_at,
      status: 'confirmed',
    }).catch((error) => {
      console.error('[Deposit] scan recordDeposit failed', { txid: record.transaction_hash, error })
      return null
    })
    console.log('[Deposit] scan entry', { txid: record.transaction_hash, from: record.from, amount, uid: knownUid || '(unresolved)', recorded: Boolean(deposit) })
    if (deposit) {
      await recordWalletTx({
        kind: 'deposit',
        txid: deposit.txid,
        fromWallet: deposit.fromWallet,
        toWallet: deposit.toWallet,
        amount: deposit.amount,
        memo: deposit.memo,
        status: 'confirmed',
        network: isPiSandboxEnv() ? 'testnet' : 'mainnet',
      }).catch(() => undefined)
      // 이용자 잔액 귀속 — 장부 기록과 같은 지점에서 반드시 남긴다(txid 멱등).
      await creditUserDeposit({
        txid: deposit.txid,
        wallet: deposit.fromWallet,
        uid: deposit.fromUid || knownUid,
        amount: deposit.amount,
        source: 'scan',
      }).catch(() => undefined)
    }
  }
  return { configured: true, scanned: inbound.length, adminWallet }
}

/**
 * 검증된 인바운드 입금 1건을 장부+지갑내역+유저 크레딧에 원자적으로 반영한다.
 * sender/amount는 온체인 op가 권위이고 없으면 전달된 검증 값으로 폴백.
 * uid는 호출자가 준 값 → 지갑→uid 매핑 순으로 해석한다.
 */
export async function creditInboundDeposit(input: {
  txid: string
  uid?: string
  fromAddress?: string
  amount?: number
  seenAt?: string
  source?: 'scan' | 'manual'
}) {
  const txid = input.txid.trim()
  const adminWallet = (await getAdminWallet()).trim()
  if (!adminWallet) {
    console.warn('[Deposit] creditInboundDeposit skipped: admin wallet not configured', { txid })
    return null
  }
  const op = await fetchInboundPaymentOp(txid, adminWallet)
  const from = op?.from || (input.fromAddress || '').trim()
  const amount = op?.amount && op.amount > 0 ? op.amount : Number(input.amount) || 0
  const uid =
    (input.uid || '').trim() ||
    (from ? await uidForWallet(from).catch(() => '') : '')
  if (!from || !(amount > 0)) {
    console.warn('[Deposit] creditInboundDeposit skipped: sender/amount unresolved', {
      txid,
      hasOnChainOp: Boolean(op),
      fallbackFrom: Boolean(input.fromAddress),
      fallbackAmount: input.amount ?? null,
    })
    return null
  }
  const deposit = await recordDeposit({
    txid,
    fromWallet: from,
    fromUid: uid || undefined,
    toWallet: adminWallet,
    amount,
    status: 'confirmed',
    seenAt: input.seenAt ?? op?.createdAt,
  }).catch((error) => {
    console.error('[Deposit] recordDeposit failed', { txid, from, amount, error })
    return null
  })
  if (!deposit) return null
  await Promise.all([
    creditUserDeposit({
      txid,
      wallet: deposit.fromWallet,
      uid: deposit.fromUid || uid,
      amount: deposit.amount,
      source: input.source ?? 'scan',
    }).catch((error) => console.error('[Deposit] user credit write failed', { txid, error })),
    recordWalletTx({
      kind: 'deposit',
      txid: deposit.txid,
      fromWallet: deposit.fromWallet,
      toWallet: deposit.toWallet,
      amount: deposit.amount,
      memo: deposit.memo,
      status: 'confirmed',
      network: isPiSandboxEnv() ? 'testnet' : 'mainnet',
    }).catch((error) => console.error('[Deposit] wallet history write failed', { txid, error })),
  ])
  console.log('[Deposit] inbound credited', { txid, from, amount, uid: deposit.fromUid || uid || '(none)' })
  return deposit
}

export type DepositChainCheck = 'verified' | 'mismatch' | 'unknown'

/**
 * 완료된 결제의 온체인 payment op를 조회 — 보낸 주소와 실제 금액을
 * 체인에서 꺼낸다(클라이언트가 보낸 금액이 아니라 온체인 값이 권위).
 */
export async function fetchInboundPaymentOp(
  txid: string,
  toWallet: string,
): Promise<{ from: string; amount: number; createdAt?: string } | null> {
  try {
    const res = await fetch(`${horizonUrl()}/transactions/${encodeURIComponent(txid)}/operations?limit=30`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const payload = (await res.json().catch(() => null)) as {
      _embedded?: { records?: { type?: string; from?: string; to?: string; amount?: string; created_at?: string }[] }
    } | null
    const op = payload?._embedded?.records?.find(
      (record) => record.type === 'payment' && record.to === toWallet && record.from,
    )
    if (!op?.from) return null
    return {
      from: String(op.from),
      amount: Number(op.amount),
      createdAt: typeof op.created_at === 'string' ? op.created_at : undefined,
    }
  } catch {
    return null
  }
}

/**
 * 수동 입금 동기화 전 온체인 교차 확인.
 * verified: tx 성공 + payment op(from/to/amount) 일치
 * mismatch: tx는 존재하지만 실패했거나 입금 정보가 불일치
 * unknown: 아직 전파되지 않았거나(404) Horizon을 확인할 수 없음 — 기록은 허용
 */
export async function checkInboundPayment(input: {
  txid: string
  from: string
  to: string
  amount: number
}): Promise<DepositChainCheck> {
  const base = horizonUrl()
  const txUrl = `${base}/transactions/${encodeURIComponent(input.txid)}`
  try {
    const res = await fetch(txUrl, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (res.status === 404 || !res.ok) return 'unknown'
    const tx = (await res.json().catch(() => null)) as { successful?: boolean } | null
    if (tx?.successful === false) return 'mismatch'
  } catch {
    return 'unknown'
  }
  try {
    const opsUrl = `${txUrl}/operations?limit=30`
    const res = await fetch(opsUrl, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return 'unknown'
    const payload = (await res.json().catch(() => null)) as {
      _embedded?: { records?: { type?: string; from?: string; to?: string; amount?: string }[] }
    } | null
    const matched = payload?._embedded?.records?.some(
      (op) =>
        op.type === 'payment' &&
        op.to === input.to &&
        op.from === input.from &&
        Math.abs(Number(op.amount) - input.amount) < 0.000_001,
    )
    return matched ? 'verified' : 'mismatch'
  } catch {
    return 'unknown'
  }
}
