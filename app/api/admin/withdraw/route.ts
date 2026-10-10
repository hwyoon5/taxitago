import { NextResponse } from 'next/server'
import { adminActor, type AdminActor } from '@/lib/admin-auth'
import { isPiWalletAddress, piWalletError } from '@/lib/pi-wallet'
import { recordAudit } from '@/lib/audit-store'
import { listSettlements } from '@/lib/settlement-store'
import { walletTxTotals } from '@/lib/wallet-history'
import { sendPiToAddress } from '@/lib/pi-direct-send'
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

/** 정산 가능 수수료 잔액 — 누적 수수료에서 출금·수수료·리뷰 보상 지출을 차감한 값. */
async function availableFeeBalance(): Promise<number> {
  const [entries, totals] = await Promise.all([listSettlements(), walletTxTotals()])
  const commission = entries.reduce((sum, entry) => sum + entry.commission, 0)
  // 이용자 잔액 반환(feeWithdraw 제외분)은 수익 인출이 아니므로 수수료 가용액에서 빼지 않는다.
  const available = commission - (totals.feeWithdraw?.total ?? totals.withdraw.total) - (totals.feeWithdraw?.fee ?? totals.withdraw.fee) - (totals.reward?.total ?? 0)
  return Math.max(0, piRound(available))
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
  const sent = await sendPiToAddress({ recipient, amount, memoText, reason, purpose: 'fee', sandbox })
  if (!sent.ok) return sent
  await recordAudit({
    kind: 'withdraw',
    actor: actor.staffId,
    actorName: actor.staffName,
    refId: `withdraw:${sent.txid}`,
    reason: reason || memoText,
    detail: `${sent.fromWallet} → ${recipient} · ${amount.toFixed(7)}Pi (${sent.network})`,
    after: { txid: sent.txid, amount, recipient },
  }).catch(() => undefined)
  return sent
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
