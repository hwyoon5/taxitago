import { NextResponse } from 'next/server'
import { listDeposits } from '@/lib/deposit-store'
import { creditInboundDeposit, scanInboundDeposits } from '@/lib/deposit-scan'
import { creditUserDeposit, listUserCredits, userCreditTotals, userSpendableBalance, walletsForUid, withdrawnDepositTxids } from '@/lib/user-credit-store'
import { knownServiceTxids } from '@/lib/payment-kind-store'
import { getPiPayment } from '@/lib/pi-platform'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 플랫폼 입금 지갑으로 들어온 Pi 결제를 Horizon에서 스캔해 장부에 기록하고,
 * 호출한 이용자(지갑 주소 또는 Pi uid)에게 귀속되는 confirmed 입금만 반환한다.
 * ?from={wallet} — 해당 지갑이 보낸 입금. &uid={pi_uid} — uid로 귀속 기록된 입금.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const from = (params.get('from') || '').trim()
  const uid = (params.get('uid') || '').trim()
  const sandboxParam = (params.get('sandbox') || '').trim().toLowerCase()
  const sandboxHint = sandboxParam === 'true' ? true : sandboxParam === 'false' ? false : null
  const effectiveSandbox = isPiSandboxRequest(request, sandboxHint)
  console.log('[Deposit] GET /api/wallet/deposits', { from: from || '(none)', uid: uid || '(none)', sandboxHint, effectiveSandbox })
  // 식별자 없는 호출에는 전체 장부를 노출하지 않는다 — 이용자 조회 전용 엔드포인트.
  if (!from && !uid) {
    return NextResponse.json({ ok: true, deposits: [], configured: true })
  }
  // 스캔 자체의 예외가 라우트를 500으로 죽이지 않게 방어한다.
  const scan = await scanInboundDeposits(from, uid, effectiveSandbox).catch((error) => {
    console.error('[Deposit] GET scan threw', error)
    return { configured: true, scanned: 0, scanError: true, adminWallet: '' }
  })
  if (!scan.configured) {
    return NextResponse.json({ ok: true, deposits: [], configured: false })
  }
  if (scan.scanError) {
    return NextResponse.json({ ok: true, deposits: [], configured: true, scanError: true })
  }
  const adminWallet = scan.adminWallet
  // 스캔 범위 밖의 과거 입금도 유저별 조회에서 빠지지 않게 장부 기준으로 반환한다.
  // confirmed 건만 반환 — pending은 이용자 잔액에 반영되지 않는다.
  const entries = await listDeposits()
  // 서비스 결제로 확정된 txid는 이용자 입금이 아니다 — 잔액 크레딧 대상에서 제외.
  const serviceTxids = await knownServiceTxids().catch(() => new Set<string>())
  // 탈퇴 계정의 과거 입금 — 재가입자(동일 uid·지갑)에게 다시 귀속되면 안 된다.
  const withdrawnTxids = await withdrawnDepositTxids().catch(() => new Set<string>())
  // 클라이언트가 보내는 from은 uid 유사주소일 수 있어 실제 on-chain 주소와
  // 불일치한다 — 과거 결제로 확인된 지갑↔uid 연결로 진짜 주소 매칭도 커버.
  const linkedWallets = uid ? await walletsForUid(uid).catch(() => new Set<string>()) : new Set<string>()
  const matched = entries.filter((entry) => {
    if (entry.status !== 'confirmed') return false
    if (entry.toWallet !== adminWallet) return false
    if (serviceTxids.has(entry.txid)) return false
    if (withdrawnTxids.has(entry.txid)) return false
    return (
      (from !== '' && entry.fromWallet === from) ||
      (uid !== '' && (entry.fromUid === uid || linkedWallets.has(entry.fromWallet)))
    )
  })
  console.log('[Deposit] GET matched', { total: entries.length, matched: matched.length, uid, linkedWallets: linkedWallets.size })
  // 반환되는 입금은 이용자 크레딧 귀속도 함께 보장한다 — 장부에 있는데
  // 크레딧이 빠진 과거 건도 여기서 복구된다(txid 멱등).
  const credits = await listUserCredits()
  const creditedTxids = new Set(credits.map((credit) => credit.txid))
  for (const entry of matched) {
    if (!entry.txid || creditedTxids.has(entry.txid)) continue
    const credited = await creditUserDeposit({
      txid: entry.txid,
      wallet: entry.fromWallet,
      uid: entry.fromUid || uid,
      amount: entry.amount,
      source: 'scan',
    }).catch(() => null)
    if (credited) creditedTxids.add(entry.txid)
  }
  const deposits = matched.map((entry) => ({ ...entry, userCredited: creditedTxids.has(entry.txid) }))
  const creditsTotal = await userCreditTotals(from, uid)
  const spendable = await userSpendableBalance(from, uid)
  // balance — 누적 입금 크레딧(지출 전), spendable — 지출 차감 후 사용 가능 잔액.
  return NextResponse.json({ ok: true, configured: true, deposits, creditsTotal, balance: creditsTotal.total, spendable })
}

