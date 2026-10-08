import { NextResponse } from 'next/server'
import { Account, Asset, Horizon, Keypair, Memo, Operation, TransactionBuilder } from '@stellar/stellar-sdk'
import { adminActor, type AdminActor } from '@/lib/admin-auth'
import { isPiWalletAddress, piWalletError } from '@/lib/pi-wallet'
import { getAdminWallet, saveAdminWallet } from '@/lib/admin-wallet'
import { ADMIN_WALLET_SECRET_ENV, adminWalletSecret } from '@/lib/admin-wallet-secret'
import { recordAudit } from '@/lib/audit-store'
import { listSettlements } from '@/lib/settlement-store'
import { recordWalletTx, walletTxTotals } from '@/lib/wallet-history'
import { piRound } from '@/lib/pi-format'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'
import {
  APPROVAL_THRESHOLD_PI,
  STAFF_DAILY_LIMIT_PI,
  STAFF_HOURLY_MAX_COUNT,
  getWithdrawalRequest,
  listWithdrawalRequests,
  markWithdrawalApproved,
  markWithdrawalFailed,
  markWithdrawalRejected,
  queueWithdrawal,
  recordSentWithdrawal,
  staffRecentSends,
} from '@/lib/withdrawal-queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_WITHDRAW_PI = 10_000
/** Pi mainnet requires a 0.01 Pi base fee (100_000 stroops); pay at least that everywhere. */
const MIN_FEE_STROOPS = 100_000

/** 정산 가능 수수료 잔액 — 누적 수수료에서 출금·수수료·리뷰 보상 지출을 차감한 값. */
async function availableFeeBalance(): Promise<number> {
  const [entries, totals] = await Promise.all([listSettlements(), walletTxTotals()])
  const commission = entries.reduce((sum, entry) => sum + entry.commission, 0)
  const available = commission - totals.withdraw.total - totals.withdraw.fee - (totals.reward?.total ?? 0)
  return Math.max(0, piRound(available))
}

function horizonFor(sandbox: boolean) {
  const url = (process.env.PI_HORIZON_URL || '').trim()
  const passphrase =
    (process.env.PI_NETWORK_PASSPHRASE || '').trim() || (sandbox ? 'Pi Testnet' : 'Pi Network')
  if (url) return { url, passphrase }
  return sandbox
    ? { url: 'https://api.testnet.minepi.com', passphrase: 'Pi Testnet' }
    : { url: 'https://api.mainnet.minepi.com', passphrase: 'Pi Network' }
}

function horizonError(error: unknown): string {
  const data = (error as {
    response?: { data?: { extras?: { result_codes?: Record<string, string> }; detail?: string } }
  })?.response?.data
  const codes = data?.extras?.result_codes ?? {}
  const op = codes.operations
  if (op === 'op_underfunded' || codes.transaction === 'tx_insufficient_balance') {
    return '관리자 지갑 잔액이 부족합니다.'
  }
  if (op === 'op_no_destination') return '수신 주소가 네트워크에 존재하지 않습니다. (활성화되지 않은 계정)'
  if (op === 'op_malformed') return '수신 주소 또는 금액 형식이 올바르지 않습니다.'
  if (codes.transaction === 'tx_bad_seq') return '시퀀스 충돌입니다. 잠시 후 다시 시도해 주세요.'
  if (codes.transaction === 'tx_insufficient_fee') return '네트워크 수수료가 부족합니다. 잠시 후 다시 시도해 주세요.'
  if (codes.transaction === 'tx_bad_auth' || codes.transaction === 'tx_bad_auth_extra') {
    return '트랜잭션 서명이 올바르지 않습니다.'
  }
  if (codes.transaction === 'tx_failed') return '네트워크가 트랜잭션을 거부했습니다.'
  if (typeof data?.detail === 'string' && data.detail) return data.detail
  if (error instanceof Error && error.message) return error.message
  return '출금 트랜잭션에 실패했습니다.'
}

