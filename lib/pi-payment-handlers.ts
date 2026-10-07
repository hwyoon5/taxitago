import { NextResponse } from 'next/server'
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

function errorStatus(message: string) {
  return message.includes('PI_API_KEY') ? 500 : 502
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
 * 지갑 충전(내부 잔액 증가)은 샌드박스 폴백으로 속이면 안 된다 —
 * 실제 Pi Platform 승인/완료가 성공해야만 한다.
 */
function requestKind(body: Record<string, unknown> | null | undefined) {
  const kind = typeof body?.kind === 'string' ? body.kind.trim() : ''
  const metadata = body?.metadata && typeof body.metadata === 'object' ? (body.metadata as Record<string, unknown>) : null
  const metaKind = typeof metadata?.kind === 'string' ? metadata.kind.trim() : ''
  return kind || metaKind
}

function sandboxOk(kind: 'approve' | 'complete', paymentId: string, extra?: Record<string, string>) {
  console.warn(`[Pi] /api/pi/${kind} sandbox fallback`, { paymentId, ...extra })
  return NextResponse.json({
    ok: true,
    sandbox: true,
    payment: { identifier: paymentId, ...extra },
  })
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
    const message = error instanceof Error ? error.message : 'approve failed'
    if (isPiSandboxEnv() && kind !== 'wallet-charge') return sandboxOk('approve', paymentId)
    console.error('[Pi] /api/pi/approve error', { paymentId, kind, message, ...describeError(error) })
    return NextResponse.json({ error: message }, { status: errorStatus(message) })
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
    // kind는 Pi Platform이 보관하는 결제 메타데이터(서버가 조회한 원본)가 권위 —
    // 클라이언트 body의 kind는 조작 가능하므로 fallback으로만 쓴다.
    const metaKind =
      info?.metadata && typeof info.metadata.kind === 'string' && info.metadata.kind.trim()
        ? info.metadata.kind.trim()
        : kind
    const { markPaymentKind } = await import('@/lib/payment-kind-store')
    await markPaymentKind(txid, metaKind).catch(() => undefined)
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
    return NextResponse.json({ ok: true, payment })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'complete failed'
    if (isPiSandboxEnv() && kind !== 'wallet-charge') {
      await lockRideEscrowFromPayment(paymentId, txid, fallbackMetadata).catch(() => null)
      await recordServiceSettlement({ paymentId, txid, amount: fallbackAmount, metadata: fallbackMetadata }).catch(
        () => null,
      )
      return sandboxOk('complete', paymentId, { txid })
    }
    console.error('[Pi] /api/pi/complete error', { paymentId, txid, kind, message, ...describeError(error) })
    return NextResponse.json({ error: message }, { status: errorStatus(message) })
  }
}
