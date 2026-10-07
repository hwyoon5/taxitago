import { after, NextResponse } from 'next/server'
import { approvePiPayment, assertPiPaymentCompleted, completePiPayment, describeError, verifyPiTxidOnChain } from '@/lib/pi-platform'
import { isPiSandboxEnv } from '@/lib/pi-sandbox'

/**
 * 승인 경로는 지갑 만료 시간 안에 응답해야 하므로, 완료 처리에만 필요한
 * 디스패치/에스크로/정산 모듈 그래프를 필요 시점에 lazy-load 한다.
 */
async function recordServiceSettlement(input: {
  paymentId: string
  txid: string
  amount: number | null
  metadata: Record<string, unknown> | null
}) {
  const { handleServicePaymentComplete } = await import('@/lib/service-settlement')
  await handleServicePaymentComplete(input)
}

/** Lock the ride escrow as soon as a funding payment completes, so either side can settle later. */
export async function lockRideEscrowFromPayment(
  paymentId: string,
  txid: string,
  metadata: Record<string, unknown> | null | undefined,
) {
  if (!metadata || metadata.kind !== 'escrow-lock') return
  const rideId = typeof metadata.rideId === 'string' ? metadata.rideId.trim() : ''
  if (!rideId) return
  const [{ getRide, hydrateDispatchFromKv }, { hydrateEscrowFromKv }, { ensureSettlementEscrow }] = await Promise.all([
    import('@/lib/dispatch-store'),
    import('@/lib/escrow-store'),
    import('@/lib/escrow-engine'),
  ])
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv()])
  const ride = getRide(rideId)
  if (!ride?.assignedDriverId) return
  ensureSettlementEscrow(rideId, ride.assignedDriverId, {
    status: 'held',
    lockTxid: txid,
    lockPaymentId: paymentId,
  })
}

function errorStatus(error: unknown, message: string) {
  if (message.includes('PI_API_KEY')) return 500
  // Pi API가 4xx로 거절한 경우(만료·취소·잘못된 paymentId)는 그대로 전달한다 —
  // 502로 변환하면 업스트림 장애로 오진되고 재시도 판단도 흐려진다.
  const upstream = (error as { piHttpStatus?: number } | null)?.piHttpStatus
  if (typeof upstream === 'number' && upstream >= 400 && upstream < 500) return upstream
  return 502
}

/**
 * wallet-charge 결제는 검증 완료 직후 이용자 크레딧까지 서버에서 마감한다.
 * 보낸 주소·금액은 클라이언트 body가 아니라 온체인 payment op에서 꺼낸다.
 */
async function creditWalletChargeDeposit(paymentId: string, txid: string) {
  try {
    const [{ getAdminWallet }, { fetchInboundPaymentOp }] = await Promise.all([
      import('@/lib/admin-wallet'),
      import('@/lib/deposit-scan'),
    ])
    const adminWallet = (await getAdminWallet()).trim()
    if (!adminWallet) return
    const op = await fetchInboundPaymentOp(txid, adminWallet)
    if (!op?.from || !(op.amount > 0)) {
      console.warn('[Pi] /api/pi/complete wallet-charge: no inbound op found', { paymentId, txid })
      return
    }
    const [{ recordDeposit }, { creditUserDeposit }, { recordWalletTx }] = await Promise.all([
      import('@/lib/deposit-store'),
      import('@/lib/user-credit-store'),
      import('@/lib/wallet-history'),
    ])
    const deposit = await recordDeposit({
      txid,
      fromWallet: op.from,
      toWallet: adminWallet,
      amount: op.amount,
      status: 'confirmed',
      seenAt: op.createdAt,
    }).catch(() => null)
    if (!deposit) return
    await Promise.all([
      creditUserDeposit({ txid, wallet: deposit.fromWallet, uid: deposit.fromUid, amount: deposit.amount, source: 'scan' }).catch(
        () => undefined,
      ),
      recordWalletTx({
        kind: 'deposit',
        txid: deposit.txid,
        fromWallet: deposit.fromWallet,
        toWallet: deposit.toWallet,
        amount: deposit.amount,
        status: 'confirmed',
        network: isPiSandboxEnv() ? 'testnet' : 'mainnet',
      }).catch(() => undefined),
    ])
    console.log('[Pi] /api/pi/complete wallet-charge credited', { paymentId, txid, from: op.from, amount: op.amount })
  } catch (error) {
    // 크레딧 기록 실패는 결제 완료 자체를 되돌리지 않는다 — 폴러 스캔이 복구한다.
    console.error('[Pi] /api/pi/complete wallet-charge credit failed', { paymentId, txid, error })
  }
}

/**
 * 요청 body에서 결제 kind를 읽는다. body 값은 클라이언트가 자유롭게 쓸 수
 * 있으므로 '입금 아님' 분류와 로깅에만 쓰고, 크레딧을 만드는 판정에는
 * 서버가 조회한 결제 메타데이터(info.metadata.kind)를 쓴다.
 */
function requestKind(body: Record<string, unknown> | null | undefined) {
  const kind = typeof body?.kind === 'string' ? body.kind.trim() : ''
  const metadata = body?.metadata && typeof body.metadata === 'object' ? (body.metadata as Record<string, unknown>) : null
  const metaKind = typeof metadata?.kind === 'string' ? metadata.kind.trim() : ''
  return kind || metaKind
}

