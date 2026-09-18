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
  ) => unknown
}

declare global {
  interface Window {
    Pi?: PiSdk
  }
}

export type PiCheckoutResult = { paymentId: string; txid: string }

const PI_SANDBOX = process.env.NEXT_PUBLIC_PI_SANDBOX !== 'false'

let initialized = false
let authPromise: Promise<unknown> | null = null

function reportPiError(message: string, error?: unknown) {
  console.error('[Pi]', message, error ?? '')
}

function waitForPi(timeoutMs = 12000) {
  return new Promise<PiSdk>((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (typeof window !== 'undefined' && window.Pi?.init && window.Pi.createPayment) {
        resolve(window.Pi)
        return
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error('Pi SDK(window.Pi)가 로드되지 않았습니다. Pi Browser에서 열어 주세요.'))
        return
      }
      window.setTimeout(tick, 80)
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
    reportPiError(`${path} failed ${response.status}`, detail)
    throw new Error(`${path} failed (${response.status})`)
  }
  console.log('[Pi]', path, 'ok', response.status)
}

export async function preparePiSdk() {
  const pi = await waitForPi()
  if (!initialized) {
    pi.init({ version: '2.0', sandbox: PI_SANDBOX })
    initialized = true
    console.log('[Pi] init', { version: '2.0', sandbox: PI_SANDBOX })
  }
  if (!authPromise) {
    authPromise = pi
      .authenticate(['payments', 'username'], async (payment) => {
        const paymentId = typeof payment.identifier === 'string' ? payment.identifier : ''
        const txid = typeof payment.transaction?.txid === 'string' ? payment.transaction.txid : ''
        if (paymentId && txid) await postPiApi('/api/pi/complete', { paymentId, txid })
      })
      .then((auth) => {
        console.log('[Pi] authenticate ok')
        return auth
      })
      .catch((error) => {
        authPromise = null
        reportPiError('authenticate failed', error)
        throw error
      })
  }
  await authPromise
  return pi
}

export function startPiCheckout(options: {
  amount: number
  memo: string
  metadata?: Record<string, unknown>
}) {
  const amount = Math.round(options.amount * 1_000_000) / 1_000_000
  if (!(amount > 0)) throw new Error('결제 금액이 올바르지 않습니다.')

  const pi = typeof window !== 'undefined' ? window.Pi : undefined
  if (!pi?.createPayment || !pi.init) {
    throw new Error('Pi SDK(window.Pi)가 없습니다. Pi Browser에서 열어 주세요.')
  }

  pi.init({ version: '2.0', sandbox: PI_SANDBOX })
  initialized = true

  const payment = {
    amount,
    memo: options.memo.slice(0, 25),
    metadata: options.metadata ?? {},
  }
  console.log('[Pi] window.Pi.createPayment', payment)

  return new Promise<PiCheckoutResult>((resolve, reject) => {
    const finishError = (error: unknown) => {
      reportPiError('createPayment failed', error)
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    try {
      window.Pi!.createPayment(payment, {
        onReadyForServerApproval: (paymentId) => {
          console.log('[Pi] onReadyForServerApproval', paymentId)
          return postPiApi('/api/pi/approve', { paymentId })
        },
        onReadyForServerCompletion: (paymentId, txid) => {
          console.log('[Pi] onReadyForServerCompletion', paymentId, txid)
          return postPiApi('/api/pi/complete', { paymentId, txid }).then(() => {
            resolve({ paymentId, txid })
          })
        },
        onCancel: (paymentId) => {
          console.warn('[Pi] onCancel', paymentId)
          reject(new Error('결제가 취소되었습니다.'))
        },
        onError: (error, paymentInfo) => {
          reportPiError('onError', { error, paymentInfo })
          finishError(error)
        },
      })
    } catch (error) {
      finishError(error)
    }
  })
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

  const handleClick = () => {
    if (busy || disabled) return

    const pi = typeof window !== 'undefined' ? window.Pi : undefined
    if (!pi?.createPayment || !pi.init) {
      const next = new Error('Pi SDK(window.Pi)가 없습니다. Pi Browser에서 열어 주세요.')
      reportPiError('checkout failed', next)
      onFailed?.(next)
      if (!onFailed) window.alert(next.message)
      return
    }

    const amountValue = Math.round(amount * 1_000_000) / 1_000_000
    const payment = {
      amount: amountValue,
      memo: memo.slice(0, 25),
      metadata: metadata ?? {},
    }

    setBusy(true)
    try {
      pi.init({ version: '2.0', sandbox: PI_SANDBOX })
      initialized = true
      console.log('[Pi] window.Pi.createPayment', payment)
      window.Pi!.createPayment(payment, {
        onReadyForServerApproval: (paymentId) => {
          console.log('[Pi] onReadyForServerApproval', paymentId)
          return postPiApi('/api/pi/approve', { paymentId })
        },
        onReadyForServerCompletion: (paymentId, txid) => {
          console.log('[Pi] onReadyForServerCompletion', paymentId, txid)
          return postPiApi('/api/pi/complete', { paymentId, txid })
            .then(() => {
              setBusy(false)
              onPaid?.({ paymentId, txid })
            })
            .catch((error) => {
              setBusy(false)
              const next = error instanceof Error ? error : new Error('complete failed')
              reportPiError('checkout failed', next)
              onFailed?.(next)
              if (!onFailed) window.alert(next.message)
            })
        },
        onCancel: (paymentId) => {
          console.warn('[Pi] onCancel', paymentId)
          setBusy(false)
          onFailed?.(new Error('결제가 취소되었습니다.'))
        },
        onError: (error, paymentInfo) => {
          setBusy(false)
          const next = error instanceof Error ? error : new Error(String(error))
          reportPiError('onError', { error, paymentInfo })
          onFailed?.(next)
          if (!onFailed) window.alert(next.message)
        },
      })
    } catch (error) {
      setBusy(false)
      const next = error instanceof Error ? error : new Error('createPayment failed')
      reportPiError('checkout failed', next)
      onFailed?.(next)
      if (!onFailed) window.alert(next.message)
    }
  }

  return (
    <button type="button" {...buttonProps} disabled={busy || disabled} onClick={handleClick} className={className}>
      {busy ? 'Pi 결제 진행 중…' : children}
    </button>
  )
}
