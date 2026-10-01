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
