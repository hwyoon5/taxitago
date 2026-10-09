import { NextResponse } from 'next/server'
import { inspectPiAccessToken } from '@/lib/pi-platform'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'
import { piRound } from '@/lib/pi-format'
import { listUserSpends, recordUserSpend, userSpendableBalance } from '@/lib/user-credit-store'
import { getManualPay, settleManualPayByBalance } from '@/lib/manual-pay-store'
import { getRide, hydrateDispatchFromKv, syncDispatchFromDisk } from '@/lib/dispatch-store'
import { lockEscrow } from '@/lib/escrow-engine'
import { handleServicePaymentComplete } from '@/lib/service-settlement'
import { recordAudit } from '@/lib/audit-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 1회 잔액 결제 상한 — 이상 요청 차단용 가드레일. */
const MAX_SPEND_PI = 500

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const inFlight = new Set<string>()

/** 결제 단위 멱등 — 같은 건의 재시도가 이중 차감을 만들지 못한다. */
async function claimSpend(key: string): Promise<boolean> {
  if (useKv) {
    const res = await fetch(kvUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', `taxitago:spend:${key}`, '1', 'NX', 'PX', 24 * 60 * 60 * 1000]),
      cache: 'no-store',
    }).catch(() => null)
    if (!res) return false
    const data = (await res.json().catch(() => ({}))) as { result?: string | null }
    return data.result === 'OK'
  }
  if (inFlight.has(key)) return false
  inFlight.add(key)
  return true
}

function spendTxid(key: string) {
  return `balance-${key}`
}

