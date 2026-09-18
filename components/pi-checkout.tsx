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
      onReadyForServerApproval: (paymentId: string) => void | Promise<unknown>
      onReadyForServerCompletion: (paymentId: string, txid: string) => void | Promise<unknown>
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

const PI_SANDBOX_RAW = (process.env.NEXT_PUBLIC_PI_SANDBOX ?? 'true').trim().toLowerCase()
/** Developer portal testnet → true. Mainnet app → NEXT_PUBLIC_PI_SANDBOX=false */
export const PI_SANDBOX = PI_SANDBOX_RAW !== 'false' && PI_SANDBOX_RAW !== '0' && PI_SANDBOX_RAW !== 'mainnet'

let initialized = false
let authPromise: Promise<unknown> | null = null

function resetPiSession() {
  authPromise = null
  initialized = false
}

function isPiBrowser() {
  if (typeof navigator === 'undefined') return false
  return /PiBrowser|PiNetwork/i.test(navigator.userAgent)
}

function dumpUnknown(value: unknown) {
  if (value == null) return { value }
  if (typeof value !== 'object') return { type: typeof value, value: String(value) }

  const record = value as Record<string, unknown>
  const names = Object.getOwnPropertyNames(value)
  const picked: Record<string, unknown> = {}
  for (const key of names.slice(0, 40)) {
    try {
      const next = record[key]
      picked[key] = next instanceof Error ? { name: next.name, message: next.message, stack: next.stack } : next
    } catch (error) {
      picked[key] = `[unreadable: ${String(error)}]`
    }
  }

  let json: string | undefined
  try {
    json = JSON.stringify(value)
  } catch {
    json = undefined
  }

  return {
    type: value.constructor?.name ?? 'object',
    string: String(value),
    json,
    keys: names,
    enumerable: { ...record },
    picked,
    name: typeof record.name === 'string' ? record.name : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
    code: record.code,
    stack: typeof record.stack === 'string' ? record.stack : undefined,
  }
}

function logPi(level: 'log' | 'warn' | 'error', label: string, extra?: unknown) {
  const payload = {
    label,
    sandbox: PI_SANDBOX,
    envSandbox: process.env.NEXT_PUBLIC_PI_SANDBOX ?? '(unset → true)',
    isPiBrowser: isPiBrowser(),
    hasWindowPi: typeof window !== 'undefined' && Boolean(window.Pi),
    hasCreatePayment: typeof window !== 'undefined' && typeof window.Pi?.createPayment === 'function',
    href: typeof location !== 'undefined' ? location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    extra: dumpUnknown(extra),
  }
  console[level](`[Pi] ${label}`, payload)
  if (extra !== undefined) console[level](`[Pi] ${label} raw`, extra)
}

function errorText(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) || String(error)
  } catch {
    return String(error)
  }
}

function isSessionError(error: unknown) {
  const text = errorText(error)
  return /session|authenticat|not logged|sign.?in|unauthorized|unauthorised|token expired|no user|not signed/i.test(text)
}

export function describePiUserMessage(error: unknown) {
  const text = errorText(error)
  if (/window\.Pi|Pi SDK\(window\.Pi\)/i.test(text)) {
    return 'window.Pi 객체가 없습니다. Pi Browser에서 열어 주세요.'
  }
  if (!isPiBrowser() && /pi browser|not in pi/i.test(text)) {
    return 'Pi Browser 환경이 아닙니다. 파이 브라우저에서 다시 열어 주세요.'
  }
  if (/cancel/i.test(text)) return '결제가 취소되었습니다.'
  if (isSessionError(error)) {
    return 'Pi 로그인 세션이 끊겼습니다. 파이 브라우저에서 다시 로그인한 뒤 시도해 주세요.'
  }
  if (/sandbox|mainnet|testnet|network mismatch/i.test(text)) {
    return `Pi 네트워크 설정이 맞지 않습니다. 현재 sandbox=${PI_SANDBOX} (개발자 포털이 테스트넷이면 true, 메인넷이면 NEXT_PUBLIC_PI_SANDBOX=false).`
  }
  if (text && text !== '[object Object]') {
    return text.replace(/^Error:\s*/, '')
  }
  return 'Pi 결제를 완료하지 못했습니다. 개발자 도구 콘솔의 [Pi] 로그를 확인해 주세요.'
}