/** 실제 체인 송금 — 직접 실행과 마스터 승인 경로가 공유한다. */
async function executeWithdrawal(input: {
  recipient: string
  amount: number
  memoText: string
  reason: string
  actor: AdminActor
  sandbox: boolean
}): Promise<{ ok: true; txid: string; ledger: number | bigint; network: string } | { ok: false; status: number; error: string }> {
  const { recipient, amount, memoText, reason, actor, sandbox } = input
  const secret = adminWalletSecret()
  if (!secret) {
    return { ok: false, status: 500, error: `${ADMIN_WALLET_SECRET_ENV} 환경 변수가 설정되지 않았습니다.` }
  }
  let keypair: Keypair
  try {
    keypair = Keypair.fromSecret(secret)
  } catch {
    return { ok: false, status: 500, error: '관리자 지갑 비밀 키 형식이 올바르지 않습니다. (S로 시작하는 56자리 시드)' }
  }

  // The secret must control the configured admin wallet — otherwise an env
  // mismatch would silently send funds from a different wallet than expected.
  const adminWallet = await getAdminWallet()
  if (isPiWalletAddress(adminWallet) && adminWallet !== keypair.publicKey()) {
    return { ok: false, status: 409, error: '비밀 키가 등록된 관리자 지갑 주소와 일치하지 않습니다.' }
  }
  // 아직 데모 플레이스홀더만 등록되어 있다면 시드에서 파생된 공개 주소를
  // 관리자 지갑으로 자동 등록해 추가 설정 없이 바로 출금할 수 있게 한다.
  if (!isPiWalletAddress(adminWallet)) {
    await saveAdminWallet(keypair.publicKey()).catch(() => undefined)
  }

  const { url, passphrase } = horizonFor(sandbox)
  const recordFailed = (message: string) =>
    recordWalletTx({
      kind: 'withdraw',
      fromWallet: keypair.publicKey(),
      toWallet: recipient,
      amount,
      memo: reason || memoText,
      status: 'failed',
      error: message,
      network: sandbox ? 'testnet' : 'mainnet',
    }).catch(() => undefined)

  try {
    const server = new Horizon.Server(url)
    const record = await server.accounts().accountId(keypair.publicKey()).call()
    const account = new Account(keypair.publicKey(), record.sequence)
    const native = record.balances.find((line) => line.asset_type === 'native')
    const balance = Number(native?.balance ?? '0')
    const baseFee = await server.fetchBaseFee().catch(() => 0)
    const fee = Math.max(baseFee || 0, MIN_FEE_STROOPS)
    const feePi = fee / 1e7
    if (Number.isFinite(balance) && balance < amount + feePi) {
      const message = `관리자 지갑 잔액이 부족합니다. 잔액 ${balance.toFixed(7)} Pi < 필요 ${(amount + feePi).toFixed(7)} Pi (수수료 포함)`
      await recordFailed(message)
      return { ok: false, status: 400, error: message }
    }
    const builder = new TransactionBuilder(account, { fee: String(fee), networkPassphrase: passphrase })
      .addOperation(
        Operation.payment({ destination: recipient, asset: Asset.native(), amount: amount.toFixed(7) }),
      )
      .setTimeout(180)
    if (memoText) builder.addMemo(Memo.text(memoText))
    const transaction = builder.build()
    transaction.sign(keypair)
    const result = await server.submitTransaction(transaction, { skipMemoRequiredCheck: true })
    await recordWalletTx({
      kind: 'withdraw',
      txid: result.hash,
      fromWallet: keypair.publicKey(),
      toWallet: recipient,
      amount,
      memo: reason || memoText,
      status: 'confirmed',
      fee: feePi,
      network: sandbox ? 'testnet' : 'mainnet',
    }).catch(() => undefined)
    await recordAudit({
      kind: 'withdraw',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `withdraw:${result.hash}`,
      reason: reason || memoText,
      detail: `${keypair.publicKey()} → ${recipient} · ${amount.toFixed(7)}Pi (${sandbox ? 'testnet' : 'mainnet'})`,
      after: { txid: result.hash, amount, recipient },
    }).catch(() => undefined)
    return { ok: true, txid: result.hash, ledger: result.ledger, network: sandbox ? 'testnet' : 'mainnet' }
  } catch (error) {
    const message = horizonError(error)
    await recordFailed(message)
    return { ok: false, status: 502, error: message }
  }
}

export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const [requests, available] = await Promise.all([listWithdrawalRequests(), availableFeeBalance()])
  return NextResponse.json({
    ok: true,
    requests,
    approvalThreshold: APPROVAL_THRESHOLD_PI,
    staffDailyLimit: STAFF_DAILY_LIMIT_PI,
    staffHourlyMax: STAFF_HOURLY_MAX_COUNT,
    available,
  })
}

