import { NextResponse } from 'next/server'
import { createA2UPayment, inspectPiAccessToken } from '@/lib/pi-platform'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'
import { piRound } from '@/lib/pi-format'
import { recordUserSpend, userSpendableBalance } from '@/lib/user-credit-store'
import { recordSentWithdrawal } from '@/lib/withdrawal-queue'
import { recordAudit } from '@/lib/audit-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 1회 출금 상한 — 이상 요청 차단용 가드레일. */
const MAX_WITHDRAW_PI = 500

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const inFlight = new Set<string>()

/** requestId 단위 멱등 — 같은 요청의 재시도가 이중 송금을 만들지 못한다. */
async function claimWithdraw(requestId: string): Promise<boolean> {
  if (useKv) {
    const res = await fetch(kvUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', `taxitago:withdraw:${requestId}`, '1', 'NX', 'PX', 24 * 60 * 60 * 1000]),
      cache: 'no-store',
    }).catch(() => null)
    if (!res) return false
    const data = (await res.json().catch(() => ({}))) as { result?: string | null }
    return data.result === 'OK'
  }
  if (inFlight.has(requestId)) return false
  inFlight.add(requestId)
  return true
}

/**
 * 이용자 잔액 출금 — 서버 장부(spendable)를 확인한 뒤 플랫폼 지갑에서
 * 이용자의 Pi 계정(uid)으로 A2U 송금하고, 송금 성공이 확인되면 지출 장부에
 * txid와 함께 차감을 기록한다. 송금 실패 시 아무 장부도 차감되지 않는다.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    uid?: unknown
    wallet?: unknown
    amount?: unknown
    requestId?: unknown
    accessToken?: unknown
    sandbox?: unknown
  } | null
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const wallet = typeof body?.wallet === 'string' ? body.wallet.trim() : ''
  const amount = piRound(Number(body?.amount))
  const requestId = typeof body?.requestId === 'string' && body.requestId.trim() ? body.requestId.trim() : crypto.randomUUID()
  if (!uid) return NextResponse.json({ ok: false, error: 'Pi 계정 연동 후 출금할 수 있습니다.' }, { status: 400 })
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_WITHDRAW_PI) {
    return NextResponse.json({ ok: false, error: '출금 금액을 확인해 주세요.' }, { status: 400 })
  }
  const sandbox = isPiSandboxRequest(request, typeof body?.sandbox === 'boolean' ? body.sandbox : null)

  // 1. 인증 — 출금 요청자가 해당 Pi uid 소유자인지 토큰으로 검증한다
  // (partner/link DELETE와 동일 정책: 메인넷 fail-closed, 테스트넷은 unreachable 통과).
  const sandboxSession = sandbox && uid === 'sandbox-uid-taxitago'
  if (!sandboxSession) {
    const token =
      request.headers.get('x-pi-access-token')?.trim() ||
      (typeof body?.accessToken === 'string' ? body.accessToken.trim() : '')
    if (!token) {
      return NextResponse.json({ ok: false, error: 'Pi 계정 인증이 필요합니다. 다시 로그인해 주세요.' }, { status: 401 })
    }
    const inspection = await inspectPiAccessToken(token, sandbox)
    const verifiedUid = inspection.status === 'ok' ? inspection.uid : null
    const allowed = verifiedUid === uid || (sandbox && inspection.status === 'unreachable')
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'Pi 인증이 만료되었거나 확인되지 않았습니다. 다시 로그인해 주세요.' }, { status: 401 })
    }
  }

  // 2. 멱등 — 같은 requestId의 재시도는 한 번만 처리한다.
  if (!(await claimWithdraw(requestId))) {
    return NextResponse.json({ ok: false, error: '이미 처리 중이거나 완료된 출금 요청입니다.' }, { status: 409 })
  }

  // 3. 잔액 — 서버 장부(크레딧−지출)가 권위. 부족하면 송금 시도 자체를 안 한다.
  let spendable = 0
  try {
    spendable = Number(await userSpendableBalance(wallet, uid)) || 0
  } catch (error) {
    console.error('[Withdraw] balance lookup failed', { uid, error })
    return NextResponse.json({ ok: false, error: '잔액을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  if (amount > spendable) {
    return NextResponse.json(
      { ok: false, error: `출금 가능 잔액이 부족합니다. (출금 가능: ${piRound(spendable)} Pi)` },
      { status: 400 },
    )
  }

  // 4. 실제 송금 — 실패하면 지출 장부를 쓰지 않고 에러를 돌려 클라이언트 차감도 막는다.
  let txid = ''
  let paymentId = ''
  if (sandbox) {
    // 테스트넷은 실제 A2U 없이 장부 흐름만 검증한다(모의 결제와 같은 정책).
    txid = `sandbox-withdraw-${requestId}`
    paymentId = txid
  } else {
    try {
      const payment = await createA2UPayment(
        { amount, memo: 'TaxiTago 잔액 출금', uid, metadata: { kind: 'user-withdraw', requestId } },
        sandbox,
      )
      txid = payment.transaction?.txid || ''
      paymentId = payment.identifier || ''
    } catch (error) {
      console.error('[Withdraw] A2U payout failed', { uid, amount, error })
      return NextResponse.json(
        { ok: false, error: 'Pi 네트워크 오류로 출금 전송에 실패했습니다. 잔액은 차감되지 않았으니 잠시 후 다시 시도해 주세요.' },
        { status: 502 },
      )
    }
  }

  // 5. 송금 성공 뒤에만 지출 장부 차감 — txid가 멱등키라 중복 기록이 안 생긴다.
  const spendTxid = txid || paymentId || `withdraw:${requestId}`
  await recordUserSpend({ txid: spendTxid, wallet, uid, amount, label: 'Pi 출금' }).catch((error) => {
    console.error('[Withdraw] spend record failed after payout', { uid, txid: spendTxid, error })
  })
  await recordSentWithdrawal({
    recipient: wallet || uid,
    amount,
    memo: '사용자 잔액 출금',
    reason: 'user-withdraw',
    requestedBy: uid,
    requestedByName: uid,
    txid: spendTxid,
  }).catch(() => undefined)
  await recordAudit({
    kind: 'withdraw',
    actor: uid,
    refId: requestId,
    reason: '사용자 잔액 출금',
    detail: `${piRound(amount)} Pi → ${wallet || uid} · txid ${spendTxid}`,
  }).catch(() => undefined)

  return NextResponse.json({ ok: true, txid: spendTxid, paymentId, amount, destination: wallet || uid })
}
