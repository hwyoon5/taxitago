import { isPiSandboxEnv } from '@/lib/pi-sandbox'

// 하드코드된 폴백 API 키는 두지 않는다 — 구 앱 소유 키가 폴백으로 남아 있으면
// 신규 앱의 결제를 다른 프로젝트 키로 승인하려다 401/404로 만료되는 장애를
// 조용히 가린다. 키는 반드시 env(PI_API_KEY_TESTNET 등)로만 주입하고, 없으면
// 명시적 오류로 실패한다.

type PiNetwork = 'testnet' | 'mainnet'
type PiKeyChoice = { key: string; source: string }

/**
 * 키의 네트워크 스코프 — sk_live_ 는 메인넷 전용, sk_test_/sk_sandbox_ 는
 * 테스트넷 전용. 접두사가 없는 레거시 키는 'unknown'으로 두고 호출 시점에
 * 결정된 네트워크에만 사용한다(교차 네트워크 재시도는 없다).
 */
function piKeyNetworkScope(key: string): PiNetwork | 'unknown' {
  const k = key.trim().toLowerCase()
  if (k.startsWith('sk_live_')) return 'mainnet'
  if (k.startsWith('sk_test_') || k.startsWith('sk_sandbox_')) return 'testnet'
  return 'unknown'
}

function readEnvKeys(names: readonly string[]): string[] {
  return names
    .map((name) => (process.env[name] || '').trim())
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
}

/**
 * 결제가 실제로 생성된 네트워크를 우선으로 키를 고른다. 클라이언트 SDK가
 * sandbox=true로 만든 테스트넷 결제를 서버 env(메인넷) 키로 승인하면
 * Pi Platform이 401/403으로 거부해 지갑이 "결제 만료"로 끝난다 — 그래서
 * 클라이언트가 보낸 sandbox 힌트를 서버 env보다 우선한다.
 *
 * 네트워크 분리는 엄격하다 — 결정된 네트워크의 키만 시도한다:
 *   testnet → PI_API_KEY_TESTNET계 env → 강제 테스트넷 키(마지막 폴백)
 *   mainnet → PI_API_KEY_MAINNET계 env (테스트넷 키는 절대 시도 안 함)
 * 공용 키(PI_NETWORK_API_KEY/PI_API_KEY)는 스코프 접두사가 없을 때만 해당
 * 네트워크 후보로 쓰인다 — sk_live_ 키가 테스트넷 호출에 새지 않는다.
 * 첫 키가 401/403으로 거부되면 남은 후보로 한 번씩 자동 재시도한다.
 */
function resolvePiApiKeys(sandboxHint?: boolean | null): PiKeyChoice[] {
  const sandbox = typeof sandboxHint === 'boolean' ? sandboxHint : isPiSandboxEnv()
  const network: PiNetwork = sandbox ? 'testnet' : 'mainnet'
  const choices: PiKeyChoice[] = []
  // 네트워크 전용 env — 이름으로 스코프가 고정되므로 자기 네트워크에서만 읽는다.
  const scopedNames = sandbox
    ? (['PI_API_KEY_TESTNET', 'PI_TESTNET_API_KEY', 'PI_SANDBOX_API_KEY'] as const)
    : (['PI_API_KEY_MAINNET', 'PI_MAINNET_API_KEY'] as const)
  for (const key of readEnvKeys(scopedNames)) {
    const scope = piKeyNetworkScope(key)
    if (scope !== 'unknown' && scope !== network) {
      console.warn('[Pi] scoped API key skipped: key prefix does not match its env scope', { network })
      continue
    }
    choices.push({ key, source: 'env-scoped' })
  }
  // 공용 레거시 키 — 스코프 접두사가 붙은 키는 네트워크가 다르면 건너뛴다.
  for (const key of readEnvKeys(['PI_NETWORK_API_KEY', 'PI_API_KEY'])) {
    const scope = piKeyNetworkScope(key)
    if (scope !== 'unknown' && scope !== network) {
      console.warn('[Pi] shared API key skipped: key prefix does not match resolved network', { network })
      continue
    }
    choices.push({ key, source: 'env' })
  }
  if (!choices.length) {
    throw new Error(
      `PI_API_KEY is not configured for ${network} — set PI_API_KEY_${sandbox ? 'TESTNET' : 'MAINNET'} or a shared PI_API_KEY/PI_NETWORK_API_KEY`,
    )
  }
  return choices
}

