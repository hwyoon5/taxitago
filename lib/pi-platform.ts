import { isPiSandboxEnv } from '@/lib/pi-sandbox'

const PI_API_BASE = 'https://api.minepi.com/v2/payments'

function piApiKey() {
  const key = (process.env.PI_API_KEY || '').trim()
  if (!key) {
    throw new Error('PI_API_KEY is not configured')
  }
  return key
}

function piPaymentUrl(paymentId: string, pathSuffix = '') {
  return `${PI_API_BASE}/${encodeURIComponent(paymentId)}${pathSuffix}`
}

/** Generous budget — Pi API can be slow from serverless cold starts; the client retries anyway. */
const PI_FETCH_TIMEOUT_MS = 60_000

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

async function piPaymentsRequest(paymentId: string, method: 'GET' | 'POST', pathSuffix = '', body?: Record<string, string>) {
  const url = piPaymentUrl(paymentId, pathSuffix)
  const hasApiKey = Boolean((process.env.PI_API_KEY || '').trim())
  const startedAt = Date.now()
  console.log(`[Pi] ${method} ${url} start`, { apiKey: hasApiKey ? 'set' : 'missing' })

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Key ${piApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(PI_FETCH_TIMEOUT_MS),
    })
  } catch (error) {
    console.error(`[Pi] ${method} ${url} network error`, {
      ms: Date.now() - startedAt,
      timeoutMs: PI_FETCH_TIMEOUT_MS,
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
    console.error(`[Pi] ${method} ${url} failed`, {
      status: response.status,
      ms: elapsed,
      body: raw.slice(0, 500),
      message,
    })
    throw new Error(message)
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

export async function approvePiPayment(paymentId: string) {
  return piPaymentsRequest(paymentId, 'POST', '/approve')
}

export async function completePiPayment(paymentId: string, txid: string) {
  const infoPromise = getPiPayment(paymentId).catch(() => null)
  const payment = await piPaymentsRequest(paymentId, 'POST', '/complete', { txid })
  const info = await infoPromise
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
  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    console.warn('[Pi] horizon txid lookup unreachable; relying on Pi API verification', { txid, ...describeError(error) })
    return
  }
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
  const hasApiKey = Boolean((process.env.PI_API_KEY || '').trim())
  const startedAt = Date.now()
  console.log(`[Pi] POST ${url} A2U start`, { apiKey: hasApiKey ? 'set' : 'missing' })
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Key ${piApiKey()}`,
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
