const PI_API_BASE = 'https://api.minepi.com/v2/payments'

function piApiKey() {
  const key = (process.env.PI_API_KEY || '').trim()
  if (!key) {
    throw new Error('PI_API_KEY is not configured')
  }
  return key
}

async function piPaymentsRequest(paymentId: string, method: 'GET' | 'POST', pathSuffix = '', body?: Record<string, string>) {
  const response = await fetch(`${PI_API_BASE}/${encodeURIComponent(paymentId)}${pathSuffix}`, {
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
    throw new Error(message)
  }
  return payload
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