/**
 * Payments Platform API base — 네트워크별로 분기한다. 테스트넷 결제를
 * api.minepi.com(메인넷 호스트)에 승인/완료 요청하면 테스트넷 키가 해당
 * 앱으로 인증되지 않아 401이 난다 — /v2/me 검증부(piPlatformApiBase)와
 * 같은 규칙으로 결제 네트워크의 호스트를 고른다.
 * PI_PAYMENTS_API_URL로 전체 경로를, PI_PLATFORM_API_URL로 호스트를 강제 지정 가능.
 */
function piPaymentsApiBase(sandboxHint?: boolean | null) {
  const override = (process.env.PI_PAYMENTS_API_URL || '').trim()
  if (override) return override.replace(/\/+$/, '')
  const platform = (process.env.PI_PLATFORM_API_URL || '').trim()
  if (platform) return `${platform.replace(/\/+$/, '')}/v2/payments`
  const sandbox = typeof sandboxHint === 'boolean' ? sandboxHint : isPiSandboxEnv()
  return sandbox ? 'https://api.testnet.minepi.com/v2/payments' : 'https://api.minepi.com/v2/payments'
}

function piPaymentUrl(paymentId: string, base: string, pathSuffix = '') {
  return `${base}/${encodeURIComponent(paymentId)}${pathSuffix}`
}

/** GET/complete calls — not on the wallet expiry path, so they can afford a wider budget. */
const PI_FETCH_TIMEOUT_MS = 45_000
/**
 * Approve sits inside the Pi wallet's server-approval window — a hanging
 * call here is what makes the wallet show "결제가 만료되었습니다". Each
 * attempt gets a generous 8s so slow-but-healthy Pi API responses still
 * succeed, with one retry as a safety net.
 */
const PI_APPROVE_TIMEOUT_MS = 8_000
const PI_APPROVE_ATTEMPTS = 2

export function describeError(error: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  let current: unknown = error
  for (let depth = 0; current && depth < 4; depth += 1) {
    const record = current as Record<string, unknown>
    const prefix = depth === 0 ? '' : `cause.${depth}.`
    if (record instanceof Error || typeof record === 'object') {
      out[`${prefix}name`] = typeof record.name === 'string' ? record.name : undefined
      out[`${prefix}message`] = typeof record.message === 'string' ? record.message : String(current)
      for (const key of ['code', 'errno', 'syscall', 'hostname', 'address', 'port', 'status', 'piHttpStatus', 'piHttpBody', 'type'] as const) {
        if (record[key] !== undefined) out[`${prefix}${key}`] = record[key]
      }
      if (typeof record.stack === 'string') out[`${prefix}stack`] = record.stack.split('\n').slice(0, 4).join('\n')
      current = record.cause
    } else {
      out[`${prefix}value`] = String(current)
      current = null
    }
  }
  return out
}

function piHttpError(message: string, status: number, body?: string) {
  const error = new Error(message) as Error & { piHttpStatus?: number; piHttpBody?: string }
  error.piHttpStatus = status
  if (body) error.piHttpBody = body
  return error
}

async function piPaymentsRequest(
  paymentId: string,
  method: 'GET' | 'POST',
  pathSuffix: string,
  body: Record<string, string> | undefined,
  timeoutMs: number,
  apiKey: string,
  keySource: string,
  apiBase: string,
) {
  const url = piPaymentUrl(paymentId, apiBase, pathSuffix)
  const startedAt = Date.now()
  console.log(`[Pi] ${method} ${url} start`, { apiKey: keySource, timeoutMs })

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    // fetch가 던지는 예외를 세분화해 기록한다 — AbortSignal.timeout은 Node에서
    // name='TimeoutError'로 오므로 타임아웃과 진짜 네트워크 단절을 구분한다.
    const timedOut =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    console.error(`[Pi] ${method} ${url} network error`, {
      ms: Date.now() - startedAt,
      timeoutMs,
      timedOut,
      ...describeError(error),
    })
    throw error
  }

  const elapsed = Date.now() - startedAt
  const raw = await response.text().catch(() => '')
  let payload: unknown = null
  try {
    payload = raw ? JSON.parse(raw) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : `Pi API ${response.status}`
    // err.response.data에 해당 — Pi API가 돌려준 파싱된 본문과 원문을 함께 남긴다.
    console.error(`[Pi] ${method} ${url} failed`, {
      status: response.status,
      ms: elapsed,
      body: raw.slice(0, 1000),
      payload,
      message,
    })
    throw piHttpError(message, response.status, raw.slice(0, 1000))
  }

  console.log(`[Pi] ${method} ${url} success`, { status: response.status, ms: elapsed })
  return payload
}