export async function handlePiApprove(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    paymentId?: unknown
    kind?: unknown
    metadata?: unknown
  } | null
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  const kind = requestKind(body)
  console.log('[Pi] /api/pi/approve incoming', { paymentId: paymentId || '(empty)', kind, sandbox: isPiSandboxEnv() })
  if (!paymentId) {
    console.error('[Pi] /api/pi/approve rejected: paymentId required')
    return NextResponse.json({ error: 'paymentId required' }, { status: 400 })
  }

  try {
    const payment = await approvePiPayment(paymentId)
    console.log('[Pi] /api/pi/approve ok', { paymentId })
    return NextResponse.json({ ok: true, payment })
  } catch (error) {
    // 샌드박스 폴백 없음 — 승인 실패를 ok로 위장해도 Pi Platform이 승인하지
    // 않은 결제는 지갑에서 어차피 만료되며, 진짜 오류만 로그에서 가려진다.
    const message = error instanceof Error ? error.message : 'approve failed'
    console.error('[Pi] /api/pi/approve error', { paymentId, kind, message, ...describeError(error) })
    return NextResponse.json({ error: message }, { status: errorStatus(error, message) })
  }
}

export async function handlePiComplete(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    paymentId?: unknown
    txid?: unknown
    amount?: unknown
    kind?: unknown
    metadata?: unknown
  } | null
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  const txid = typeof body?.txid === 'string' ? body.txid.trim() : ''
  const kind = requestKind(body)
  console.log('[Pi] /api/pi/complete incoming', { paymentId: paymentId || '(empty)', txid: txid || '(empty)', kind, sandbox: isPiSandboxEnv() })
  if (!paymentId || !txid) {
    console.error('[Pi] /api/pi/complete rejected: paymentId and txid required')
    return NextResponse.json({ error: 'paymentId and txid required' }, { status: 400 })
  }
  const fallbackAmount = typeof body?.amount === 'number' ? body.amount : null
  const fallbackMetadata =
    body?.metadata && typeof body.metadata === 'object' ? (body.metadata as Record<string, unknown>) : null

  try {
    const { payment, info } = await completePiPayment(paymentId, txid)
    assertPiPaymentCompleted(payment, paymentId, txid)
    await verifyPiTxidOnChain(txid)
    console.log('[Pi] /api/pi/complete verified', { paymentId, txid })
    // kind는 Pi Platform이 보관하는 결제 메타데이터(서버가 조회한 원본)가 권위.
    // 서버 조회가 실패(info null)하거나 원본에 kind가 없으면 클라이언트 주장을
    // '입금 아님' 방향으로만 받아들인다 — 서비스 결제로 분류하는 표시는 크레딧을
    // 막기만 하지만, wallet-charge 주장은 크레딧을 만들므로 미검증이면 기록하지
    // 않는다. 크레딧 없이 남은 진짜 입금은 입금 스캐너가 뒤늦게 처리한다.
    const infoKind =
      info?.metadata && typeof info.metadata.kind === 'string' && info.metadata.kind.trim()
        ? info.metadata.kind.trim()
        : ''
    const { markPaymentKind, isDepositPaymentKind } = await import('@/lib/payment-kind-store')
    const metaKind = infoKind || (isDepositPaymentKind(kind) ? '' : kind)
    if (!infoKind && isDepositPaymentKind(kind) && kind) {
      console.warn('[Pi] /api/pi/complete deposit-kind claim unverified; skipping mark+credit', {
        paymentId,
        txid,
        claimedKind: kind,
      })
    }
    await markPaymentKind(txid, metaKind).catch(() => undefined)
    // 검증은 응답 전에 끝내고, 무거운 후속 작업(충전 크레딧·에스크로·정산 기록)은
    // 응답 이후 백그라운드로 — maxDuration 초과로 함수가 kill돼 응답이 유실되거나
    // 장부가 반만 기록되는 사태를 막는다. 각 단계는 멱등이라 폴러가 복구도 한다.
    after(async () => {
      if (metaKind === 'wallet-charge') {
        await creditWalletChargeDeposit(paymentId, txid)
      }
      await lockRideEscrowFromPayment(paymentId, txid, info?.metadata ?? fallbackMetadata).catch((lockError) => {
        console.error('[Pi] /api/pi/complete escrow lock failed', { paymentId, lockError })
      })
      await recordServiceSettlement({
        paymentId,
        txid,
        amount: typeof info?.amount === 'number' ? info.amount : fallbackAmount,
        metadata: info?.metadata ?? fallbackMetadata,
      }).catch((settleError) => {
        console.error('[Pi] /api/pi/complete settlement record failed', { paymentId, settleError })
      })
    })
    return NextResponse.json({ ok: true, payment })
  } catch (error) {
    // 샌드박스 폴백 없음 — 검증 실패(취소·txid 불일치·체인 거부)를 ok로 위장해
    // 에스크로/정산을 기록하는 것은 가짜 '처리됨' 상태를 만든다. 실제 체인 결제가
    // 된 경우는 입금 스캐너·미완료 결제 복구가 잡아낸다.
    const message = error instanceof Error ? error.message : 'complete failed'
    console.error('[Pi] /api/pi/complete error', { paymentId, txid, kind, message, ...describeError(error) })
    return NextResponse.json({ error: message }, { status: errorStatus(error, message) })
  }
}
