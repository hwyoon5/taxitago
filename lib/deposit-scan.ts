import { Horizon } from '@stellar/stellar-sdk'
import { getAdminWallet } from '@/lib/admin-wallet'
import { isPiWalletAddress } from '@/lib/pi-wallet'
import { recordDeposit } from '@/lib/deposit-store'
import { uidForWallet } from '@/lib/user-credit-store'
import { knownServiceTxids } from '@/lib/payment-kind-store'
import { recordWalletTx } from '@/lib/wallet-history'
import { dataNetwork } from '@/lib/kv'
import type { PiNetworkMode } from '@/lib/pi-sandbox'

const SCAN_LIMIT = 60

const TESTNET_HORIZON = 'https://api.testnet.minepi.com'
const MAINNET_HORIZON = 'https://api.mainnet.minepi.com'

type HorizonPick = { base: string; network: PiNetworkMode | null }

/**
 * 조회할 Horizon — 네트워크 하나만 쓴다. 양 네트워크를 순회 스캔하면 반대쪽
 * 체인의 입금이 현재 장부 스코프에 섞여 들어오므로 금지한다(테스트넷↔메인넷
 * 장부 분리 원칙).
 * - sandboxHint가 있으면 그 네트워크(호출자가 tx가 올라간 곳을 아는 경우).
 * - 없으면 장부 스코프(dataNetwork) 네트워크 — 기록이 가는 곳과 조회가 가는
 *   곳을 항상 일치시킨다.
 * - PI_HORIZON_URL_TESTNET/_MAINNET → 공용 PI_HORIZON_URL → 공식 호스트 순.
 */
function horizonPick(sandboxHint?: boolean | null): HorizonPick {
  const hinted = typeof sandboxHint === 'boolean' ? (sandboxHint ? 'testnet' : 'mainnet') : null
  const network = hinted ?? dataNetwork()
  const scoped = (
    network === 'testnet' ? process.env.PI_HORIZON_URL_TESTNET : process.env.PI_HORIZON_URL_MAINNET
  )?.trim()
  const override = scoped || (process.env.PI_HORIZON_URL || '').trim()
  if (override) return { base: override, network: null }
  return { base: network === 'testnet' ? TESTNET_HORIZON : MAINNET_HORIZON, network }
}