/**
 * 결제용 호출 공통 래퍼 — 401/403(키-앱 불일치·만료 키)은 즉시 반환되는
 * 저비용 실패이므로 남은 키 후보로 한 번씩 교체 시도한다. 그 외 에러는
 * 재시도 판단을 호출자(approvePiPayment)에 맡겨 그대로 던진다.
 */
async function piPaymentsRequestAuthed(
  paymentId: string,
  method: 'GET' | 'POST',
  pathSuffix = '',
  body?: Record<string, string>,
  timeoutMs = PI_FETCH_TIMEOUT_MS,
  sandboxHint?: boolean | null,
) {
  const keys = resolvePiApiKeys(sandboxHint)
  const apiBase = piPaymentsApiBase(sandboxHint)
  let lastError: unknown
  for (const { key, source } of keys) {
    try {
      return await piPaymentsRequest(paymentId, method, pathSuffix, body, timeoutMs, key, source, apiBase)
    } catch (error) {
      lastError = error
      const status = (error as { piHttpStatus?: number } | null)?.piHttpStatus
      if (status === 401 || status === 403) {
        console.warn('[Pi] API key rejected; trying alternate key', { status, source })
        continue
      }
      throw error
    }
  }
  throw lastError
}

export async function getPiPayment(paymentId: string, sandboxHint?: boolean | null) {
  return (await piPaymentsRequestAuthed(paymentId, 'GET', '', undefined, PI_FETCH_TIMEOUT_MS, sandboxHint)) as {
    amount?: number
    metadata?: Record<string, unknown>
    [key: string]: unknown
  } | null
}

/**
 * 승인 한 번의 시도 — 키 후보를 전부 동시에 보내 가장 먼저 성공한 응답을 채택한다.
 * 지갑의 서버 승인 마감(~수십 초) 안에서 401 스테일 키를 순차 폴백하다 보면
 * 유효 키가 뒤에 있어도 만료에 걸린다. approve는 paymentId 멱등 POST라 같은
 * 네트워크 키들의 중복 승인은 Pi가 안전하게 처리한다(이미 승인된 건은 4xx로
 * 빠르게 반환되며, 먼저 성공한 응답이 채택된 뒤 도착한 실패는 무시된다).
 */
function piApproveAttempt(paymentId: string, timeoutMs: number, sandboxHint?: boolean | null) {
  const keys = resolvePiApiKeys(sandboxHint)
  const apiBase = piPaymentsApiBase(sandboxHint)
  console.log('[Pi] approve key candidates', { count: keys.length, sources: keys.map((k) => k.source), apiBase })
  if (keys.length === 1) {
    const only = keys[0]
    return piPaymentsRequest(paymentId, 'POST', '/approve', undefined, timeoutMs, only.key, only.source, apiBase)
  }
  return new Promise((resolve, reject) => {
    let pending = keys.length
    let lastError: unknown
    let authError: unknown
    for (const { key, source } of keys) {
      piPaymentsRequest(paymentId, 'POST', '/approve', undefined, timeoutMs, key, source, apiBase)
        .then(resolve)
        .catch((error) => {
          lastError = error
          // 401/403은 '키-앱 불일치'라는 설정 오류의 증거 — 전부 실패했을 때
          // 타임아웃보다 인증 거절을 우선 리포트해 원인이 로그에 남게 한다.
          const status = (error as { piHttpStatus?: number } | null)?.piHttpStatus
          if (!authError && (status === 401 || status === 403)) authError = error
          pending -= 1
          if (pending === 0) reject(authError ?? lastError)
        })
    }
  })
}

