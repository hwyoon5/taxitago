import { after, NextResponse } from 'next/server'
import { approvePiPayment, assertPiPaymentCompleted, cancelPiPayment, completePiPayment, describeError, getPiPayment, verifyPiTxidOnChain } from '@/lib/pi-platform'
import { isPiSandboxEnv, isPiSandboxRequest } from '@/lib/pi-sandbox'

/**
 * Pi 결제 경로 CORS — 앱이 Pi App Studio 래퍼(*.piappengine.com) 등 다른
 * 오리진에서 열려도 클라이언트의 승인/완료 요청이 정규 백엔드에 도달하도록
 * 한다. 비밀값을 받지 않는 공개 엔드포인트라 와일드카드 오리진을 허용한다.
 */
export const PI_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
} as const

export function handlePiCorsPreflight() {
  return new Response(null, { status: 204, headers: PI_CORS_HEADERS })
}

function corsJson(data: unknown, init?: { status?: number }) {
  return NextResponse.json(data, { status: init?.status, headers: PI_CORS_HEADERS })
}

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
  await ensureSettlementEscrow(rideId, ride.assignedDriverId, {
    status: 'held',
    lockTxid: txid,
    lockPaymentId: paymentId,
  })
}

/**
 * 에스크로 결제 완료가 서버 검증을 통과했는데 이용자 앱에서 completeRideTrip이
 * 호출되지 않은 경우(지갑 만료 화면·앱 이탈·네트워크 단절로 SDK 완료 콜백이
 * 유실)를 위한 서버 주도 완료 — 라이드를 'completed'로 전환해 양쪽 모드의
 * 폴링/SSE가 같은 상태를 즉시 보게 한다. 이미 완료됐거나 정산 불가 상태면
 * transitionRide의 상태 검사가 걸러낸다(멱등).
 */
async function settleEscrowRideFromPayment(
  paymentId: string,
  txid: string,
  metadata: Record<string, unknown> | null | undefined,
) {
  if (!metadata || metadata.kind !== 'escrow-lock') return
  const rideId = typeof metadata.rideId === 'string' ? metadata.rideId.trim() : ''
  if (!rideId) return
  const { getRide, hydrateDispatchFromKv } = await import('@/lib/dispatch-store')
  await hydrateDispatchFromKv()
  const ride = getRide(rideId)
  if (!ride?.assignedDriverId || ride.status !== 'assigned' || !ride.readyToSettleAt) return
  const { transitionRide } = await import('@/lib/ride-machine')
  const result = await transitionRide({
    rideId,
    action: 'complete',
    driverId: ride.assignedDriverId,
    proof: { status: 'held', lockTxid: txid, lockPaymentId: paymentId },
  })
  if (result.ok) {
    console.log('[Pi] ride completed via server-side payment settlement', { paymentId, rideId })
  } else {
    console.warn('[Pi] server-side ride completion skipped', { paymentId, rideId, error: result.error })
  }
}

/**
 * 테스트용 Mock 승인 모드 — 테스트넷(test.* 호스트 등 sandbox 결정)에서만 기본
 * 활성이며 PI_PAYMENT_MOCK=1/0으로 명시 제어한다. 메인넷 결제에는 절대 발동
 * 하지 않는다. Pi Platform 호출이 실패해도 클라이언트에 ok를 돌려 테스트
 * 플로우가 끊기지 않게 한다. 단, 지갑의 만료 판정은 Pi 측 developer_approved
 * 기록이라 mock 응답이 지갑 만료 자체를 막지는 못하며, mock 완료는 정산
 * 장부를 만들지 않는다(진짜 결제 기록 오염 방지).
 */
