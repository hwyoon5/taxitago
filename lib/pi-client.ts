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