/**
 * Pi API 404 = 조회한 네트워크에 그 paymentId가 없다는 뜻 — 결제 네임스페이스는
 * 네트워크별로 분리된다. 클라이언트 힌트·호스트·env 해석이 SDK가 실제 결제를
 * 만든 네트워크와 어긋나면 반대 네트워크를 두드려 404가 떨어진다. 404면
 * 반대 네트워크에서 결제 존재를 확인하고, 있으면 그쪽으로 작업을 이어간다.
 */
async function withNetworkFallback<T>(paymentId: string, sandbox: boolean, op: (sandbox: boolean) => Promise<T>) {
  try {
    return { value: await op(sandbox), sandbox }
  } catch (error) {
    if ((error as { piHttpStatus?: number } | null)?.piHttpStatus !== 404) throw error
    const found = (await getPiPayment(paymentId, !sandbox).catch(() => null)) as Record<string, unknown> | null
    if (!found) {
      // 양쪽 네트워크 모두에 paymentId가 없다 = 결제가 생성된 앱과 API 키의
      // 앱이 다르다(포털 앱 분리). 도메인이 지갑에선 구 앱으로 열리는데 키는
      // 신규 앱 것이면 이런 404가 나온다 — diagnostics fingerprints로 대조.
      console.error(
        '[Pi] payment not found on EITHER network — app/key mismatch suspected. ' +
          'The payment was created under a different Pi app than the configured API key.',
        { paymentId, triedSandbox: sandbox },
      )
      throw error
    }
    console.warn('[Pi] payment exists on the other network; retrying there', {
      paymentId,
      resolvedSandbox: sandbox,
      actualSandbox: !sandbox,
    })
    return { value: await op(!sandbox), sandbox: !sandbox }
  }
}

/**
 * Approve must answer inside the wallet expiry window. Retry once on network
 * stalls and 5xx; 4xx (already approved/cancelled/expired) is final.
 */
export async function approvePiPayment(paymentId: string, sandboxHint?: boolean | null) {
  const primary = typeof sandboxHint === 'boolean' ? sandboxHint : isPiSandboxEnv()
  return (await withNetworkFallback(paymentId, primary, (sandbox) => approvePiPaymentOn(paymentId, sandbox))).value
}

async function approvePiPaymentOn(paymentId: string, sandbox: boolean) {
  let lastError: unknown
  for (let attempt = 0; attempt < PI_APPROVE_ATTEMPTS; attempt += 1) {
    const attemptStart = Date.now()
    try {
      return await piApproveAttempt(paymentId, PI_APPROVE_TIMEOUT_MS, sandbox)
    } catch (error) {
      lastError = error
      const status = (error as { piHttpStatus?: number } | null)?.piHttpStatus
      if (typeof status === 'number' && status < 500) {
        // approve는 멱등이어야 하지만 Pi가 중복 호출을 4xx로 돌릴 수 있다 —
        // beacon+fetch 경합이나 '느린 첫 시도 뒤 재시도'에서 두 번째 approve가
        // 첫 번째의 성공 뒤에 도착하면 '이미 승인됨' 오류로 겉보기 실패한다.
        // 실패 표면화 전에 GET으로 현재 상태를 확인해 developer_approved면
        // 승인 성공으로 수렴한다(지갑은 Pi 기록의 승인 여부를 보고 진행한다).
        const existing = (await getPiPayment(paymentId, sandbox).catch(() => null)) as {
          status?: Record<string, unknown>
        } | null
        if (existing?.status?.developer_approved === true) {
          console.log('[Pi] approve 4xx but payment already approved — treating as ok', {
            paymentId,
            rejectedStatus: status,
          })
          return existing
        }
        break
      }
      // A retry only helps if the first attempt failed fast — once most of the
      // wallet's approval window is gone, a second 8s attempt lands post-expiry.
      if (attempt + 1 < PI_APPROVE_ATTEMPTS && Date.now() - attemptStart < 4_000) {
        console.warn(`[Pi] approve attempt ${attempt + 1} failed; retrying once`, { paymentId })
        await new Promise((resolve) => setTimeout(resolve, 350))
        continue
      }
      break
    }
  }
  throw lastError
}