function piPaymentMockEnabled(sandbox: boolean) {
  const flag = (process.env.PI_PAYMENT_MOCK || '').trim().toLowerCase()
  if (flag === '1' || flag === 'true' || flag === 'yes') return true
  if (flag === '0' || flag === 'false' || flag === 'no') return false
  return sandbox
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
    uid?: unknown
    appInstance?: unknown
  } | null
  // 워밍업 핑 — 클라이언트가 결제 시작 시 콜드 스타트 예방용으로 보내는
  // {warmup:true} POST를 결제 요청으로 오인해 에러 로그를 남기지 않는다.
  if (body && (body as Record<string, unknown>).warmup === true) {
    return corsJson({ ok: true, warmed: true })
  }
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  const claimedUid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  // 클라이언트 SDK가 속한 Pi 앱 인스턴스 — 지갑의 결제 앱과 백엔드 키의 앱이
  // 다른 경우(포털 앱 분리) 401/404로 실패하므로 상관관계용으로 함께 받는다.
  const appInstance = typeof body?.appInstance === 'string' ? body.appInstance.trim() : ''
  const kind = requestKind(body)
  const sandboxHint = requestSandboxHint(body)
  // 힌트(결제 생성 네트워크) → 요청 host(테스트 전용 도메인 강제) → env 순으로
  // 최종 네트워크를 결정해 키 선택·Horizon 조회가 같은 값을 쓰게 한다.
  const effectiveSandbox = isPiSandboxRequest(request, sandboxHint)
  console.log('[Pi] /api/pi/approve incoming', {
    paymentId: paymentId || '(empty)',
    kind,
    uid: claimedUid || '(unknown)',
    appInstance: appInstance || '(unknown)',
    sandboxHint,
    effectiveSandbox,
    envSandbox: isPiSandboxEnv(),
  })
  if (!paymentId) {
    console.error('[Pi] /api/pi/approve rejected: paymentId required')
    return corsJson({ error: 'paymentId required' }, { status: 400 })
  }

  // 'received'를 먼저 영속 기록 — 이후 ok/error 이벤트 유무로 지갑 만료 원인이
  // '요청 미도달'인지 '업스트림 실패'인지를 diagnostics만으로 판별할 수 있다.
  const { recordPiEvent } = await import('@/lib/pi-audit')
  void recordPiEvent({
    kind: 'approve',
    stage: 'received',
    paymentId,
    network: effectiveSandbox ? 'testnet' : 'mainnet',
    app: appInstance || undefined,
  }).catch(() => undefined)

  const startedAt = Date.now()
  try {
    const payment = await approvePiPayment(paymentId, effectiveSandbox)
    console.log('[Pi] /api/pi/approve ok', { paymentId, ms: Date.now() - startedAt })
    void recordPiEvent({
      kind: 'approve',
      stage: 'ok',
      paymentId,
      network: effectiveSandbox ? 'testnet' : 'mainnet',
      ms: Date.now() - startedAt,
    }).catch(() => undefined)
    return corsJson({ ok: true, payment })
  } catch (error) {
    // 클라이언트에는 pendingApproval로 돌리지만 Pi 기록의 승인이 성립할 때까지
    // '승인됨'으로 기록하지 않는다 — 결제 성립(complete/정산)은 별도 검증.
    const message = error instanceof Error ? error.message : 'approve failed'
    const status = (error as { piHttpStatus?: number } | null)?.piHttpStatus
    const upstreamBody = (error as { piHttpBody?: string } | null)?.piHttpBody
    console.error('[Pi] /api/pi/approve error', {
      paymentId,
      kind,
      message,
      upstreamBody,
      effectiveSandbox,
      ms: Date.now() - startedAt,
      ...describeError(error),
    })
    void recordPiEvent({
      kind: 'approve',
      stage: 'error',
      paymentId,
      network: effectiveSandbox ? 'testnet' : 'mainnet',
      ms: Date.now() - startedAt,
      httpStatus: typeof status === 'number' ? status : undefined,
      message: (upstreamBody ? `${message} | upstream: ${upstreamBody}` : message).slice(0, 300),
    }).catch(() => undefined)
    if (status === 401 || status === 403 || status === 404) {
      console.error(
        '[Pi] /api/pi/approve possible app/key mismatch — ' +
          `모든 키 후보가 ${status}로 거절됐습니다. ` +
          `PI_API_KEY_${effectiveSandbox ? 'TESTNET' : 'MAINNET'}가 클라이언트 지갑 앱` +
          `${appInstance ? `(${appInstance})` : ''}과 같은 Pi 프로젝트의 키인지 확인해 주세요. ` +
          '포털의 구 테스트넷 앱과 신규 앱이 분리돼 있으면 지갑의 결제는 다른 앱 네임스페이스에 생성돼 ' +
          '승인이 401(키 거절)/404(결제 없음)로 끝납니다. ' +
          'GET /api/pi/diagnostics의 keys.fingerprints로 배포된 키 앞자리를 포털 키와 대조하세요.',
      )
    }
    // 실패 표면화 전 최종 상태를 한 번 더 확인한다 — 승인 응답만 유실되고 Pi
    // 쪽에서는 승인이 끝난 경우(네트워크 단절 직후)까지 실패로 돌리면 지갑과
    // 서버의 판정이 어긋난다. 정말 미승인이면 즉시 cancel해 지갑의 미완료
    // 결제 락을 풀어 다음 결제가 '이전 결제 대기'로 막히지 않게 한다.
    // 재확인은 지갑 만료 창 안에 끝나야 하므로 GET 자체의 45초 예산보다 짧게 자른다.
    const afterError = (await Promise.race([
      getPiPayment(paymentId, effectiveSandbox),
      new Promise<null>((resolve) => setTimeout(resolve, 6_000)),
    ]).catch(() => null)) as {
      status?: Record<string, unknown>
    } | null
    if (afterError?.status?.developer_approved === true) {
      console.log('[Pi] /api/pi/approve error path but payment already approved — treating as ok', {
        paymentId,
        originalError: message,
      })
      void recordPiEvent({
        kind: 'approve',
        stage: 'ok',
        paymentId,
        network: effectiveSandbox ? 'testnet' : 'mainnet',
        ms: Date.now() - startedAt,
      }).catch(() => undefined)
      return corsJson({ ok: true, payment: afterError, recovered: true })
    }
    // 테스트넷 Mock 승인 — Pi 호출 실패를 명시적 mock 응답으로 표시한다.
    // 실제 승인은 백그라운드 재시도가 계속 시도해 창 안에 성공하면 지갑도
    // 정상 진행된다(Pi 기록이 성립해야 하므로 mock이 지갑 만료를 막지는 않는다).
    const mock = piPaymentMockEnabled(effectiveSandbox)
    if (mock) {
      console.warn('[Pi] /api/pi/approve MOCK approval (PI_PAYMENT_MOCK/testnet)', { paymentId, originalError: message })
      void recordPiEvent({
        kind: 'approve',
        stage: 'ok',
        paymentId,
        network: effectiveSandbox ? 'testnet' : 'mainnet',
        message: 'mock approval (test mode)',
      }).catch(() => undefined)
    }
    // 지갑 만료 방어 — 동기 승인이 실패해도 클라이언트에는 즉시 ok를 돌리고
    // after() 백그라운드에서 지갑의 승인 창(~45초) 안에 걸쳐 재시도한다.
    // 지갑은 우리의 HTTP 응답이 아니라 Pi Platform의 developer_approved 상태를
    // 보므로, 창 안에 재시도가 한 번이라도 성공하면 결제가 진짜로 살아난다
    // (갓 생성된 결제가 Pi 쪽에 잠시 404로 보이는 전파 지연·일시 5xx 포함).
    // 재시도가 전부 실패하면 cancel로 미완료 락을 풀어 다음 결제를 막지 않는다.
    void recordPiEvent({
      kind: 'approve',
      stage: 'pending',
      paymentId,
      network: effectiveSandbox ? 'testnet' : 'mainnet',
      message: 'sync approve failed; retrying in background',
    }).catch(() => undefined)
    after(async () => {
      const deadline = startedAt + 45_000
      let attempt = 0
      while (Date.now() < deadline) {
        attempt += 1
        await new Promise((resolve) => setTimeout(resolve, 3_000))
        try {
          const payment = await approvePiPayment(paymentId, effectiveSandbox)
          console.log('[Pi] /api/pi/approve background retry succeeded', { paymentId, attempt })
          void recordPiEvent({
            kind: 'approve',
            stage: 'ok',
            paymentId,
            network: effectiveSandbox ? 'testnet' : 'mainnet',
            ms: Date.now() - startedAt,
            message: `background retry #${attempt}`,
          }).catch(() => undefined)
          return
        } catch (retryError) {
          const retryStatus = (retryError as { piHttpStatus?: number } | null)?.piHttpStatus
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError)
          console.warn('[Pi] /api/pi/approve background retry failed', {
            paymentId,
            attempt,
            status: retryStatus,
            message: retryMessage,
            ms: Date.now() - startedAt,
          })
          // 재시도 실패 뒤에도 승인만 이미 기록됐으면 성공으로 수렴한다.
          const recheck = (await getPiPayment(paymentId, effectiveSandbox).catch(() => null)) as {
            status?: Record<string, unknown>
          } | null
          if (recheck?.status?.developer_approved === true) {
            console.log('[Pi] /api/pi/approve background recheck approved', { paymentId, attempt })
            void recordPiEvent({
              kind: 'approve',
              stage: 'ok',
              paymentId,
              network: effectiveSandbox ? 'testnet' : 'mainnet',
              ms: Date.now() - startedAt,
              message: `recheck after retry #${attempt}`,
            }).catch(() => undefined)
            return
          }
          // 401/403은 같은 키 집합으로 재시도해도 결과가 같다 — 즉시 종료하고 정리로 간다.
          if (retryStatus === 401 || retryStatus === 403) break
        }
      }
      console.error('[Pi] /api/pi/approve all background retries exhausted; cancelling', { paymentId })
      void recordPiEvent({
        kind: 'approve',
        stage: 'error',
        paymentId,
        network: effectiveSandbox ? 'testnet' : 'mainnet',
        ms: Date.now() - startedAt,
        message: 'background retries exhausted; payment left unapproved',
      }).catch(() => undefined)
      await cancelPiPayment(paymentId, effectiveSandbox)
        .then(() => console.warn('[Pi] unapproved payment cancelled after approve failure', { paymentId }))
        .catch((cancelError) =>
          console.warn('[Pi] post-failure cancel skipped', {
            paymentId,
            message: cancelError instanceof Error ? cancelError.message : String(cancelError),
          }),
        )
    })
    return corsJson({ ok: true, pendingApproval: true, mockApproved: mock || undefined })
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
    warmup?: unknown
  } | null
  if (body?.warmup === true) {
    return corsJson({ ok: true, warmed: true })
  }
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  const sandboxHint = requestSandboxHint(body)
  const effectiveSandbox = isPiSandboxRequest(request, sandboxHint)
  if (!paymentId) {
    return corsJson({ error: 'paymentId required' }, { status: 400 })
  }
  const { recordPiEvent } = await import('@/lib/pi-audit')
  void recordPiEvent({
    kind: 'cancel',
    stage: 'received',
    paymentId,
    network: effectiveSandbox ? 'testnet' : 'mainnet',
  }).catch(() => undefined)
  try {
    // 취소 전에 상태를 조회 — 체인 제출이 끝난 건(txid 존재)은 취소할 수 없고
    // complete 경로로 마감해야 하므로 클라이언트에 txid를 돌려준다.
    const info = await getPiPayment(paymentId, effectiveSandbox).catch(() => null)
    const transaction =
      info && typeof info.transaction === 'object' ? (info.transaction as Record<string, unknown>) : null
    const onChainTxid = typeof transaction?.txid === 'string' ? transaction.txid.trim() : ''
    if (onChainTxid) {
      return corsJson({ ok: true, redirected: 'complete', txid: onChainTxid })
    }
    const status = info?.status && typeof info.status === 'object' ? (info.status as Record<string, unknown>) : null
    if (status?.developer_completed === true || status?.cancelled === true || status?.user_cancelled === true) {
      return corsJson({ ok: true, already: 'final' })
    }
    const payment = await cancelPiPayment(paymentId, effectiveSandbox)
    console.log('[Pi] /api/pi/cancel ok', { paymentId })
    return corsJson({ ok: true, payment })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'cancel failed'
    const upstream = (error as { piHttpStatus?: number } | null)?.piHttpStatus
    // Pi가 '더 이상 취소 불가(이미 완료/만료)'로 4xx를 돌려주면 미완료 락은
    // 이미 해소된 상태 — 복구 호출자가 실패로 오인해 매번 재시도하지 않게 ok로 돌린다.
    if (typeof upstream === 'number' && upstream >= 400 && upstream < 500) {
      console.warn('[Pi] /api/pi/cancel not needed (already final)', { paymentId, upstream, message })
      return corsJson({ ok: true, already: 'final', note: message })
    }
    console.error('[Pi] /api/pi/cancel error', { paymentId, message, ...describeError(error) })
    return corsJson({ error: message }, { status: errorStatus(error, message) })
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
    uid?: unknown
    appInstance?: unknown
  } | null
  if (body && (body as Record<string, unknown>).warmup === true) {
    return corsJson({ ok: true, warmed: true })
  }
  const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
  const txid = typeof body?.txid === 'string' ? body.txid.trim() : ''
  const claimedUid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const appInstance =
    body && typeof body.appInstance === 'string' ? body.appInstance.trim() : ''
  const kind = requestKind(body)
  const sandboxHint = requestSandboxHint(body)
  const effectiveSandbox = isPiSandboxRequest(request, sandboxHint)
  console.log('[Pi] /api/pi/complete incoming', {
    paymentId: paymentId || '(empty)',
    txid: txid || '(empty)',
    kind,
    uid: claimedUid || '(unknown)',
    appInstance: appInstance || '(unknown)',
    sandboxHint,
    effectiveSandbox,
    envSandbox: isPiSandboxEnv(),
  })
  if (!paymentId || !txid) {
    console.error('[Pi] /api/pi/complete rejected: paymentId and txid required')
    return corsJson({ error: 'paymentId and txid required' }, { status: 400 })
  }
  const fallbackAmount = typeof body?.amount === 'number' ? body.amount : null
  const fallbackMetadata =
    body?.metadata && typeof body.metadata === 'object' ? (body.metadata as Record<string, unknown>) : null

  const { recordPiEvent } = await import('@/lib/pi-audit')
  void recordPiEvent({
    kind: 'complete',
    stage: 'received',
    paymentId,
    network: effectiveSandbox ? 'testnet' : 'mainnet',
  }).catch(() => undefined)

  const startedAt = Date.now()
  try {
    const { payment, info, network } = await completePiPayment(paymentId, txid, effectiveSandbox)
    assertPiPaymentCompleted(payment, paymentId, txid)
    // Horizon 교차 검증은 결제가 실제 완료된 네트워크에서 한다 — 결제가 반대
    // 네트워크에 생성됐으면 해석된 sandbox로 조회하면 404로 정상 건을 거부한다.
    await verifyPiTxidOnChain(txid, network === 'testnet')
    console.log('[Pi] /api/pi/complete verified', { paymentId, txid, ms: Date.now() - startedAt })
    void recordPiEvent({
      kind: 'complete',
      stage: 'ok',
      paymentId,
      network: effectiveSandbox ? 'testnet' : 'mainnet',
      ms: Date.now() - startedAt,
    }).catch(() => undefined)
    // kind는 Pi Platform이 보관하는 결제 메타데이터(서버가 조회한 원본)가 권위.
    // 서버 조회가 실패(info null)하거나 원본에 kind가 없으면 클라이언트 주장을
    // '입금 아님' 방향으로만 받아들인다 — 입금 계열 주장은 미검증이면 기록하지
    // 않는다. (사전 충전은 폐지되어 어떤 kind도 잔액 크레딧을 만들지 않는다.)
    const infoKind =
      info?.metadata && typeof info.metadata.kind === 'string' && info.metadata.kind.trim()
        ? info.metadata.kind.trim()
        : ''
    const { markPaymentKind, isDepositPaymentKind } = await import('@/lib/payment-kind-store')
    const metaKind = infoKind === 'wallet-charge' ? 'service-pay' : infoKind || (isDepositPaymentKind(kind) ? '' : kind)
    if (!infoKind && isDepositPaymentKind(kind) && kind) {
      console.warn('[Pi] /api/pi/complete deposit-kind claim unverified; skipping mark', {
        paymentId,
        txid,
        claimedKind: kind,
      })
    }
    if (infoKind === 'wallet-charge') {
      console.warn('[Pi] /api/pi/complete legacy wallet-charge payment; recording as service payment (no credit)', { paymentId, txid })
    }
    await markPaymentKind(txid, metaKind).catch(() => undefined)
    // 검증은 응답 전에 끝내고, 무거운 후속 작업(에스크로·정산 기록·쿠폰 소비)은
    // 응답 이후 백그라운드로 — maxDuration 초과로 함수가 kill돼 응답이 유실되거나
    // 장부가 반만 기록되는 사태를 막는다. 각 단계는 멱등이라 폴러가 복구도 한다.
    after(async () => {
      console.log('[Pi] /api/pi/complete background work start', { paymentId, txid, metaKind })
      const settledMetadata = info?.metadata ?? fallbackMetadata
      await lockRideEscrowFromPayment(paymentId, txid, settledMetadata).catch((lockError) => {
        console.error('[Pi] /api/pi/complete escrow lock failed', { paymentId, lockError })
      })
      // 클라이언트 완료 콜백 유실 대비 — 결제 검증이 끝나면 서버가 라이드를
      // 완료로 전환해 이용자/기사 양쪽 폴링이 바로 같은 상태를 받는다.
      await settleEscrowRideFromPayment(paymentId, txid, settledMetadata).catch((err) => {
        console.error('[Pi] /api/pi/complete ride settle transition failed', { paymentId, err })
      })
      // 요금 계열 결제는 이용자 결제 장부에 결제액을 같은 완료 흐름에서 기록한다 —
      // 서버 조회값(uid·from_address·amount)만 쓰고, txid 멱등이라 콜백 재시도가
      // 이중 기록하지 않는다. 사전 충전 잔액 차감이 아니라 직결제 영수증 기록이다.
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
        // 쿠폰이 메타데이터에 있으면 완료 시점에 소비를 확정한다 — 할인액은
        // 플랫폼 부담이며 txid 멱등이라 콜백 재시도가 이중 소진하지 않는다.
        const couponCode =
          settledMetadata && typeof settledMetadata.couponCode === 'string' ? settledMetadata.couponCode.trim() : ''
        if (couponCode) {
          const uid = typeof info?.user_uid === 'string' ? info.user_uid : ''
          const gross =
            settledMetadata && typeof settledMetadata.grossAmount === 'number' && settledMetadata.grossAmount > 0
              ? settledMetadata.grossAmount
              : typeof info?.amount === 'number'
                ? info.amount
                : (fallbackAmount ?? 0)
          if (uid && gross > 0) {
            const { redeemCoupon } = await import('@/lib/coupon-store')
            await redeemCoupon(couponCode, uid, gross, txid).catch((couponError) => {
              console.error('[Pi] /api/pi/complete coupon redeem failed', { paymentId, couponCode, couponError })
            })
          }
        }
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
    return corsJson({ ok: true, payment })
  } catch (error) {
    // 샌드박스 폴백 없음 — 검증 실패(취소·txid 불일치·체인 거부)를 ok로 위장해
    // 에스크로/정산을 기록하는 것은 가짜 '처리됨' 상태를 만든다. 실제 체인 결제가
    // 된 경우는 입금 스캐너·미완료 결제 복구가 잡아낸다.
    const message = error instanceof Error ? error.message : 'complete failed'
    const upstreamStatus = (error as { piHttpStatus?: number } | null)?.piHttpStatus
    console.error('[Pi] /api/pi/complete error', {
      paymentId,
      txid,
      kind,
      message,
      ms: Date.now() - startedAt,
      ...describeError(error),
    })
    void recordPiEvent({
      kind: 'complete',
      stage: 'error',
      paymentId,
      network: effectiveSandbox ? 'testnet' : 'mainnet',
      ms: Date.now() - startedAt,
      httpStatus: typeof upstreamStatus === 'number' ? upstreamStatus : undefined,
      message: message.slice(0, 300),
    }).catch(() => undefined)
    // 테스트넷 Mock 완료 — 검증 실패를 정산·에스크로·장부 없이 ok로만 돌린다.
    // 테스트 플로우의 UI 진행은 살리되 가짜 정산 기록은 만들지 않는다.
    if (piPaymentMockEnabled(effectiveSandbox)) {
      console.warn('[Pi] /api/pi/complete MOCK completion (PI_PAYMENT_MOCK/testnet)', {
        paymentId,
        txid,
        originalError: message,
      })
      void recordPiEvent({
        kind: 'complete',
        stage: 'ok',
        paymentId,
        network: effectiveSandbox ? 'testnet' : 'mainnet',
        message: 'mock completion (test mode, no settlement recorded)',
      }).catch(() => undefined)
      return corsJson({ ok: true, mockCompleted: true })
    }
    return corsJson({ error: message }, { status: errorStatus(error, message) })
  }
}
