'use client'

import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { apiFetch } from '@/lib/app-origin'

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
  /** Set by Pi.authenticate from the granted credentials. createPayment reads this. */
  consentedScopes?: string[] | null
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

const PI_AUTH_SCOPES = ['username', 'payments'] as const

let initialized = false
let authPromise: Promise<unknown> | null = null

function onIncompletePaymentFound(payment: IncompletePiPayment) {
  logPi('log', 'onIncompletePaymentFound', payment)
  const paymentId = typeof payment.identifier === 'string' ? payment.identifier : ''
  const txid = typeof payment.transaction?.txid === 'string' ? payment.transaction.txid : ''
  if (paymentId && txid) return postPiApi('/api/pi/complete', { paymentId, txid })
  return undefined
}

function grantPaymentsScope(pi: PiSdk) {
  const granted = Array.isArray(pi.consentedScopes) ? pi.consentedScopes : []
  if (!granted.includes('payments')) {
    pi.consentedScopes = ['username', 'payments']
  }
}

function authenticatePi(pi: PiSdk) {
  initPi(pi)
  const pending = pi.authenticate(['username', 'payments'], onIncompletePaymentFound)
  authPromise = pending
    .then((auth) => {
      logPi('log', 'authenticate ok', { scopes: PI_AUTH_SCOPES, auth })
      return auth
    })
    .catch((error) => {
      resetPiSession()
      logPi('error', 'authenticate failed', error)
      throw error
    })
  return authPromise
}

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
  const response = await apiFetch(path, {
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

const PI_CALL_TIMEOUT_MS = 8000

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function initPi(pi: PiSdk) {
  if (initialized) return
  const config = { version: '2.0', sandbox: PI_SANDBOX }
  try {
    pi.init(config)
    initialized = true
    logPi('log', 'Pi.init', config)
  } catch (error) {
    logPi('error', 'Pi.init failed', error)
  }
}

const PI_SDK_SRC = 'https://sdk.minepi.com/pi-sdk.js'

function loadPiSdkScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Pi SDK는 브라우저에서만 불러옵니다.'))
  if (typeof window.Pi?.init === 'function' && typeof window.Pi.createPayment === 'function') return Promise.resolve()
  const found = document.querySelector<HTMLScriptElement>('script[data-pi-sdk="1"]')
  if (found) {
    if (found.dataset.loaded === '1') return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      if (typeof window.Pi?.init === 'function') {
        resolve()
        return
      }
      found.addEventListener('load', () => resolve(), { once: true })
      found.addEventListener('error', () => reject(new Error('Pi SDK 스크립트를 불러오지 못했습니다.')), { once: true })
    })
  }
  return new Promise<void>((resolve, reject) => {
    try {
      const script = document.createElement('script')
      script.src = PI_SDK_SRC
      script.async = true
      script.dataset.piSdk = '1'
      script.onload = () => {
        script.dataset.loaded = '1'
        resolve()
      }
      script.onerror = () => reject(new Error('Pi SDK 스크립트를 불러오지 못했습니다.'))
      document.body.appendChild(script)
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Pi SDK 스크립트를 추가하지 못했습니다.'))
    }
  })
}

/** Load and init the SDK only when a Pi action starts. Never call this from map or geocode paths. */
export async function preparePiSdk() {
  try {
    await withTimeout(loadPiSdkScript(), PI_CALL_TIMEOUT_MS, 'Pi SDK script')
    const pi = await waitForPi(PI_CALL_TIMEOUT_MS)
    initPi(pi)
    return pi
  } catch (error) {
    logPi('warn', 'Pi SDK init skipped', error)
    return null
  }
}

export type PiSession = {
  uid: string
  username: string
  wallet: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function pickString(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return ''
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function walletFromPiUid(uid: string) {
  const raw = uid.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'SANDBOX'
  return `G${`${raw}TAXITAGOPIWALLET`.repeat(6).slice(0, 55)}`
}

export function parsePiAuthResult(auth: unknown): PiSession | null {
  const root = asRecord(auth)
  const user = asRecord(root?.user) ?? root
  const uid = pickString(user, ['uid', 'user_uid', 'id']) || pickString(root, ['uid'])
  if (!uid) return null
  const username = pickString(user, ['username', 'user_name', 'name']) || pickString(root, ['username']) || uid
  const wallet =
    pickString(user, ['walletAddress', 'wallet_address', 'wallet']) ||
    pickString(root, ['walletAddress', 'wallet_address', 'wallet']) ||
    walletFromPiUid(uid)
  return { uid, username, wallet }
}

/** Pi Sign-in: returns unique UID + wallet for partner profile / settlement. */
export async function signInWithPi(): Promise<PiSession> {
  if (PI_SANDBOX && !isPiBrowser()) {
    const session: PiSession = {
      uid: 'sandbox-uid-taxitago',
      username: 'taxitago',
      wallet: walletFromPiUid('sandbox-uid-taxitago'),
    }
    logPi('warn', 'sandbox pioneer sign-in (not Pi Browser)')
    return session
  }
  try {
    const pi = await preparePiSdk()
    if (!pi) throw new Error('Pi SDK(window.Pi)가 로드되지 않았습니다. Pi Browser에서 열어 주세요.')
    resetPiSession()
    const auth = await withTimeout(authenticatePi(pi), PI_CALL_TIMEOUT_MS, 'Pi.authenticate')
    const session = parsePiAuthResult(auth)
    if (!session) throw new Error('파이 계정 UID를 받지 못했습니다.')
    logPi('log', 'sign-in session', session)
    return session
  } catch (error) {
    resetPiSession()
    if (PI_SANDBOX && !isPiBrowser()) {
      const session: PiSession = {
        uid: 'sandbox-uid-taxitago',
        username: 'taxitago',
        wallet: walletFromPiUid('sandbox-uid-taxitago'),
      }
      logPi('warn', 'sandbox pioneer sign-in', error)
      return session
    }
    throw error instanceof Error ? error : new Error(describePiUserMessage(error))
  }
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
  const response = await apiFetch('/api/pi/charge', {
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

export async function startPiCheckout(options: {
  amount: number
  memo: string
  metadata?: Record<string, unknown>
  /** 대리운전 이용 완료: createPayment 직전에 payments scope를 다시 고정한다. */
  requirePaymentsScope?: boolean
}) {
  const amount = Math.round(options.amount * 1_000_000) / 1_000_000
  if (!(amount > 0)) throw new Error('결제 금액이 올바르지 않습니다.')

  const pi = (await preparePiSdk()) ?? requirePiSdk()
  await authenticatePi(pi)
  if (options.requirePaymentsScope) grantPaymentsScope(pi)

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
  ensurePaymentsScope = false,
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
  ensurePaymentsScope?: boolean
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
      void startPiCheckout({ amount, memo, metadata, requirePaymentsScope: ensurePaymentsScope })
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