/**
 * 승인 후 체인 제출 전까지 남은 미완료 결제는 txid가 없어 complete할 수 없다 —
 * Pi Platform의 cancel로 종료해 다음 결제의 승인 락을 푼다.
 */
export async function cancelPiPayment(paymentId: string, sandboxHint?: boolean | null) {
  const primary = typeof sandboxHint === 'boolean' ? sandboxHint : isPiSandboxEnv()
  return (
    await withNetworkFallback(paymentId, primary, (sandbox) =>
      piPaymentsRequestAuthed(paymentId, 'POST', '/cancel', undefined, PI_FETCH_TIMEOUT_MS, sandbox),
    )
  ).value
}

export async function completePiPayment(paymentId: string, txid: string, sandboxHint?: boolean | null) {
  const primary = typeof sandboxHint === 'boolean' ? sandboxHint : isPiSandboxEnv()
  const { value, sandbox: actualSandbox } = await withNetworkFallback(paymentId, primary, async (sandbox) => {
    const infoPromise = getPiPayment(paymentId, sandbox).catch(() => null)
    const payment = await piPaymentsRequestAuthed(
      paymentId,
      'POST',
      '/complete',
      { txid },
      PI_FETCH_TIMEOUT_MS,
      sandbox,
    )
    // info는 결제 kind의 권위 있는 출처 — 1차 GET이 실패하면 한 번 더 조회해
    // 클라이언트 주장 kind에 의존해야 하는 경우를 줄인다.
    const info = (await infoPromise) ?? (await getPiPayment(paymentId, sandbox).catch(() => null))
    return { payment, info }
  })
  // 후속 검증(Horizon txid·정산)도 실제 완료된 네트워크 기준으로 이어가야
  // 반대 네트워크에서 조회하다 404로 정상 완료 건을 거부하는 일이 없다.
  return { ...value, network: actualSandbox ? 'testnet' : 'mainnet' }
}

/**
 * A bare 2xx from Pi's /complete is not proof of settlement — insist on the
 * documented completion markers: developer_completed / transaction.verified,
 * a matching txid, no cancellation, and a matching identifier.
 */
export function assertPiPaymentCompleted(payment: unknown, paymentId: string, txid: string) {
  if (!payment || typeof payment !== 'object') {
    throw new Error('payment verification failed: empty completion response')
  }
  const record = payment as Record<string, unknown>
  const identifier = record.identifier
  if (typeof identifier === 'string' && identifier.trim() && identifier !== paymentId) {
    throw new Error('payment verification failed: identifier mismatch')
  }
  const status = record.status && typeof record.status === 'object' ? (record.status as Record<string, unknown>) : null
  if (status?.cancelled === true || status?.user_cancelled === true) {
    throw new Error('payment verification failed: cancelled')
  }
  if (status?.developer_completed === false) {
    throw new Error('payment verification failed: not completed')
  }
  const transaction =
    record.transaction && typeof record.transaction === 'object' ? (record.transaction as Record<string, unknown>) : null
  const onChainTxid = typeof transaction?.txid === 'string' ? transaction.txid.trim() : ''
  if (onChainTxid && onChainTxid !== txid) {
    throw new Error('payment verification failed: txid mismatch')
  }
  if (transaction?.verified === false) {
    throw new Error('payment verification failed: unverified transaction')
  }
  if (!(status?.developer_completed === true || transaction?.verified === true)) {
    throw new Error('payment verification failed: completion not confirmed')
  }
}

/**
 * Pi accessToken 서버 검증 — `/v2/me`는 서비스 Key가 아니라 이용자 토큰을
 * Bearer로 받는다. 유효하면 토큰 소유자의 Pi uid, 아니면 null을 돌려준다.
 * 장애·타임아웃도 null(fail-closed) — 인증 확인이 불가한 호출을 통과시키지 않는다.
 */
/**
 * Platform API base — 네트워크별로 분기한다. 테스트넷 토큰을 메인넷
 * api.minepi.com/v2/me로 검증하면 거절돼 테스트 도메인 로그인이 "세션 끊김"으로
 * 실패한다. PI_PLATFORM_API_URL로 강제 지정 가능.
 */
