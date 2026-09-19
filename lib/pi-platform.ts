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

async function piPaymentsRequest(paymentId: string, method: 'GET' | 'POST', pathSuffix = '', body?: Record<string, string>) {
  const url = piPaymentUrl(paymentId, pathSuffix)
  const hasApiKey = Boolean((process.env.PI_API_KEY || '').trim())
  console.log(`[Pi] ${method} ${url} (PI_API_KEY ${hasApiKey ? 'set' : 'missing'})`)

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Key ${piApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      cache: 'no-store',
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const message =
        (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
          ? payload.message
          : `Pi API ${response.status}`)
      console.error(`[Pi] ${method} ${url} failed status=${response.status}`, message)
      throw new Error(message)
    }

    console.log(`[Pi] ${method} ${url} success status=${response.status}`)
    return payload
  } catch (error) {
    console.error(`[Pi] ${method} ${url} error`, error)
    throw error
  }
}

export function getPiPayment(paymentId: string) {
  return piPaymentsRequest(paymentId, 'GET')
}

export async function approvePiPayment(paymentId: string) {
  await getPiPayment(paymentId)
  return piPaymentsRequest(paymentId, 'POST', '/approve')
}

export async function completePiPayment(paymentId: string, txid: string) {
  await getPiPayment(paymentId)
  return piPaymentsRequest(paymentId, 'POST', '/complete', { txid })
}

export async function createA2UPayment(input: {
  amount: number
  memo: string
  uid: string
  metadata?: Record<string, unknown>
}) {
  const url = 'https://api.minepi.com/v2/payments'
  const hasApiKey = Boolean((process.env.PI_API_KEY || '').trim())
  console.log(`[Pi] POST ${url} A2U (PI_API_KEY ${hasApiKey ? 'set' : 'missing'})`)
  const response = await fetch(url, {
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
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string'
        ? payload.message
        : `Pi A2U ${response.status}`
    throw new Error(message)
  }
  return payload as { identifier?: string; transaction?: { txid?: string } }
}