export async function POST(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as {
    action?: unknown
    id?: unknown
    recipientAddress?: unknown
    amount?: unknown
    memo?: unknown
    reason?: unknown
  } | null
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

  // ---- 마스터 승인함: 대기 중인 출금 승인/거절 ----
  if (body?.action === 'approve' || body?.action === 'reject') {
    if (actor.role !== 'master') {
      return NextResponse.json({ error: 'master_only' }, { status: 403 })
    }
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    const pending = id ? await getWithdrawalRequest(id) : null
    if (!pending || pending.status !== 'pending') {
      return NextResponse.json({ error: 'not_found_or_decided' }, { status: 404 })
    }
    if (body.action === 'reject') {
      const entry = await markWithdrawalRejected(id, actor)
      await recordAudit({
        kind: 'withdraw',
        actor: actor.staffId,
        actorName: actor.staffName,
        refId: `withdraw-req:${id}`,
        reason,
        detail: `승인 대기 출금 거절 · ${pending.amount.toFixed(7)}Pi → ${pending.recipient.slice(0, 12)}… (요청: ${pending.requestedByName || pending.requestedBy})`,
      }).catch(() => undefined)
      return NextResponse.json({ ok: true, request: entry })
    }
    // 승인 — 실제 체인 송금을 지금 실행한다.
    const sent = await executeWithdrawal({
      recipient: pending.recipient,
      amount: pending.amount,
      memoText: pending.memo,
      reason: pending.reason,
      actor,
      sandbox: isPiSandboxRequest(request),
    })
    if (!sent.ok) {
      await markWithdrawalFailed(id, sent.error).catch(() => undefined)
      return NextResponse.json({ error: sent.error }, { status: sent.status })
    }
    const entry = await markWithdrawalApproved(id, actor, sent.txid)
    await recordAudit({
      kind: 'withdraw',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `withdraw-req:${id}`,
      detail: `승인 대기 출금 승인·전송 완료 · ${pending.amount.toFixed(7)}Pi (요청: ${pending.requestedByName || pending.requestedBy})`,
      after: { txid: sent.txid },
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, approved: true, txid: sent.txid, request: entry })
  }

  // ---- 출금 요청 ----
  const recipient = typeof body?.recipientAddress === 'string' ? body.recipientAddress.trim() : ''
  if (!isPiWalletAddress(recipient)) {
    return NextResponse.json(
      { error: piWalletError(recipient) ?? '수신 지갑 주소가 올바르지 않습니다.' },
      { status: 400 },
    )
  }
  const amount = piRound(Number(body?.amount))
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_WITHDRAW_PI) {
    return NextResponse.json(
      { error: `출금 금액은 0보다 크고 ${MAX_WITHDRAW_PI.toLocaleString('ko-KR')} Pi 이하여야 합니다.` },
      { status: 400 },
    )
  }
  const memoText = typeof body?.memo === 'string' ? body.memo.trim() : ''
  if (memoText && Buffer.byteLength(memoText, 'utf8') > 28) {
    return NextResponse.json({ error: '메모는 28바이트를 초과할 수 없습니다.' }, { status: 400 })
  }

  // 직원 계정의 송금은 한도·반복 감지를 거쳐 조건 초과 시 승인 대기로 전환한다.
  if (actor.role !== 'master') {
    let flag = ''
    if (amount > APPROVAL_THRESHOLD_PI) {
      flag = `고액 송금 (건당 한도 ${APPROVAL_THRESHOLD_PI}Pi 초과)`
    } else {
      const daySends = await staffRecentSends(actor.staffId, 24 * 60 * 60 * 1000)
      const dayTotal = daySends.reduce((sum, item) => sum + item.amount, 0)
      const hourSends = await staffRecentSends(actor.staffId, 60 * 60 * 1000)
      if (dayTotal + amount > STAFF_DAILY_LIMIT_PI) {
        flag = `일일 누적 한도 초과 (24h ${dayTotal.toFixed(2)}Pi + 이번 ${amount}Pi > ${STAFF_DAILY_LIMIT_PI}Pi)`
      } else if (hourSends.length >= STAFF_HOURLY_MAX_COUNT) {
        flag = `연속 송금 감지 (1시간 내 ${hourSends.length}건)`
      }
    }
    if (flag) {
      const entry = await queueWithdrawal({
        recipient,
        amount,
        memo: memoText,
        reason,
        requestedBy: actor.staffId,
        requestedByName: actor.staffName,
        flag,
      })
      await recordAudit({
        kind: 'withdraw',
        actor: actor.staffId,
        actorName: actor.staffName,
        refId: `withdraw-req:${entry.id}`,
        reason,
        detail: `출금 승인 요청 · ${amount.toFixed(7)}Pi → ${recipient.slice(0, 12)}… (${flag})`,
        after: { amount, recipient, status: 'pending', flag },
      }).catch(() => undefined)
      return NextResponse.json({ ok: true, pending: true, flag, request: entry })
    }
  }

  // 직원은 정산 가능 수수료 잔액을 넘는 금액을 즉시 송금할 수 없다.
  if (actor.role !== 'master') {
    const available = await availableFeeBalance()
    if (amount > available) {
      return NextResponse.json(
        { error: `정산 가능 수수료 잔액(${available.toFixed(7)} Pi)을 초과하는 금액은 출금할 수 없습니다.` },
        { status: 400 },
      )
    }
  }

  const sent = await executeWithdrawal({
    recipient,
    amount,
    memoText,
    reason,
    actor,
    sandbox: isPiSandboxRequest(request),
  })
  if (!sent.ok) {
    return NextResponse.json({ error: sent.error }, { status: sent.status })
  }
  await recordSentWithdrawal({
    recipient,
    amount,
    memo: memoText,
    reason,
    requestedBy: actor.staffId,
    requestedByName: actor.staffName,
    txid: sent.txid,
  }).catch(() => undefined)
  return NextResponse.json({
    ok: true,
    txid: sent.txid,
    ledger: sent.ledger,
    amount,
    recipient,
    network: sent.network,
  })
}
