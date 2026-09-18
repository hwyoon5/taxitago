type PiPaymentCallbacks = {
  onReadyForServerApproval: (paymentId: string) => void | Promise<void>
  onReadyForServerCompletion: (paymentId: string, txid: string) => void | Promise<void>
  onCancel: (paymentId: string) => void
  onError: (error: Error, payment?: unknown) => void
}

type PiSdk = {
  init: (config: { version: string; sandbox?: boolean }) => void
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

export function initPiMainnet() {
  if (piInitialized || typeof window === 'undefined' || !window.Pi?.init) return
  try {
    window.Pi.init({ version: '2.0', sandbox: false })
    piInitialized = true
  } catch {
    piInitialized = true
  }
}

async function postPaymentStage(path: '/api/payments/approve' | '/api/payments/complete', body: Record<string, string>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status})`)
  }
}

export function createMainnetPiPayment(options: {
  amount: number
  memo: string
  metadata?: Record<string, unknown>
}) {
  initPiMainnet()
  const pi = typeof window !== 'undefined' ? window.Pi : undefined
  if (!pi?.createPayment) {
    return Promise.resolve({ simulated: true as const })
  }

  return new Promise<{ simulated: false; paymentId: string; txid: string }>((resolve, reject) => {
    pi.createPayment(
      {
        amount: options.amount,
        memo: options.memo,
        metadata: options.metadata ?? {},
      },
      {
        onReadyForServerApproval: (paymentId) => postPaymentStage('/api/payments/approve', { paymentId }),
        onReadyForServerCompletion: (paymentId, txid) =>
          postPaymentStage('/api/payments/complete', { paymentId, txid })
            .then(() => resolve({ simulated: false, paymentId, txid }))
            .catch(reject),
        onCancel: () => reject(new Error('cancelled')),
        onError: (error) => reject(error),
      },
    )
  })
}