function piPlatformApiBase(sandboxHint?: boolean | null) {
  const override = (process.env.PI_PLATFORM_API_URL || '').trim()
  if (override) return override.replace(/\/+$/, '')
  const sandbox = typeof sandboxHint === 'boolean' ? sandboxHint : isPiSandboxEnv()
  return sandbox ? 'https://api.testnet.minepi.com' : 'https://api.minepi.com'
}

export type PiTokenInspection = {
  uid: string | null
  /** 'ok' — 토큰 유효 · 'invalid' — 401/403으로 명시적 거절(만료/위조)
   *  'unreachable' — /v2/me 장애·타임아웃·미구현·파싱 실패로 판정 불가 */
  status: 'ok' | 'invalid' | 'unreachable'
}

export async function inspectPiAccessToken(accessToken: string, sandboxHint?: boolean | null): Promise<PiTokenInspection> {
  const token = accessToken.trim()
  if (!token) return { uid: null, status: 'invalid' }
  const base = piPlatformApiBase(sandboxHint)
  try {
    const res = await fetch(`${base}/v2/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) {
      console.warn('[Pi] access token rejected', { status: res.status, base })
      return { uid: null, status: res.status === 401 || res.status === 403 ? 'invalid' : 'unreachable' }
    }
    const data = (await res.json().catch(() => null)) as { uid?: unknown } | null
    const uid = typeof data?.uid === 'string' && data.uid.trim() ? data.uid.trim() : null
    return uid ? { uid, status: 'ok' } : { uid: null, status: 'unreachable' }
  } catch (error) {
    console.error('[Pi] access token verification failed', { base, ...describeError(error) })
    return { uid: null, status: 'unreachable' }
  }
}

export async function verifyPiAccessToken(accessToken: string, sandboxHint?: boolean | null): Promise<string | null> {
  const result = await inspectPiAccessToken(accessToken, sandboxHint)
  // 장애·타임아웃도 null(fail-closed) — 인증 확인이 불가한 호출을 통과시키지 않는다.
  return result.status === 'ok' ? result.uid : null
}

/**
 * 관리자 진단용 — 결제가 '개발자 승인 만료'로 끝날 때 원인을 서버에서 바로
 * 확인하기 위한 설정/도달성 요약. 키 값은 절대 노출하지 않고 env 이름만 돌린다.
 *
 * probe: 존재하지 않는 paymentId + 무효 키로 Pi Payments API를 한 번 두드린다.
 *   reachable=true + status 401/404 → egress 정상, 키-앱 불일치 가능성을 본다.
 *   reachable=false → Vercel→Pi API 연결 자체가 막힌 것(DNS/방화벽/타임아웃).
 */
/**
 * 키 식별용 지문 — 값 자체가 아니라 앞 6자와 전체 길이만 노출한다.
 * 개발자 포털의 구 테스트넷 앱 키와 신규 앱 키 중 어느 것이 배포돼 있는지
 * 대조할 때 쓴다(포털에 표시된 키 앞자리와 비교).
 */
function piKeyFingerprint(key: string) {
  return { prefix: `${key.trim().slice(0, 6)}…`, length: key.trim().length }
}

export async function piPaymentDiagnostics(sandboxHint?: boolean | null) {
  const sandbox = typeof sandboxHint === 'boolean' ? sandboxHint : isPiSandboxEnv()
  const network: PiNetwork = sandbox ? 'testnet' : 'mainnet'
  const scopedNames = sandbox
    ? (['PI_API_KEY_TESTNET', 'PI_TESTNET_API_KEY', 'PI_SANDBOX_API_KEY'] as const)
    : (['PI_API_KEY_MAINNET', 'PI_MAINNET_API_KEY'] as const)
  const configuredScoped = scopedNames.filter((name) => Boolean((process.env[name] || '').trim()))
  const configuredShared = (['PI_NETWORK_API_KEY', 'PI_API_KEY'] as const).filter((name) => {
    const value = (process.env[name] || '').trim()
    if (!value) return false
    const scope = piKeyNetworkScope(value)
    return scope === 'unknown' || scope === network
  })
  // 어떤 앱의 키가 배포돼 있는지 포털과 대조할 수 있게 env 이름 + 지문을 나열한다.
  const keyFingerprints = [
    ...scopedNames
      .map((name) => ({ name, ...(process.env[name]?.trim() ? piKeyFingerprint(process.env[name]!) : null) }))
      .filter((entry) => entry.prefix),
    ...(['PI_NETWORK_API_KEY', 'PI_API_KEY'] as const)
      .map((name) => ({ name, ...(process.env[name]?.trim() ? piKeyFingerprint(process.env[name]!) : null) }))
      .filter((entry) => entry.prefix),
  ]
  const apiBase = piPaymentsApiBase(sandbox)

  const probeStart = Date.now()
  let probe: Record<string, unknown>
  try {
    const res = await fetch(`${apiBase}/__diagnostics_probe__`, {
      headers: { Authorization: 'Key __diagnostics_probe__' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    await res.arrayBuffer().catch(() => undefined)
    probe = { reachable: true, status: res.status, ms: Date.now() - probeStart }
  } catch (error) {
    probe = { reachable: false, ms: Date.now() - probeStart, ...describeError(error) }
  }

  // 최근 승인/완료 이벤트 — 'received'만 있고 ok/error가 없으면 요청이 서버까지
  // 도달했지만 업스트림 응답 전에 함수가 죽은 것, 아무것도 없으면 클라이언트
  // 요청이 서버에 도달하지 않은 것(CORS·경로·네트워크 문제)으로 판별할 수 있다.
  const { listPiEvents } = await import('@/lib/pi-audit')
  const recentEvents = await listPiEvents().catch(() => [])

  return {
    network,
    apiBase,
    horizonBase: piHorizonUrl(sandbox),
    keys: {
      configuredScoped,
      configuredShared,
      missing: !configuredScoped.length && !configuredShared.length,
      fingerprints: keyFingerprints,
    },
    probe,
    recentEvents,
  }
}

/**
 * 결제 시작 전 사전 점검 — 설정된 키로 존재하지 않는 paymentId를 GET해
 * Pi가 키를 받아들이는지 확인한다(404=키 정상·결제 없음, 401/403=키-앱
 * 불일치). 여기서 false면 실제 approve도 같은 이유로 실패하므로 지갑을
 * 만료까지 기다리게 하지 말고 클라이언트가 즉시 중단하게 한다.
 * 키 값·env 이름은 응답에 넣지 않는다.
 */
export async function piPaymentHealth(sandboxHint?: boolean | null) {
  const sandbox = typeof sandboxHint === 'boolean' ? sandboxHint : isPiSandboxEnv()
  const keys = resolvePiApiKeys(sandbox)
  const apiBase = piPaymentsApiBase(sandbox)
  const url = piPaymentUrl('__health_probe__', apiBase)
  const startedAt = Date.now()
  const network = sandbox ? 'testnet' : 'mainnet'
  for (let i = 0; i < keys.length; i += 1) {
    const { key, source } = keys[i]
    const isLast = i === keys.length - 1
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Key ${key}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      })
      await res.arrayBuffer().catch(() => undefined)
      if (res.status === 404) {
        return { ready: true, network, keyStatus: 'accepted', ms: Date.now() - startedAt }
      }
      if (res.status === 401 || res.status === 403) {
        console.warn('[Pi] health probe key rejected; trying next candidate', { status: res.status, source })
        continue
      }
      // 5xx 등 Pi측 일시 장애 — 마지막 후보까지 같은 결과면 '판단 불가'로
      // ready를 유지해 체크아웃을 막지 않는다(실제 approve가 같은 응답을 주면
      // 그때 실패로 수렴한다).
      if (isLast) {
        return { ready: true, network, keyStatus: 'uncertain', httpStatus: res.status, ms: Date.now() - startedAt }
      }
      continue
    } catch (error) {
      console.error('[Pi] health probe network error', { source, ...describeError(error) })
      if (isLast) {
        return { ready: false, network, keyStatus: 'unreachable', ms: Date.now() - startedAt }
      }
    }
  }
  return { ready: false, network, keyStatus: 'rejected', ms: Date.now() - startedAt }
}

function piHorizonUrl(sandboxHint?: boolean | null) {
  const override = (process.env.PI_HORIZON_URL || '').trim()
  if (override) return override
  // 결제가 실제 생성된 네트워크를 우선 — 서버 env와 어긋나면 테스트넷
  // txid를 메인넷 Horizon에서 찾다 404로 거부하는 사태가 생긴다.
  const sandbox = typeof sandboxHint === 'boolean' ? sandboxHint : isPiSandboxEnv()
  return sandbox ? 'https://api.testnet.minepi.com' : 'https://api.mainnet.minepi.com'
}

/**
 * Cross-check the txid on Horizon. Definitive negatives (404 / failed tx) throw;
 * transient Horizon problems only warn — Pi API's own verification stands.
 */
export async function verifyPiTxidOnChain(txid: string, sandboxHint?: boolean | null) {
  const url = `${piHorizonUrl(sandboxHint)}/transactions/${encodeURIComponent(txid)}`
  let response: Response | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    } catch (error) {
      console.warn('[Pi] horizon txid lookup unreachable; relying on Pi API verification', { txid, ...describeError(error) })
      return
    }
    // 방금 브로드캐스트된 txid는 Horizon 인덱싱이 늦어 404가 날 수 있다 —
    // 2초 기다렸다가 한 번만 재조회하고, 그래도 없으면 그때 거부한다.
    if (response.status === 404 && attempt === 0) {
      console.warn('[Pi] horizon txid 404; retrying once after indexing delay', { txid })
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      continue
    }
    break
  }
  if (!response) return
  if (response.status === 404) {
    console.error('[Pi] horizon txid not found', { txid })
    throw new Error('blockchain transaction not found')
  }
  if (!response.ok) {
    console.warn('[Pi] horizon txid lookup failed; relying on Pi API verification', { txid, status: response.status })
    return
  }
  const payload = (await response.json().catch(() => null)) as { successful?: unknown } | null
  if (payload?.successful === false) {
    console.error('[Pi] horizon txid failed on-chain', { txid })
    throw new Error('blockchain transaction failed')
  }
}

async function a2uPost(
  input: { amount: number; memo: string; uid: string; metadata?: Record<string, unknown> },
  apiKey: string,
  apiBase: string,
) {
  const url = apiBase
  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        payment: {
          amount: input.amount,
          memo: input.memo.slice(0, 25),
          metadata: input.metadata ?? {},
          uid: input.uid,
        },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(PI_FETCH_TIMEOUT_MS),
    })
  } catch (error) {
    console.error(`[Pi] POST ${url} A2U network error`, {
      ms: Date.now() - startedAt,
      timeoutMs: PI_FETCH_TIMEOUT_MS,
      timedOut: error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'),
      ...describeError(error),
    })
    throw error
  }
  const raw = await response.text().catch(() => '')
  let payload: unknown = null
  try {
    payload = raw ? JSON.parse(raw) : null
  } catch {
    payload = null
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : `Pi A2U ${response.status}`
    console.error(`[Pi] POST ${url} A2U failed`, { status: response.status, ms: Date.now() - startedAt, body: raw.slice(0, 500) })
    throw piHttpError(message, response.status)
  }
  return payload as { identifier?: string; transaction?: { txid?: string } }
}

export async function createA2UPayment(
  input: { amount: number; memo: string; uid: string; metadata?: Record<string, unknown> },
  sandboxHint?: boolean | null,
) {
  const keys = resolvePiApiKeys(sandboxHint)
  const apiBase = piPaymentsApiBase(sandboxHint)
  let lastError: unknown
  for (const { key, source } of keys) {
    try {
      console.log('[Pi] POST A2U start', { apiKey: source, apiBase })
      return await a2uPost(input, key, apiBase)
    } catch (error) {
      lastError = error
      const status = (error as { piHttpStatus?: number } | null)?.piHttpStatus
      if (status === 401 || status === 403) {
        console.warn('[Pi] A2U api key rejected; trying alternate key', { status, source })
        continue
      }
      throw error
    }
  }
  throw lastError
}
