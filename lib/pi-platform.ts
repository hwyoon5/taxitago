import { isPiSandboxEnv } from '@/lib/pi-sandbox'

const PI_API_BASE = 'https://api.minepi.com/v2/payments'

/**
 * Pi 개발자 포털 도메인 인증 충돌 우회용 임시 테스트넷 키.
 * 샌드박스/테스트넷 모드에서는 PI_API_KEY 설정과 무관하게 이 키를 강제로 사용한다.
 * 메인넷(NEXT_PUBLIC_PI_SANDBOX=false/0/mainnet)에서는 절대 사용되지 않는다.
 * TODO: 포털 도메인 인증이 정리되면 제거하고 PI_API_KEY로 되돌린다.
 */
const PI_TESTNET_API_KEY = 'Uyu7admbaeoeucn1yfqsg57l71oa2ah5ldyoe5urrpyjzr9mse2pdmof3o1ee1nd'

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
 *   testnet → 강제 테스트넷 키 + PI_API_KEY_TESTNET계 env
 *   mainnet → PI_API_KEY_MAINNET계 env (테스트넷 키는 절대 시도 안 함)
 * 공용 키(PI_NETWORK_API_KEY/PI_API_KEY)는 스코프 접두사가 없을 때만 해당
 * 네트워크 후보로 쓰인다 — sk_live_ 키가 테스트넷 호출에 새지 않는다.
 * 첫 키가 401/403으로 거부되면 남은 후보로 한 번씩 자동 재시도한다.
 */
function resolvePiApiKeys(sandboxHint?: boolean | null): PiKeyChoice[] {
  const sandbox = typeof sandboxHint === 'boolean' ? sandboxHint : isPiSandboxEnv()
  const network: PiNetwork = sandbox ? 'testnet' : 'mainnet'
  const choices: PiKeyChoice[] = []
  if (sandbox) choices.push({ key: PI_TESTNET_API_KEY, source: 'forced-testnet' })
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

function piPaymentUrl(paymentId: string, pathSuffix = '') {
  return `${PI_API_BASE}/${encodeURIComponent(paymentId)}${pathSuffix}`
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
      for (const key of ['code', 'errno', 'syscall', 'hostname', 'address', 'port', 'status', 'type'] as const) {
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

function piHttpError(message: string, status: number) {
  const error = new Error(message) as Error & { piHttpStatus?: number }
  error.piHttpStatus = status
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
) {
  const url = piPaymentUrl(paymentId, pathSuffix)
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
    throw piHttpError(message, response.status)
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
  let lastError: unknown
  for (const { key, source } of keys) {
    try {
      return await piPaymentsRequest(paymentId, method, pathSuffix, body, timeoutMs, key, source)
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
 * Approve must answer inside the wallet expiry window. Retry once on network
 * stalls and 5xx; 4xx (already approved/cancelled/expired) is final.
 */
export async function approvePiPayment(paymentId: string, sandboxHint?: boolean | null) {
  let lastError: unknown
  for (let attempt = 0; attempt < PI_APPROVE_ATTEMPTS; attempt += 1) {
    const attemptStart = Date.now()
    try {
      return await piPaymentsRequestAuthed(paymentId, 'POST', '/approve', undefined, PI_APPROVE_TIMEOUT_MS, sandboxHint)
    } catch (error) {
      lastError = error
      const status = (error as { piHttpStatus?: number } | null)?.piHttpStatus
      if (typeof status === 'number' && status < 500) break
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

export async function completePiPayment(paymentId: string, txid: string, sandboxHint?: boolean | null) {
  const infoPromise = getPiPayment(paymentId, sandboxHint).catch(() => null)
  const payment = await piPaymentsRequestAuthed(
    paymentId,
    'POST',
    '/complete',
    { txid },
    PI_FETCH_TIMEOUT_MS,
    sandboxHint,
  )
  // info는 결제 kind의 권위 있는 출처 — 1차 GET이 실패하면 한 번 더 조회해
  // 클라이언트 주장 kind에 의존해야 하는 경우를 줄인다.
  const info = (await infoPromise) ?? (await getPiPayment(paymentId, sandboxHint).catch(() => null))
  return { payment, info }
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
export type PiTokenInspection = {
  uid: string | null
  /** 'ok' — 토큰 유효 · 'invalid' — 401/403으로 명시적 거절(만료/위조)
   *  'unreachable' — /v2/me 장애·타임아웃·파싱 실패로 판정 불가 */
  status: 'ok' | 'invalid' | 'unreachable'
}

export async function inspectPiAccessToken(accessToken: string): Promise<PiTokenInspection> {
  const token = accessToken.trim()
  if (!token) return { uid: null, status: 'invalid' }
  try {
    const res = await fetch('https://api.minepi.com/v2/me', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) {
      console.warn('[Pi] access token rejected', { status: res.status })
      return { uid: null, status: res.status === 401 || res.status === 403 ? 'invalid' : 'unreachable' }
    }
    const data = (await res.json().catch(() => null)) as { uid?: unknown } | null
    const uid = typeof data?.uid === 'string' && data.uid.trim() ? data.uid.trim() : null
    return uid ? { uid, status: 'ok' } : { uid: null, status: 'unreachable' }
  } catch (error) {
    console.error('[Pi] access token verification failed', error)
    return { uid: null, status: 'unreachable' }
  }
}

export async function verifyPiAccessToken(accessToken: string): Promise<string | null> {
  const result = await inspectPiAccessToken(accessToken)
  // 장애·타임아웃도 null(fail-closed) — 인증 확인이 불가한 호출을 통과시키지 않는다.
  return result.status === 'ok' ? result.uid : null
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

async function a2uPost(input: { amount: number; memo: string; uid: string; metadata?: Record<string, unknown> }, apiKey: string) {
  const url = 'https://api.minepi.com/v2/payments'
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
  let lastError: unknown
  for (const { key, source } of keys) {
    try {
      console.log('[Pi] POST A2U start', { apiKey: source })
      return await a2uPost(input, key)
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