function waitForPi(timeoutMs = 12000) {
  return new Promise<PiSdk>((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (typeof window !== 'undefined' && typeof window.Pi?.init === 'function' && typeof window.Pi.createPayment === 'function') {
        resolve(window.Pi)
        return
      }
      if (Date.now() - started >= timeoutMs) {
        logPi('error', 'SDK load timeout')
        reject(new Error('Pi SDK(window.Pi)가 로드되지 않았습니다. Pi Browser에서 열어 주세요.'))
        return
      }
      window.setTimeout(tick, 80)
    }
    tick()
  })
}

async function postPiApi(path: '/api/pi/approve' | '/api/pi/complete', body: Record<string, string>) {
  logPi('log', `${path} request`, body)
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null
  if (!response.ok || payload?.ok !== true) {
    const message = typeof payload?.error === 'string' ? payload.error : `${path} failed (${response.status})`
    logPi('error', `${path} failed`, { status: response.status, payload, message })
    throw new Error(message)
  }
  logPi('log', `${path} ok`, { status: response.status, payload })
  return payload
}

function initPi(pi: PiSdk) {
  const config = { version: '2.0', sandbox: PI_SANDBOX }
  pi.init(config)
  initialized = true
  logPi('log', 'Pi.init', config)
}

export async function preparePiSdk() {
  const pi = await waitForPi()
  if (!isPiBrowser()) {
    logPi('warn', 'not Pi Browser; skip authenticate')
    initPi(pi)
    return pi
  }
  if (!initialized) initPi(pi)
  if (!authPromise) {
    authPromise = pi
      .authenticate(['payments', 'username'], async (payment) => {
        logPi('log', 'onIncompletePaymentFound', payment)
        const paymentId = typeof payment.identifier === 'string' ? payment.identifier : ''
        const txid = typeof payment.transaction?.txid === 'string' ? payment.transaction.txid : ''
        if (paymentId && txid) await postPiApi('/api/pi/complete', { paymentId, txid })
      })
      .then((auth) => {
        logPi('log', 'authenticate ok', auth)
        return auth
      })
      .catch((error) => {
        resetPiSession()
        logPi('error', 'authenticate failed', error)
        throw error
      })
  }
  try {
    await authPromise
  } catch (error) {
    logPi('warn', 'session not ready', error)
  }
  return pi
}

function requirePiSdk() {
  const pi = typeof window !== 'undefined' ? window.Pi : undefined
  if (!pi) {
    logPi('error', 'window.Pi missing')
    throw new Error('window.Pi 객체가 없습니다. Pi Browser에서 열어 주세요.')
  }
  if (typeof pi.createPayment !== 'function') {
    logPi('error', 'window.Pi.createPayment missing', pi)
    throw new Error('window.Pi.createPayment가 없습니다. SDK 로드를 확인해 주세요.')
  }
  if (!isPiBrowser()) {
    logPi('warn', 'userAgent is not Pi Browser; continuing because window.Pi exists')
  }
  return pi
}

function isCancelError(error: unknown) {
  return /cancel/i.test(errorText(error))
}

async function postSandboxCharge(amount: number, memo: string) {
  logPi('log', '/api/pi/charge request', { amount, memo })
  const response = await fetch('/api/pi/charge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, memo, metadata: { kind: 'wallet-charge' } }),
  })
  const payload = (await response.json().catch(() => null)) as {
    ok?: unknown
    error?: unknown
    paymentId?: unknown
    txid?: unknown
  } | null
  if (!response.ok || payload?.ok !== true) {
    const message = typeof payload?.error === 'string' ? payload.error : `/api/pi/charge failed (${response.status})`
    logPi('error', '/api/pi/charge failed', { status: response.status, payload })
    throw new Error(message)
  }
  const paymentId = typeof payload.paymentId === 'string' ? payload.paymentId : `sandbox-charge-${Date.now()}`
  const txid = typeof payload.txid === 'string' ? payload.txid : `demo-txid-${Date.now()}`
  logPi('log', '/api/pi/charge ok', { paymentId, txid, amount })
  return { paymentId, txid }
}

