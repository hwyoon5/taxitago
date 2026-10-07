import { isPiSandboxEnv } from '@/lib/pi-sandbox'

const PI_API_BASE = 'https://api.minepi.com/v2/payments'

/**
 * Pi 개발자 포털 도메인 인증 충돌 우회용 임시 테스트넷 키.
 * 샌드박스/테스트넷 모드에서는 PI_API_KEY 설정과 무관하게 이 키를 강제로 사용한다.
 * 메인넷(NEXT_PUBLIC_PI_SANDBOX=false/0/mainnet)에서는 절대 사용되지 않는다.
 * TODO: 포털 도메인 인증이 정리되면 제거하고 PI_API_KEY로 되돌린다.
 */
const PI_TESTNET_API_KEY = 'Uyu7admbaeoeucn1yfqsg57l71oa2ah5ldyoe5urrpyjzr9mse2pdmof3o1ee1nd'

function piApiKey() {
  if (isPiSandboxEnv()) return PI_TESTNET_API_KEY
  const key = (process.env.PI_API_KEY || '').trim()
  if (!key) {
    throw new Error('PI_API_KEY is not configured')
  }
  return key
}

/** 로그용 — 어떤 키 출처를 썼는지 남긴다(키 값 자체는 절대 기록하지 않음). */
function piApiKeySource() {
  return isPiSandboxEnv() ? 'forced-testnet' : 'env'
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
  pathSuffix = '',
  body?: Record<string, string>,
  timeoutMs = PI_FETCH_TIMEOUT_MS,
) {
  const url = piPaymentUrl(paymentId, pathSuffix)
  const apiKey = piApiKey()
  const startedAt = Date.now()
  console.log(`[Pi] ${method} ${url} start`, { apiKey: piApiKeySource(), timeoutMs })

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

export async function getPiPayment(paymentId: string) {
  return (await piPaymentsRequest(paymentId, 'GET')) as {
    amount?: number
    metadata?: Record<string, unknown>
    [key: string]: unknown
  } | null
}

/**
 * Approve must answer inside the wallet expiry window. Retry once on network
 * stalls and 5xx; 4xx (already approved/cancelled/expired) is final.
 */
export async function approvePiPayment(paymentId: string) {
  let lastError: unknown
  for (let attempt = 0; attempt < PI_APPROVE_ATTEMPTS; attempt += 1) {
    const attemptStart = Date.now()
    try {
      return await piPaymentsRequest(paymentId, 'POST', '/approve', undefined, PI_APPROVE_TIMEOUT_MS)
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

export async function completePiPayment(paymentId: string, txid: string) {
  const infoPromise = getPiPayment(paymentId).catch(() => null)
  const payment = await piPaymentsRequest(paymentId, 'POST', '/complete', { txid })
  // info는 결제 kind의 권위 있는 출처 — 1차 GET이 실패하면 한 번 더 조회해
  // 클라이언트 주장 kind에 의존해야 하는 경우를 줄인다.
  const info = (await infoPromise) ?? (await getPiPayment(paymentId).catch(() => null))
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

function piHorizonUrl() {
  const override = (process.env.PI_HORIZON_URL || '').trim()
  if (override) return override
  return isPiSandboxEnv() ? 'https://api.testnet.minepi.com' : 'https://api.mainnet.minepi.com'
}

/**
 * Cross-check the txid on Horizon. Definitive negatives (404 / failed tx) throw;
 * transient Horizon problems only warn — Pi API's own verification stands.
 */
export async function verifyPiTxidOnChain(txid: string) {
  const url = `${piHorizonUrl()}/transactions/${encodeURIComponent(txid)}`
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

export async function createA2UPayment(input: {
  amount: number
  memo: string
  uid: string
  metadata?: Record<string, unknown>
}) {
  const url = 'https://api.minepi.com/v2/payments'
  const apiKey = piApiKey()
  const startedAt = Date.now()
  console.log(`[Pi] POST ${url} A2U start`, { apiKey: piApiKeySource() })
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
    throw new Error(message)
  }
  return payload as { identifier?: string; transaction?: { txid?: string } }
}