type HorizonPayment = {
  type?: string
  transaction_hash?: string
  from?: string
  to?: string
  amount?: string
  created_at?: string
  /** 이 레코드를 찾은 네트워크 — 스캔이 양쪽 Horizon을 순회하므로 레코드별로 남긴다. */
  network?: 'testnet' | 'mainnet'
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
export async function scanInboundDeposits(
  viewerWallet = '',
  viewerUid = '',
  sandboxHint?: boolean | null,
): Promise<DepositScanResult> {
  const adminWallet = (await getAdminWallet()).trim()
  if (!isPiWalletAddress(adminWallet)) {
    console.warn('[Deposit] scan skipped: admin wallet not configured', { adminWallet: adminWallet || '(empty)' })
    return { configured: false, scanned: 0, adminWallet }
  }
  // 장부 스코프(dataNetwork)의 네트워크 하나만 스캔한다 — 반대쪽 체인 입금이
  // 이 스코프 장부에 섞여 들어오는 것을 막는다. 호출자 힌트가 스코프와 다르면
  // env/클라이언트 네트워크 불일치이므로 경고만 남기고 스코프를 따른다.
  const scope = dataNetwork()
  if (typeof sandboxHint === 'boolean' && (sandboxHint ? 'testnet' : 'mainnet') !== scope) {
    console.warn('[Deposit] scan hint differs from ledger scope; scanning ledger scope only', { hint: sandboxHint, scope })
  }
  const pick = horizonPick(null)
  const bases = [pick.base]
  const network = pick.network
  const records: HorizonPayment[] = []
  const failedBases: string[] = []
  try {
    const server = new Horizon.Server(pick.base)
    const page = await server.payments().forAccount(adminWallet).order('desc').limit(SCAN_LIMIT).call()
    for (const record of page.records as HorizonPayment[]) {
      records.push({ ...record, network: network ?? undefined })
    }
  } catch (error) {
    failedBases.push(pick.base)
    console.warn('[Deposit] horizon scan failed', { base: pick.base, adminWallet, error: error instanceof Error ? error.message : String(error) })
  }
  const allFailed = failedBases.length === bases.length
  if (allFailed) console.error('[Deposit] horizon scan failed', { adminWallet, base: pick.base, network: scope })
  // txid로 dedupe한다 — 같은 tx를 두 번 기록하지 않는다.
  const seen = new Set<string>()
  const inbound = records.filter((record) => {
    if (record.type !== 'payment' || record.to !== adminWallet || !record.transaction_hash || !record.from) return false
    if (seen.has(record.transaction_hash)) return false
    seen.add(record.transaction_hash)
    return true
  })
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
        network: record.network ?? dataNetwork(),
      }).catch((error) => console.error('[Deposit] scan wallet-history write failed', { txid: deposit.txid, error }))
      // 사전 충전 폐지 — 입금은 감사 장부에만 기록하고 이용자 잔액 크레딧은
      // 더 이상 부여하지 않는다. 서비스 요금은 종료 시점 Pi 직결제로 정산된다.
    }
  }
  return { configured: true, scanned: inbound.length, scanError: allFailed || undefined, adminWallet }
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
  sandboxHint?: boolean | null
}) {
  const txid = input.txid.trim()
  const adminWallet = (await getAdminWallet()).trim()
  if (!adminWallet) {
    console.warn('[Deposit] creditInboundDeposit skipped: admin wallet not configured', { txid })
    return null
  }
  const scope = dataNetwork()
  if (
    typeof input.sandboxHint === 'boolean' &&
    (input.sandboxHint ? 'testnet' : 'mainnet') !== scope
  ) {
    // 힌트 네트워크가 장부 스코프와 다르면 반대쪽 체인의 tx를 이 스코프 장부에
    // 쓰게 된다 — 기록하지 않는다.
    console.warn('[Deposit] creditInboundDeposit skipped: hint network differs from ledger scope', {
      txid,
      hint: input.sandboxHint,
      scope,
    })
    return null
  }
  const op = await fetchInboundPaymentOp(txid, adminWallet, input.sandboxHint)
  if (op?.network && op.network !== scope) {
    console.warn('[Deposit] creditInboundDeposit skipped: on-chain network differs from ledger scope', {
      txid,
      onchain: op.network,
      scope,
    })
    return null
  }
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
  // 사전 충전 폐지 — 입금 내역만 장부에 남기고 이용자 잔액 크레딧은 부여하지 않는다.
  await recordWalletTx({
    kind: 'deposit',
    txid: deposit.txid,
    fromWallet: deposit.fromWallet,
    toWallet: deposit.toWallet,
    amount: deposit.amount,
    memo: deposit.memo,
    status: 'confirmed',
    network: scope,
  }).catch((error) => console.error('[Deposit] wallet history write failed', { txid, error }))
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
  sandboxHint?: boolean | null,
): Promise<{ from: string; amount: number; createdAt?: string; network?: 'testnet' | 'mainnet' } | null> {
  // 힌트(결제가 생성된 네트워크) 또는 장부 스코프 네트워크 하나만 조회한다 —
  // 반대쪽 체인의 동일 txid를 찾아 다른 네트워크 장부에 기록하는 것을 막는다.
  const pick = horizonPick(sandboxHint)
  try {
    const res = await fetch(`${pick.base}/transactions/${encodeURIComponent(txid)}/operations?limit=30`, {
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
      network: pick.network ?? undefined,
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
  sandboxHint?: boolean | null
}): Promise<DepositChainCheck> {
  // 힌트 네트워크(없으면 장부 스코프) 하나만 확인한다 — 반대쪽 체인의 tx를
  // 이 스코프 장부의 근거로 쓰지 않기 위함이다.
  const { base } = horizonPick(input.sandboxHint)
  const txUrl = `${base}/transactions/${encodeURIComponent(input.txid)}`
  try {
    const res = await fetch(txUrl, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (res.status === 404) return 'mismatch' // 이 네트워크에는 해당 tx가 없다.
    if (!res.ok) return 'unknown'
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
