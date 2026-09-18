type IncompletePiPayment = {
  identifier?: string
  transaction?: { txid?: string | null } | null
}

type PiPaymentCallbacks = {
  onReadyForServerApproval: (paymentId: string) => void | Promise<void>
  onReadyForServerCompletion: (paymentId: string, txid: string) => void | Promise<void>
  onCancel: (paymentId: string) => void
  onError: (error: Error, payment?: unknown) => void
}

type PiSdk = {
  init: (config: { version: string; sandbox?: boolean }) => void
  authenticate: (
    scopes: string[],
    onIncompletePaymentFound: (payment: IncompletePiPayment) => void | Promise<void>,
  ) => Promise<unknown>
  createPayment: (
    payment: { amount: number; memo: string; metadata: Record<string, unknown> },
    callbacks: PiPaymentCallbacks,
  ) => void
}

declare global {
  interface Window {
    Pi?: PiSdk
  }
}

let piInitialized = false
let piAuthPromise: Promise<unknown> | null = null

function waitForPiSdk(timeoutMs = 8000) {
  return new Promise<PiSdk>((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (typeof window !== 'undefined' && window.Pi?.createPayment && window.Pi.init) {
        resolve(window.Pi)
        return
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error('Pi SDK not available. Open this app in Pi Browser.'))
        return
      }
      window.setTimeout(tick, 120)
    }
    tick()
  })
}

async function completeIncompletePayment(payment: IncompletePiPayment) {
  const paymentId = typeof payment.identifier === 'string' ? payment.identifier : ''
  const txid = typeof payment.transaction?.txid === 'string' ? payment.transaction.txid : ''
  if (!paymentId || !txid) return
  const response = await fetch('/api/pi/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentId, txid }),
  })
  if (!response.ok) {
    throw new Error(`/api/pi/complete failed (${response.status})`)
  }
}

export async function initPiMainnet() {
  const pi = await waitForPiSdk()
  if (!piInitialized) {
    try {
      pi.init({ version: '2.0', sandbox: false })
    } catch {
      /* already initialized */
    }
    piInitialized = true
  }
  if (!piAuthPromise) {
    piAuthPromise = pi.authenticate(['username', 'payments'], (payment) => completeIncompletePayment(payment)).catch((error) => {
      piAuthPromise = null
      throw error
    })
  }
  await piAuthPromise
  return pi
}

export async function createMainnetPiPayment(options: {
  amount: number
  memo: string
  metadata?: Record<string, unknown>
}) {
  const amount = Math.round(options.amount * 1_000_000) / 1_000_000
  if (!(amount > 0)) {
    throw new Error('invalid amount')
  }

  const pi = await initPiMainnet()

  return new Promise<{ simulated: false; paymentId: string; txid: string }>((resolve, reject) => {
    pi.createPayment(
      {
        amount,
        memo: options.memo.slice(0, 25),
        metadata: options.metadata ?? {},
      },
      {
        onReadyForServerApproval: async (paymentId) => {
          console.log('[Pi] onReadyForServerApproval', paymentId)
          const response = await fetch('/api/pi/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentId }),
          })
          if (!response.ok) {
            const detail = await response.text().catch(() => '')
            console.error('[Pi] /api/pi/approve failed', response.status, detail)
            throw new Error(`/api/pi/approve failed (${response.status})`)
          }
          console.log('[Pi] /api/pi/approve ok', response.status)
        },
        onReadyForServerCompletion: async (paymentId, txid) => {
          console.log('[Pi] onReadyForServerCompletion', paymentId, txid)
          try {
            const response = await fetch('/api/pi/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ paymentId, txid }),
            })
            if (!response.ok) {
              const detail = await response.text().catch(() => '')
              console.error('[Pi] /api/pi/complete failed', response.status, detail)
              throw new Error(`/api/pi/complete failed (${response.status})`)
            }
            console.log('[Pi] /api/pi/complete ok', response.status)
            resolve({ simulated: false, paymentId, txid })
          } catch (error) {
            reject(error instanceof Error ? error : new Error('complete failed'))
            throw error
          }
        },
        onCancel: () => reject(new Error('cancelled')),
        onError: (error) => reject(error),
      },
    )
  })
}
