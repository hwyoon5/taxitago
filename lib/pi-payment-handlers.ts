import { after, NextResponse } from 'next/server'
import { approvePiPayment, assertPiPaymentCompleted, cancelPiPayment, completePiPayment, describeError, getPiPayment, verifyPiTxidOnChain } from '@/lib/pi-platform'
import { isPiSandboxEnv, isPiSandboxRequest } from '@/lib/pi-sandbox'

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

type PiPaymentInfo = {
  user_uid?: unknown
  from_address?: unknown
  amount?: unknown
  metadata?: Record<string, unknown>
} | null

/**
 * wallet-charge 결제는 검증 완료 직후 이용자 크레딧까지 서버에서 마감한다.
 * 보낸 주소·금액은 온체인 payment op가 권위이고, 귀속 uid는 Pi 결제 객체의
 * user_uid가 권위 — 클라이언트 body의 값은 쓰지 않는다. Horizon op 조회가
 * 실패해도 Pi 응답의 from_address/amount로 폴백해 크레딧을 놓치지 않는다.
 */
async function creditWalletChargeDeposit(paymentId: string, txid: string, info: PiPaymentInfo, sandboxHint?: boolean | null) {
  try {
    const infoUid = typeof info?.user_uid === 'string' ? info.user_uid.trim() : ''
    const metaUid =
      info?.metadata && typeof info.metadata.uid === 'string' ? (info.metadata.uid as string).trim() : ''
    const { creditInboundDeposit } = await import('@/lib/deposit-scan')
    const deposit = await creditInboundDeposit({
      txid,
      uid: infoUid || metaUid,
      fromAddress: typeof info?.from_address === 'string' ? info.from_address : '',
      amount: typeof info?.amount === 'number' ? info.amount : undefined,
      source: 'scan',
      sandboxHint,
    })
    if (!deposit) {
      console.warn('[Pi] /api/pi/complete wallet-charge credit deferred', { paymentId, txid })
      return
    }
    console.log('[Pi] /api/pi/complete wallet-charge credited', { paymentId, txid, from: deposit.fromWallet, amount: deposit.amount, uid: deposit.fromUid })
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

/**
 * 클라이언트가 SDK init에 쓴 sandbox 값 — 결제가 실제로 생성된 네트워크다.
 * 서버 env(NEXT_PUBLIC_PI_SANDBOX)가 클라이언트 빌드와 어긋날 때(테스트넷
 * 결제를 메인넷 키로 승인 → 401/403 → 지갑 만료)를 막기 위한 힌트. 키 선택에만
 * 쓰이고 신뢰 결정에는 쓰지 않는다.
 */
function requestSandboxHint(body: Record<string, unknown> | null | undefined) {
  return typeof body?.sandbox === 'boolean' ? body.sandbox : null
}

export async function handlePiApprove(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    paymentId?: unknown
    kind?: unknown
    metadata?: unknown
    sandbox?: unknown
  } | null
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  const kind = requestKind(body)
  const sandboxHint = requestSandboxHint(body)
  // 힌트(결제 생성 네트워크) → 요청 host(테스트 전용 도메인 강제) → env 순으로
  // 최종 네트워크를 결정해 키 선택·Horizon 조회가 같은 값을 쓰게 한다.
  const effectiveSandbox = isPiSandboxRequest(request, sandboxHint)
  console.log('[Pi] /api/pi/approve incoming', {
    paymentId: paymentId || '(empty)',
    kind,
    sandboxHint,
    effectiveSandbox,
    envSandbox: isPiSandboxEnv(),
  })
  if (!paymentId) {
    console.error('[Pi] /api/pi/approve rejected: paymentId required')
    return NextResponse.json({ error: 'paymentId required' }, { status: 400 })
  }

  try {
    const payment = await approvePiPayment(paymentId, effectiveSandbox)
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

/**
 * 미완료 결제 정리 전용 — txid가 없어 complete할 수 없는(승인 후 체인 미제출)
 * 결제를 Pi Platform cancel로 종료한다. 이미 완료·취소된 건은 복구 목적상
 * 성공으로 간주한다(어느 쪽이든 '미완료' 상태는 아니므로 락은 풀려 있다).
 * 이미 체인에 제출된 건을 발견하면 취소 대신 완료 경로로 전환할 수 있게
 * txid를 응답에 담아 돌려준다.
 */
export async function handlePiCancel(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    paymentId?: unknown
    sandbox?: unknown
  } | null
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  const sandboxHint = requestSandboxHint(body)
  const effectiveSandbox = isPiSandboxRequest(request, sandboxHint)
  if (!paymentId) {
    return NextResponse.json({ error: 'paymentId required' }, { status: 400 })
  }
  try {
    // 취소 전에 상태를 조회 — 체인 제출이 끝난 건(txid 존재)은 취소할 수 없고
    // complete 경로로 마감해야 하므로 클라이언트에 txid를 돌려준다.
    const info = await getPiPayment(paymentId, effectiveSandbox).catch(() => null)
    const transaction =
      info && typeof info.transaction === 'object' ? (info.transaction as Record<string, unknown>) : null
    const onChainTxid = typeof transaction?.txid === 'string' ? transaction.txid.trim() : ''
    if (onChainTxid) {
      return NextResponse.json({ ok: true, redirected: 'complete', txid: onChainTxid })
    }
    const status = info?.status && typeof info.status === 'object' ? (info.status as Record<string, unknown>) : null
    if (status?.developer_completed === true || status?.cancelled === true || status?.user_cancelled === true) {
      return NextResponse.json({ ok: true, already: 'final' })
    }
    const payment = await cancelPiPayment(paymentId, effectiveSandbox)
    console.log('[Pi] /api/pi/cancel ok', { paymentId })
    return NextResponse.json({ ok: true, payment })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cancel failed'
    const upstream = (error as { piHttpStatus?: number } | null)?.piHttpStatus
    // Pi가 '더 이상 취소 불가(이미 완료/만료)'로 4xx를 돌려주면 미완료 락은
    // 이미 해소된 상태 — 복구 호출자가 실패로 오인해 매번 재시도하지 않게 ok로 돌린다.
    if (typeof upstream === 'number' && upstream >= 400 && upstream < 500) {
      console.warn('[Pi] /api/pi/cancel not needed (already final)', { paymentId, upstream, message })
      return NextResponse.json({ ok: true, already: 'final', note: message })
    }
    console.error('[Pi] /api/pi/cancel error', { paymentId, message, ...describeError(error) })
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
    sandbox?: unknown
  } | null
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  const txid = typeof body?.txid === 'string' ? body.txid.trim() : ''
  const kind = requestKind(body)
  const sandboxHint = requestSandboxHint(body)
  const effectiveSandbox = isPiSandboxRequest(request, sandboxHint)
  console.log('[Pi] /api/pi/complete incoming', {
    paymentId: paymentId || '(empty)',
    txid: txid || '(empty)',
    kind,
    sandboxHint,
    effectiveSandbox,
    envSandbox: isPiSandboxEnv(),
  })
  if (!paymentId || !txid) {
    console.error('[Pi] /api/pi/complete rejected: paymentId and txid required')
    return NextResponse.json({ error: 'paymentId and txid required' }, { status: 400 })
  }
  const fallbackAmount = typeof body?.amount === 'number' ? body.amount : null
  const fallbackMetadata =
    body?.metadata && typeof body.metadata === 'object' ? (body.metadata as Record<string, unknown>) : null

  try {
    const { payment, info } = await completePiPayment(paymentId, txid, effectiveSandbox)
    assertPiPaymentCompleted(payment, paymentId, txid)
    await verifyPiTxidOnChain(txid, effectiveSandbox)
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
      console.log('[Pi] /api/pi/complete background work start', { paymentId, txid, metaKind })
      if (metaKind === 'wallet-charge') {
        await creditWalletChargeDeposit(paymentId, txid, info, effectiveSandbox)
      }
      await lockRideEscrowFromPayment(paymentId, txid, info?.metadata ?? fallbackMetadata).catch((lockError) => {
        console.error('[Pi] /api/pi/complete escrow lock failed', { paymentId, lockError })
      })
      // 요금 계열 결제는 이용자 크레딧 장부에서 결제액만큼 차감을 같은 완료
      // 흐름에서 기록한다 — 서버 조회값(uid·from_address·amount)만 쓰고,
      // txid 멱등이라 콜백 재시도가 이중 차감하지 않는다.
      const FARE_KINDS = new Set(['service-pay', 'manual-settle', 'escrow-lock'])
      if (metaKind && FARE_KINDS.has(metaKind)) {
        const { recordUserSpend } = await import('@/lib/user-credit-store')
        await recordUserSpend({
          txid,
          uid: typeof info?.user_uid === 'string' ? info.user_uid : '',
          wallet: typeof info?.from_address === 'string' ? info.from_address : '',
          amount: typeof info?.amount === 'number' ? info.amount : (fallbackAmount ?? 0),
          label: metaKind,
        }).catch((spendError) => {
          console.error('[Pi] /api/pi/complete user spend record failed', { paymentId, spendError })
        })
      }
      await recordServiceSettlement({
        paymentId,
        txid,
        amount: typeof info?.amount === 'number' ? info.amount : fallbackAmount,
        metadata: info?.metadata ?? fallbackMetadata,
      }).catch((settleError) => {
        console.error('[Pi] /api/pi/complete settlement record failed', { paymentId, settleError })
      })
      const { handleManualPayComplete } = await import('@/lib/manual-pay-store')
      await handleManualPayComplete({
        paymentId,
        txid,
        metadata: info?.metadata ?? fallbackMetadata,
      }).catch((manualError) => {
        console.error('[Pi] /api/pi/complete manual-pay settle failed', { paymentId, manualError })
      })
      console.log('[Pi] /api/pi/complete background work done', { paymentId, txid })
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