/**
 * 이용자 셀프 클레임 — 충전 결제의 paymentId를 소유권 증명으로 써서 완료된
 * 결제의 온체인 입금을 본인 uid에 귀속시킨다. 서버 after() 크레딧이 실패하거나
 * 스캐너가 놓친 경우의 복구 경로. Pi 결제 객체의 user_uid가 호출자 uid와
 * 일치해야만 크레딧된다 — 남의 paymentId로는 user_uid가 달라 거절된다.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    paymentId?: unknown
    txid?: unknown
    uid?: unknown
    sandbox?: unknown
  } | null
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  const txid = typeof body?.txid === 'string' ? body.txid.trim() : ''
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const sandboxHint = typeof body?.sandbox === 'boolean' ? body.sandbox : null
  const effectiveSandbox = isPiSandboxRequest(request, sandboxHint)
  console.log('[Deposit] POST claim', { paymentId: paymentId || '(empty)', txid: txid || '(empty)', uid: uid || '(empty)', effectiveSandbox })
  if (!paymentId || !uid) {
    return NextResponse.json({ error: 'paymentId and uid required' }, { status: 400 })
  }

  const info = (await getPiPayment(paymentId, effectiveSandbox).catch((error) => {
    console.error('[Deposit] claim: payment lookup failed', { paymentId, error })
    return null
  })) as Record<string, unknown> | null
  if (!info) return NextResponse.json({ error: 'payment lookup failed' }, { status: 502 })

  const transaction = info.transaction && typeof info.transaction === 'object' ? (info.transaction as Record<string, unknown>) : null
  const status = info.status && typeof info.status === 'object' ? (info.status as Record<string, unknown>) : null
  const payUid = typeof info.user_uid === 'string' ? info.user_uid.trim() : ''
  const payTxid = typeof transaction?.txid === 'string' ? transaction.txid.trim() : ''
  const completed = status?.developer_completed === true || transaction?.verified === true

  if (!payUid || payUid !== uid) {
    console.warn('[Deposit] claim denied: uid mismatch', { paymentId, uid, payUid: payUid || '(none)' })
    return NextResponse.json({ error: 'ownership not verifiable' }, { status: 403 })
  }
  if (!completed) {
    return NextResponse.json({ error: 'payment not completed' }, { status: 409 })
  }
  const resolvedTxid = txid || payTxid
  if (!resolvedTxid) return NextResponse.json({ error: 'txid unavailable' }, { status: 400 })
  if (payTxid && txid && payTxid !== txid) {
    console.warn('[Deposit] claim denied: txid mismatch', { paymentId, txid, payTxid })
    return NextResponse.json({ error: 'txid mismatch' }, { status: 400 })
  }

  const deposit = await creditInboundDeposit({
    txid: resolvedTxid,
    uid: payUid,
    fromAddress: typeof info.from_address === 'string' ? info.from_address : '',
    amount: typeof info.amount === 'number' ? info.amount : undefined,
    source: 'manual',
    sandboxHint: effectiveSandbox,
  })
  if (!deposit) return NextResponse.json({ error: 'deposit could not be credited' }, { status: 502 })
  return NextResponse.json({ ok: true, deposit })
}
