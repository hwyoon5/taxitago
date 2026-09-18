'use client'

import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

type IncompletePiPayment = {
  identifier?: string
  transaction?: { txid?: string | null } | null
}

type PiSdk = {
  init: (config: { version: string; sandbox?: boolean }) => void
  authenticate: (
    scopes: string[],
    onIncompletePaymentFound: (payment: IncompletePiPayment) => void | Promise<void>,
  ) => Promise<unknown>
  createPayment: (
    payment: { amount: number; memo: string; metadata: Record<string, unknown> },
    callbacks: {
      onReadyForServerApproval: (paymentId: string) => void | Promise<void>
      onReadyForServerCompletion: (paymentId: string, txid: string) => void | Promise<void>
      onCancel: (paymentId: string) => void
      onError: (error: Error, payment?: unknown) => void
    },
  ) => void
}

declare global {
  interface Window {
    Pi?: PiSdk
  }
}

export type PiCheckoutResult = { paymentId: string; txid: string }

let initialized = false
let authPromise: Promise<unknown> | null = null

function waitForPi(timeoutMs = 8000) {
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

async function postPiApi(path: '/api/pi/approve' | '/api/pi/complete', body: Record<string, string>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('[Pi]', path, 'failed', response.status, detail)
    throw new Error(`${path} failed (${response.status})`)
  }
  console.log('[Pi]', path, 'ok', response.status)
}

export async function preparePiSdk() {
  const pi = await waitForPi()
  if (!initialized) {
    try {
      pi.init({ version: '2.0', sandbox: false })
    } catch {
      /* already initialized */
    }
    initialized = true
  }
  if (!authPromise) {
    authPromise = pi
      .authenticate(['username', 'payments'], async (payment) => {
        const paymentId = typeof payment.identifier === 'string' ? payment.identifier : ''
        const txid = typeof payment.transaction?.txid === 'string' ? payment.transaction.txid : ''
        if (paymentId && txid) await postPiApi('/api/pi/complete', { paymentId, txid })
      })
      .catch((error) => {
        authPromise = null
        throw error
      })
  }
  await authPromise
  return pi
}

/** Opens the official Pi payment popup and talks to our approve/complete APIs. */
export function startPiCheckout(options: {
  amount: number
  memo: string
  metadata?: Record<string, unknown>
}) {
  const amount = Math.round(options.amount * 1_000_000) / 1_000_000
  if (!(amount > 0)) return Promise.reject(new Error('invalid amount'))

  return preparePiSdk().then(
    (pi) =>
      new Promise<PiCheckoutResult>((resolve, reject) => {
        pi.createPayment(
          {
            amount,
            memo: options.memo.slice(0, 25),
            metadata: options.metadata ?? {},
          },
          {
            onReadyForServerApproval: async (paymentId) => {
              console.log('[Pi] onReadyForServerApproval', paymentId)
              await postPiApi('/api/pi/approve', { paymentId })
            },
            onReadyForServerCompletion: async (paymentId, txid) => {
              console.log('[Pi] onReadyForServerCompletion', paymentId, txid)
              try {
                await postPiApi('/api/pi/complete', { paymentId, txid })
                resolve({ paymentId, txid })
              } catch (error) {
                reject(error instanceof Error ? error : new Error('complete failed'))
                throw error
              }
            },
            onCancel: (paymentId) => {
              console.log('[Pi] onCancel', paymentId)
              reject(new Error('cancelled'))
            },
            onError: (error, payment) => {
              console.error('[Pi] onError', error, payment)
              reject(error)
            },
          },
        )
      }),
  )
}

export function PiCheckoutButton({
  amount,
  memo,
  metadata,
  children,
  onPaid,
  onFailed,
  className,
  disabled,
  ...buttonProps
}: {
  amount: number
  memo: string
  metadata?: Record<string, unknown>
  children: ReactNode
  onPaid?: (result: PiCheckoutResult) => void
  onFailed?: (error: Error) => void
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'>) {
  const [busy, setBusy] = useState(false)

  const handleClick = async () => {
    if (busy || disabled) return
    setBusy(true)
    try {
      const result = await startPiCheckout({ amount, memo, metadata })
      onPaid?.(result)
    } catch (error) {
      onFailed?.(error instanceof Error ? error : new Error('payment failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" {...buttonProps} disabled={busy || disabled} onClick={() => void handleClick()} className={className}>
      {busy ? 'Pi 결제 진행 중…' : children}
    </button>
  )
}
