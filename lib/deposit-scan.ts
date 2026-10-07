import { Horizon } from '@stellar/stellar-sdk'
import { getAdminWallet } from '@/lib/admin-wallet'
import { isPiWalletAddress } from '@/lib/pi-wallet'
import { recordDeposit } from '@/lib/deposit-store'
import { creditUserDeposit } from '@/lib/user-credit-store'
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
    return { configured: false, scanned: 0, adminWallet }
  }
  let records: HorizonPayment[] = []
  try {
    const server = new Horizon.Server(horizonUrl())
    const page = await server.payments().forAccount(adminWallet).order('desc').limit(SCAN_LIMIT).call()
    records = page.records as HorizonPayment[]
  } catch {
    return { configured: true, scanned: 0, scanError: true, adminWallet }
  }
  const inbound = records.filter(
    (record) => record.type === 'payment' && record.to === adminWallet && record.transaction_hash && record.from,
  )
  // 서비스 결제(탑승비 등)로 확정된 txid는 입금 장부·유저 크레딧에서 제외한다 —
  // 승객이 낸 요금이 '입금'으로 되돌아가는 이중 크레딧 방지.
  const serviceTxids = await knownServiceTxids().catch(() => new Set<string>())
  for (const record of inbound) {
    if (serviceTxids.has(record.transaction_hash!)) continue
    const amount = Number(record.amount)
    const deposit = await recordDeposit({
      txid: record.transaction_hash!,
      fromWallet: record.from!,
      fromUid: record.from === viewerWallet ? viewerUid || undefined : undefined,
      toWallet: adminWallet,
      amount,
      seenAt: record.created_at,
      status: 'confirmed',
    }).catch(() => null)
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
        uid: deposit.fromUid || (record.from === viewerWallet ? viewerUid : ''),
        amount: deposit.amount,
        source: 'scan',
      }).catch(() => undefined)
    }
  }
  return { configured: true, scanned: inbound.length, adminWallet }
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