/** Wallet top-up: sandbox credits test balance; mainnet requires createPayment. */
export async function chargePiWallet(amount: number) {
  const value = Math.round(amount * 1_000_000) / 1_000_000
  if (!(value > 0)) throw new Error('충전 금액이 올바르지 않습니다.')
  const memo = `TaxiTago ${value} Pi 충전`.slice(0, 25)

  if (PI_SANDBOX) {
    const pi = typeof window !== 'undefined' ? window.Pi : undefined
    if (isPiBrowser() && typeof pi?.createPayment === 'function') {
      try {
        return await startPiCheckout({
          amount: value,
          memo,
          metadata: { kind: 'wallet-charge' },
        })
      } catch (error) {
        if (isCancelError(error)) throw error
        logPi('warn', 'sandbox createPayment failed; crediting test balance', error)
      }
    } else {
      logPi('warn', 'sandbox charge via /api/pi/charge')
    }
    return postSandboxCharge(value, memo)
  }

  return startPiCheckout({
    amount: value,
    memo,
    metadata: { kind: 'wallet-charge' },
  })
}

export function startPiCheckout(options: {
  amount: number
  memo: string
  metadata?: Record<string, unknown>
}) {
  const amount = Math.round(options.amount * 1_000_000) / 1_000_000
  if (!(amount > 0)) throw new Error('결제 금액이 올바르지 않습니다.')

  const pi = requirePiSdk()
  if (typeof pi.init === 'function') initPi(pi)

  const payment = {
    amount,
    memo: options.memo.slice(0, 25),
    metadata: options.metadata ?? {},
  }
  logPi('log', 'window.Pi.createPayment', payment)

  return new Promise<PiCheckoutResult>((resolve, reject) => {
    const finishError = (label: string, error: unknown, extra?: unknown) => {
      logPi('error', label, { error, extra })
      if (isSessionError(error)) resetPiSession()
      reject(error instanceof Error ? error : new Error(describePiUserMessage(error)))
    }

    try {
      pi.createPayment(payment, {
        onReadyForServerApproval: (paymentId) => {
          logPi('log', 'onReadyForServerApproval', { paymentId })
          return postPiApi('/api/pi/approve', { paymentId })
        },
        onReadyForServerCompletion: (paymentId, txid) => {
          logPi('log', 'onReadyForServerCompletion', { paymentId, txid })
          if (!paymentId || !txid) {
            finishError('completion missing ids', { paymentId, txid })
            return Promise.resolve()
          }
          return postPiApi('/api/pi/complete', { paymentId, txid }).then(() => {
            resolve({ paymentId, txid })
          })
        },
        onCancel: (paymentId) => {
          logPi('warn', 'onCancel', { paymentId })
          reject(new Error('결제가 취소되었습니다.'))
        },
        onError: (error, paymentInfo) => {
          logPi('error', 'onError', { error, paymentInfo })
          finishError('createPayment onError', error, paymentInfo)
        },
      })
    } catch (error) {
      finishError('createPayment threw', error)
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

  const fail = (error: unknown) => {
    const next = error instanceof Error ? error : new Error(describePiUserMessage(error))
    if (!(error instanceof Error)) next.cause = error
    logPi('error', 'checkout failed', next)
    onFailed?.(next)
    if (!onFailed) window.alert(describePiUserMessage(next))
  }

  const handleClick = () => {
    if (busy || disabled) return
    setBusy(true)
    try {
      void startPiCheckout({ amount, memo, metadata })
        .then((result) => onPaid?.(result))
        .catch(fail)
        .finally(() => setBusy(false))
    } catch (error) {
      setBusy(false)
      fail(error)
    }
  }

  return (
    <button type="button" {...buttonProps} disabled={busy || disabled} onClick={handleClick} className={className}>
      {busy ? 'Pi 결제 진행 중…' : children}
    </button>
  )
}