/**
 * 앱 내 잔액 결제 — Pi SDK 없이 서버 장부(크레딧−지출)에서 즉시 차감하고,
 * 목적별 정산(기사 정산 장부·플랫폼 수수료)을 같은 요청 안에서 기록한다.
 * Pi SDK는 충전(입금)과 출금(A2U) 경로에서만 사용된다.
 *
 * purpose:
 *  - 'ride'    : 운행 요금 — 잔액 차감 + 에스크로를 잔액결제로 잠금 (이후 운행 완료 정산에서 확정)
 *  - 'manual'  : QR/현장 수동 결제 — 금액은 서버의 결제 요청 레코드가 권위
 *  - 'service' : 서비스 결제(자전거·퀵보드·주차 등) — 수수료율 정산 즉시 기록
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    uid?: unknown
    wallet?: unknown
    amount?: unknown
    requestId?: unknown
    purpose?: unknown
    rideId?: unknown
    manualId?: unknown
    label?: unknown
    place?: unknown
    service?: unknown
    partnerId?: unknown
    partnerName?: unknown
    accessToken?: unknown
    sandbox?: unknown
  } | null
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const wallet = typeof body?.wallet === 'string' ? body.wallet.trim() : ''
  const purpose = typeof body?.purpose === 'string' ? body.purpose.trim() : ''
  const rideId = typeof body?.rideId === 'string' ? body.rideId.trim() : ''
  const manualId = typeof body?.manualId === 'string' ? body.manualId.trim() : ''
  const label = typeof body?.label === 'string' ? body.label.trim().slice(0, 40) : ''
  const place = typeof body?.place === 'string' ? body.place.trim().slice(0, 60) : ''
  const service = typeof body?.service === 'string' ? body.service.trim() : ''
  const partnerId = typeof body?.partnerId === 'string' ? body.partnerId.trim() : ''
  const partnerName = typeof body?.partnerName === 'string' ? body.partnerName.trim() : ''
  const requestId = typeof body?.requestId === 'string' && body.requestId.trim() ? body.requestId.trim() : crypto.randomUUID()
  if (!uid) return NextResponse.json({ ok: false, error: 'Pi 계정 연동 후 결제할 수 있습니다.' }, { status: 400 })
  if (purpose !== 'ride' && purpose !== 'manual' && purpose !== 'service') {
    return NextResponse.json({ ok: false, error: '결제 목적이 올바르지 않습니다.' }, { status: 400 })
  }
  const sandbox = isPiSandboxRequest(request, typeof body?.sandbox === 'boolean' ? body.sandbox : null)

  // 1. 인증 — 결제 요청자가 해당 Pi uid 소유자인지 토큰으로 검증한다
  // (withdraw/partner DELETE와 동일 정책: 메인넷 fail-closed, 테스트넷은 unreachable 통과).
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
  // 이용 정지(Lock) 계정은 잔액 결제를 쓸 수 없다.
  const { isUserLocked } = await import('@/lib/user-registry')
  if (await isUserLocked(uid).catch(() => false)) {
    return NextResponse.json({ ok: false, error: '관리자에 의해 이용이 정지된 계정입니다.' }, { status: 403 })
  }

  // 2. 목적별 대상·금액 확정 — 멱등키는 건 단위로 결정해 재시도가 같은 건을 가리키게 한다.
  let amount = piRound(Number(body?.amount))
  let dedupeKey = requestId
  let target: { ridePassengerId?: string; manualAmount?: number } = {}
  if (purpose === 'manual') {
    if (!manualId) return NextResponse.json({ ok: false, error: '결제 요청을 찾을 수 없습니다.' }, { status: 400 })
    const record = await getManualPay(manualId).catch(() => null)
    if (!record) return NextResponse.json({ ok: false, error: '결제 요청을 찾을 수 없습니다.' }, { status: 404 })
    if (record.status === 'paid' || record.status === 'manual') {
      return NextResponse.json({ ok: true, txid: record.txid || spendTxid(`manual-${manualId}`), paymentId: record.paymentId || '', amount: record.amount, already: true })
    }
    if (record.status === 'cancelled') {
      return NextResponse.json({ ok: false, error: '기사가 취소한 결제 요청입니다.' }, { status: 400 })
    }
    amount = record.amount
    target = { manualAmount: record.amount }
    dedupeKey = `manual-${manualId}`
  } else if (purpose === 'ride') {
    if (!rideId) return NextResponse.json({ ok: false, error: '운행 정보를 찾을 수 없습니다.' }, { status: 400 })
    await hydrateDispatchFromKv().catch(() => undefined)
    syncDispatchFromDisk()
    const ride = getRide(rideId)
    if (!ride) return NextResponse.json({ ok: false, error: '운행 정보를 찾을 수 없습니다.' }, { status: 404 })
    target = { ridePassengerId: ride.passengerId }
    dedupeKey = `ride-${rideId}`
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_SPEND_PI) {
    return NextResponse.json({ ok: false, error: '결제 금액을 확인해 주세요.' }, { status: 400 })
  }

  const txid = spendTxid(dedupeKey)

  // 3. 잔액 — 서버 장부가 권위. 부족하면 차감·정산을 모두 진행하지 않는다.
  let spendable = 0
  try {
    spendable = Number(await userSpendableBalance(wallet, uid)) || 0
  } catch (error) {
    console.error('[Spend] balance lookup failed', { uid, error })
    return NextResponse.json({ ok: false, error: '잔액을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  if (amount > spendable + 0.000001) {
    return NextResponse.json(
      { ok: false, error: `앱 잔액이 부족합니다. 지갑에서 Pi를 충전한 뒤 다시 결제해 주세요. (잔액: ${piRound(spendable)} Pi)` },
      { status: 400 },
    )
  }

  // 4. 멱등 — 같은 건의 재시도는 이미 차감된 결과를 그대로 돌려준다.
  if (!(await claimSpend(dedupeKey))) {
    const existing = (await listUserSpends().catch(() => [])).find((entry) => entry.txid === txid)
    if (existing) {
      return NextResponse.json({ ok: true, txid, paymentId: txid, amount: existing.amount, already: true })
    }
    return NextResponse.json({ ok: false, error: '결제가 처리 중입니다. 잠시 후 다시 시도해 주세요.' }, { status: 409 })
  }

  // 5. 차감 — txid 멱등키라 재실행이 겹쳐도 한 번만 기록된다.
  const spend = await recordUserSpend({ txid, wallet, uid, amount, label: label || (purpose === 'ride' ? '운행 요금' : purpose === 'manual' ? '현장 결제' : '서비스 결제') }).catch((error) => {
    console.error('[Spend] debit failed', { uid, txid, amount, error })
    return null
  })
  if (!spend) {
    return NextResponse.json({ ok: false, error: '잔액 차감에 실패했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }

  // 6. 목적별 정산 — 차감된 금액을 기사 정산·플랫폼 수수료 장부에 같은 건으로 연결한다.
  try {
    if (purpose === 'manual') {
      await settleManualPayByBalance(manualId, { uid, txid })
    } else if (purpose === 'ride') {
      // 에스크로를 잔액 결제로 잠가 둔다 — 운행 완료 settleRide가 최종 정산액을
      // 확정하고 기사 net 송금·수수료 장부를 기록한다(차액은 settle 단에서 대사).
      if (target.ridePassengerId) {
        const locked = lockEscrow({
          rideId,
          passengerId: target.ridePassengerId,
          paymentId: txid,
          txid,
          sandbox,
        })
        if (!locked.ok) console.warn('[Spend] balance escrow lock failed', { rideId, error: locked.error })
      }
    } else {
      await handleServicePaymentComplete({
        paymentId: txid,
        txid,
        amount,
        metadata: {
          kind: 'service-pay',
          service: service || undefined,
          label,
          place,
          partnerId: partnerId || undefined,
          partnerName: partnerName || undefined,
        },
      })
    }
  } catch (error) {
    // 정산 기록 실패는 차감을 되돌리지 않는다 — 장부 대사/관리자 확인으로 복구한다.
    console.error('[Spend] settlement booking failed after debit', { uid, txid, purpose, error })
  }

  await recordAudit({
    kind: 'spend',
    actor: uid,
    refId: dedupeKey,
    reason: '앱 잔액 결제',
    detail: `${piRound(amount)} Pi · ${purpose}${rideId ? ` · ride:${rideId}` : ''}${manualId ? ` · manual:${manualId}` : ''} · ${txid}`,
  }).catch(() => undefined)

  return NextResponse.json({ ok: true, txid, paymentId: txid, amount })
}
