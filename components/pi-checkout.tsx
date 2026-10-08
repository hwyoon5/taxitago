'use client'

import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { apiFetch } from '@/lib/app-origin'

type IncompletePiPayment = {
  identifier?: string
  transaction?: { txid?: string | null } | null
  metadata?: Record<string, unknown> | null
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

const PI_AUTH_SCOPES = ['username', 'payments'] as const

let initialized = false
let authPromise: Promise<unknown> | null = null

type PendingIncompletePayment = { paymentId: string; txid: string; label: string }

let pendingIncomplete: PendingIncompletePayment | null = null

function checkoutLabel(metadata?: Record<string, unknown>) {
  return typeof metadata?.label === 'string' ? metadata.label.trim() : ''
}

function isMobilityReturnLabel(label: string) {
  return label === '자전거 이용' || label === '퀵보드 이용'
}

async function onIncompletePaymentFound(payment: IncompletePiPayment): Promise<void> {
  logPi('log', 'onIncompletePaymentFound', payment)
  const paymentId = readPaymentId(payment)
  const txid = txidFromPiPayload(payment)
  const label = checkoutLabel(payment.metadata ?? undefined)
  if (paymentId && isMobilityReturnLabel(label)) {
    pendingIncomplete = { paymentId, txid, label }
  }
  if (!paymentId || !txid) return
  try {
    await postPiApiRetry('/api/pi/complete', { paymentId, txid, sandbox: PI_SANDBOX })
  } catch (error) {
    logPi('warn', 'incomplete payment complete failed', error)
  }
}

function authenticatePi(pi: PiSdk) {
  initPi(pi)
  if (!authPromise) {
    // Fire-and-forget: if the SDK awaits this callback before resolving
    // authenticate, a leftover incomplete payment would stall every checkout
    // behind a /api/pi/complete round-trip.
    const pending = pi.authenticate([...PI_AUTH_SCOPES], (payment) => {
      void onIncompletePaymentFound(payment)
    })
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
  }
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
  if (/timed out|TimeoutError|AbortError/i.test(text)) {
    return 'Pi 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'
  }
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

/**
 * Pi Browser가 지갑 시트를 띄우는 동안 페이지 fetch가 스로틀/서스펜드될 수
 * 있다 — 서버가 승인 요청을 "아예 못 받는" 상황을 막기 위해 sendBeacon으로
 * 같은 payload를 OS 큐에 한 번 더 실어둔다(서버 승인은 멱등이라 중복 안전).
 */
function beaconPiApi(path: '/api/pi/approve' | '/api/pi/complete', body: Record<string, unknown>) {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return
    const queued = navigator.sendBeacon(`${path}/`, new Blob([JSON.stringify(body)], { type: 'application/json' }))
    logPi('log', `${path} beacon`, { queued })
  } catch (error) {
    logPi('warn', `${path} beacon failed`, error)
  }
}

async function postPiApi(path: '/api/pi/approve' | '/api/pi/complete', body: Record<string, unknown>) {
  logPi('log', `${path} request`, body)
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // keepalive: 지갑 모달로 페이지가 백그라운드돼도 요청이 끝까지 전달된다.
    keepalive: true,
    // 서버 승인 예산(시도당 8s × 최대 2회 + 왕복)에 맞춘 상한 — 네트워크가
    // 멈춰도 결제 스피너가 무한 대기하지 않게 한다.
    signal: AbortSignal.timeout(PI_APPROVE_SERVER_TIMEOUT_MS),
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
/** 로그인 시트는 사용자 상호작용이 필요 — 8초 제한은 테스트넷에서 세션
 *  만료 오류로 오인될 만큼 짧아 별도 여유를 둔다. */
const PI_AUTH_TIMEOUT_MS = 30_000
/**
 * 승인은 지갑 만료 창 안에서 끝나야 하지만, 느린 네트워크/콜드 스타트에서의
 * 정상 승인까지 자르지 않도록 여유를 둔다(서버는 시도당 8초·최대 2회로 제한).
 */
const PI_APPROVE_SERVER_TIMEOUT_MS = 25_000

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

function piApiLabel(path: '/api/pi/approve' | '/api/pi/complete') {
  return path === '/api/pi/approve' ? 'Pi 결제 승인' : 'Pi 결제 완료'
}

/** Serverless cold starts and Pi API latency can push one call past the window — retry once. */
async function postPiApiRetry(path: '/api/pi/approve' | '/api/pi/complete', body: Record<string, unknown>, retries = 1) {
  const timeoutMs = path === '/api/pi/approve' ? PI_APPROVE_SERVER_TIMEOUT_MS : PI_SERVER_TIMEOUT_MS
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const started = Date.now()
    try {
      return await withTimeout(postPiApi(path, body), timeoutMs, piApiLabel(path))
    } catch (error) {
      lastError = error
      logPi('warn', `${path} attempt ${attempt + 1} failed`, error)
      // 승인 재시도는 첫 시도가 빨리 실패했을 때만 의미가 있다 —
      // 이미 만료 창이 지난 뒤의 재시도는 지갑을 구하지 못한다.
      const retryWorthIt = path !== '/api/pi/approve' || Date.now() - started < 8_000
      if (attempt < retries && retryWorthIt) await new Promise((resolve) => window.setTimeout(resolve, 1200))
      else break
    }
  }
  throw lastError
}

function initPi(pi: PiSdk) {
  if (initialized) return
  const config = { version: '2.0', sandbox: PI_SANDBOX }
  try {
    pi.init(config)
    initialized = true
    logPi('log', 'Pi.init', config)
  } catch (error) {
    // init 실패를 삼키면 초기화되지 않은 SDK로 authenticate가 실행돼
    // 시트가 뜨지 않고 무한 대기할 수 있다 — 즉시 실패로 올려보낸다.
    logPi('error', 'Pi.init failed', error)
    throw error instanceof Error ? error : new Error(`Pi.init failed: ${errorText(error)}`)
  }
}

const PI_SDK_SRC = 'https://sdk.minepi.com/pi-sdk.js'
/**
 * Pi App Studio "Verified" 단계용 로그인 엔드포인트 — authenticate로 받은
 * accessToken을 여기로 POST해야 App Studio가 앱을 검증 완료로 표시한다.
 */
const PI_APP_STUDIO_LOGIN_URL = 'https://backend.appstudio-u7cm9zhmha0ruwv8.piappengine.com/pi/auth/v1/login'

/**
 * authenticate 직후 accessToken을 App Studio 로그인 엔드포인트로 교환한다.
 * 실패해도 로그인 자체는 막지 않고 경고만 남긴다 — 서버 측 /api/pi/auth가
 * 동일 토큰을 한 번 더 포워딩하므로 CORS/일시 장애로 검증이 끊기지 않는다.
 */
async function loginPiAppStudio(accessToken: string) {
  try {
    const res = await fetch(PI_APP_STUDIO_LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    logPi(res.ok ? 'log' : 'warn', 'App Studio login', { status: res.status, data })
    return res.ok
  } catch (error) {
    logPi('warn', 'App Studio login failed (server forwards via /api/pi/auth)', error)
    return false
  }
}

let appStudioAutoAuthStarted = false
/**
 * Pi App Studio "Verified" 검증 전용 — Pi Browser에서 앱이 마운트되면
 * 사용자 클릭을 기다리지 않고 authenticate를 자동 실행하고, 발급된
 * accessToken을 App Studio 로그인 엔드포인트(직접 + 서버 포워딩)로 즉시
 * 전달한다. 일반 브라우저/비 Pi 환경에서는 아무것도 하지 않는다.
 */
export async function autoVerifyPiAppStudio() {
  if (appStudioAutoAuthStarted) return
  if (!isPiBrowser()) return
  appStudioAutoAuthStarted = true
  logPi('log', 'auto auth for App Studio verification start')
  try {
    const pi = await preparePiSdk()
    if (!pi) return
    const auth = await withTimeout(authenticatePi(pi), PI_AUTH_TIMEOUT_MS, 'Pi.authenticate (auto)')
    const session = parsePiAuthResult(auth)
    if (!session?.accessToken) {
      logPi('warn', 'auto auth: accessToken missing', session)
      return
    }
    void loginPiAppStudio(session.accessToken)
    void verifyPiSessionOnServer(session).catch((error) =>
      logPi('warn', 'auto auth server verify rejected', error),
    )
    logPi('log', 'auto auth done; token dispatched to App Studio')
  } catch (error) {
    logPi('warn', 'auto auth failed', error)
  }
}

function loadPiSdkScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Pi SDK는 브라우저에서만 불러옵니다.'))
  if (typeof window.Pi?.init === 'function' && typeof window.Pi.createPayment === 'function') return Promise.resolve()
  const found = document.querySelector<HTMLScriptElement>('script[data-pi-sdk="1"], script[src*="pi-sdk.js"]')
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
  /** Pi authenticate 결과의 이용자 토큰 — 서버가 /v2/me로 재검증하는 자격증명. */
  accessToken?: string
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
  const accessToken = pickString(root, ['accessToken', 'access_token']) || undefined
  return { uid, username, wallet, accessToken }
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
    // 인증 직전 resetPiSession()을 하면 마운트 시 자동 인증(autoVerifyPiAppStudio)이
    // 띄운 진행 중 authenticate와 충돌한다 — SDK는 in-flight authenticate 위에 두
    // 번째 호출을 얹지 못하고 두 프라미스 모두 영원히 pending 상태가 될 수 있다.
    // 대신 진행 중/완료된 인증 프라미스를 그대로 재사용하고, 세션 무결성은 직후
    // /v2/me 검증으로 확인한다.
    const auth = await withTimeout(authenticatePi(pi), PI_AUTH_TIMEOUT_MS, 'Pi.authenticate')
    const session = parsePiAuthResult(auth)
    if (!session) throw new Error('파이 계정 UID를 받지 못했습니다.')
    // App Studio 검증: 발급 토큰을 App Studio 로그인 엔드포인트로 즉시 교환
    // (실패 시 서버 /api/pi/auth 경유 포워딩이 이어서 시도한다).
    if (session.accessToken) void loginPiAppStudio(session.accessToken)
    // 발급된 accessToken을 서버 /v2/me로 재검증 — 만료·네트워크 불일치 세션이
    // "연동됨"으로 남았다가 호출 시점에야 깨지는 상황을 로그인 시점에 차단한다.
    await verifyPiSessionOnServer(session)
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

/**
 * 발급 토큰을 백엔드(/api/pi/auth → Pi /v2/me)로 재검증한다. 명시적 거절
 * (401)만 세션 오류로 throw하고, 검증 서버 장애·네트워크 실패는 경고 후
 * 통과 — 방금 authenticate로 받은 토큰이 권위라 일시 장애로 연동을 막지 않는다.
 */
async function verifyPiSessionOnServer(session: PiSession) {
  if (!session.accessToken) {
    logPi('warn', 'sign-in token missing; server verification skipped', { uid: session.uid })
    return
  }
  try {
    const res = await apiFetch('/api/pi/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: session.uid, accessToken: session.accessToken }),
      // apiFetch엔 기본 타임아웃이 없다 — 검증 서버가 멈추면 로그인 스피너가
      // 무한 대기하므로 상한을 둔다(서버 /v2/me 8s + 포워딩 여유).
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null
    if (res.status === 401) {
      resetPiSession()
      throw new Error(typeof data?.error === 'string' ? data.error : 'Pi 로그인 세션이 끊겼습니다. 다시 로그인해 주세요.')
    }
    if (!res.ok || data?.ok !== true) {
      logPi('warn', 'sign-in verification unreachable', { status: res.status, data })
      return
    }
    logPi('log', 'sign-in verified on server', { uid: session.uid })
  } catch (error) {
    if (error instanceof Error && /로그인 세션이 끊겼습니다/.test(error.message)) throw error
    logPi('warn', 'sign-in verification failed; continuing', error)
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
  return /cancel|취소/i.test(errorText(error))
}

/** 결제가 Pi 측에 실제로 생성된 이후 발생한 실패 — 모의 충전 폴백으로 넘기면 안 된다. */
type PiCheckoutError = Error & { piInitiated?: boolean }

function markPiInitiated(error: unknown): boolean {
  return Boolean((error as PiCheckoutError | null)?.piInitiated)
}

function checkoutKind(metadata?: Record<string, unknown>) {
  const kind = metadata?.kind
  return typeof kind === 'string' ? kind.trim() : ''
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
export const PI_CHARGE_MAX_PI = 50
export async function chargePiWallet(amount: number) {
  const value = Math.round(amount * 1_000_000) / 1_000_000
  if (!(value > 0)) throw new Error('충전 금액이 올바르지 않습니다.')
  if (value > PI_CHARGE_MAX_PI) throw new Error(`충전은 한 번에 최대 ${PI_CHARGE_MAX_PI} Pi까지 가능합니다.`)
  const memo = `TaxiTago ${value} Pi 충전`.slice(0, 25)

  if (PI_SANDBOX) {
    const pi = typeof window !== 'undefined' ? window.Pi : undefined
    if (isPiBrowser() && typeof pi?.createPayment === 'function') {
      try {
        return await startPiCheckout({
          amount: value,
          memo,
          metadata: { kind: 'wallet-charge' },
          strictCompletion: true,
        })
      } catch (error) {
        // 실제 결제가 생성된 뒤 승인/완료가 실패·만료된 경우 — 무상 충전으로 대체하지 않는다.
        if (isCancelError(error) || markPiInitiated(error)) throw error
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
    strictCompletion: true,
  })
}

function txidFromPiPayload(payload: unknown) {
  if (typeof payload === 'string') return payload.trim()
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  if (typeof record.txid === 'string' && record.txid.trim()) return record.txid.trim()
  const transaction = record.transaction
  if (transaction && typeof transaction === 'object') {
    const txid = (transaction as Record<string, unknown>).txid
    if (typeof txid === 'string' && txid.trim()) return txid.trim()
  }
  const payment = record.payment
  if (!payment || typeof payment !== 'object') return ''
  return txidFromPiPayload(payment)
}

function readPaymentId(value: unknown) {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  const identifier = record.identifier ?? record.paymentId ?? record.id
  return typeof identifier === 'string' ? identifier.trim() : ''
}

const PI_SERVER_TIMEOUT_MS = 45000

/**
 * Testnet-only mock checkout for environments where window.Pi never loads
 * (PC web, plain mobile browsers). Books the same server-side records a real
 * completion would via /api/pi/mock-pay.
 */
async function mockPiCheckout(options: {
  amount: number
  memo: string
  metadata?: Record<string, unknown>
}): Promise<PiCheckoutResult> {
  const amount = Math.round(options.amount * 1_000_000) / 1_000_000
  logPi('warn', 'mock checkout (Pi SDK unavailable)', { amount, memo: options.memo })
  const approved =
    typeof window === 'undefined'
      ? true
      : window.confirm(
          `[테스트넷 모의 결제]\n\n${options.memo}\n결제 금액: ${amount.toFixed(7)} Pi\n\nPi SDK를 찾지 못해 모의 결제로 진행합니다. 승인할까요?`,
        )
  if (!approved) throw new Error('결제가 취소되었습니다.')
  const response = await apiFetch('/api/pi/mock-pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, memo: options.memo.slice(0, 25), metadata: options.metadata ?? {} }),
  })
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean
    paymentId?: string
    txid?: string
    error?: string
  } | null
  if (!response.ok || payload?.ok !== true || !payload.paymentId) {
    const message = payload?.error || `mock-pay failed (${response.status})`
    logPi('error', 'mock checkout failed', { status: response.status, message })
    throw new Error(message)
  }
  const result = { paymentId: payload.paymentId, txid: payload.txid || `approved-${payload.paymentId}` }
  logPi('log', 'mock checkout settled', result)
  return result
}

export async function startPiCheckout(options: {
  amount: number
  memo: string
  metadata?: Record<string, unknown>
  /** Leave the pending button once approve or complete responds. */
  advanceOnApproval?: boolean
  /**
   * Wallet top-ups only resolve after a verified /api/pi/complete — no
   * "txid exists so treat as paid" fallback. If the real payment did land,
   * the Horizon deposit poller credits it with on-chain proof instead.
   */
  strictCompletion?: boolean
  /** Called as soon as the checkout can leave the pending button, even if the SDK promise is still open. */
  onSettled?: (result: PiCheckoutResult) => void
}) {
  const amount = Math.round(options.amount * 1_000_000) / 1_000_000
  if (!(amount > 0)) throw new Error('결제 금액이 올바르지 않습니다.')

  let pi = await preparePiSdk()
  if (!pi && PI_SANDBOX) {
    const mocked = await mockPiCheckout(options)
    options.onSettled?.(mocked)
    return mocked
  }
  pi ??= requirePiSdk()
  try {
    await withTimeout(authenticatePi(pi), 20_000, 'Pi.authenticate')
  } catch (error) {
    // 캐시된 세션 토큰이 만료됐을 수 있다 — 리셋 후 재인증을 한 번 시도해
    // "세션 끊김"이 곧바로 결제 실패로 번지지 않게 한다.
    if (!isSessionError(error)) throw error
    logPi('warn', 'stale session; re-authenticating', error)
    resetPiSession()
    await withTimeout(authenticatePi(pi), PI_AUTH_TIMEOUT_MS, 'Pi.authenticate retry')
  }

  const label = checkoutLabel(options.metadata)
  if (options.advanceOnApproval && pendingIncomplete?.txid && isMobilityReturnLabel(label) && pendingIncomplete.label === label && pendingIncomplete.paymentId) {
    const recovered = pendingIncomplete
    pendingIncomplete = null
    const result = { paymentId: recovered.paymentId, txid: recovered.txid || `approved-${recovered.paymentId}` }
    logPi('log', 'mobility return recovered from approval', result)
    options.onSettled?.(result)
    return result
  }

  const payment = {
    amount,
    memo: options.memo.slice(0, 25),
    metadata: options.metadata ?? {},
  }
  logPi('log', 'window.Pi.createPayment', payment)

  return new Promise<PiCheckoutResult>((resolve, reject) => {
    let settled = false
    let paymentInitiated = false
    const succeed = (result: PiCheckoutResult) => {
      const paymentId = result.paymentId.trim()
      const txid = result.txid.trim() || (paymentId ? `approved-${paymentId}` : '')
      if (settled || !paymentId || !txid) return
      settled = true
      const next = { paymentId, txid }
      logPi('log', 'checkout settled', next)
      resolve(next)
      try {
        options.onSettled?.(next)
      } catch (error) {
        logPi('error', 'onSettled threw', error)
      }
    }
    const finishError = (label: string, error: unknown, extra?: unknown) => {
      if (settled) return
      settled = true
      logPi('error', label, { error, extra })
      if (isSessionError(error)) resetPiSession()
      const failure: PiCheckoutError = error instanceof Error ? error : new Error(describePiUserMessage(error))
      if (paymentInitiated) failure.piInitiated = true
      reject(failure)
    }

    try {
      pi.createPayment(payment, {
        onReadyForServerApproval: (paymentIdArg) => {
          const paymentId = readPaymentId(paymentIdArg)
          const approvedTxid = txidFromPiPayload(paymentIdArg)
          paymentInitiated = true
          logPi('log', 'onReadyForServerApproval', { paymentId, approvedTxid })
          if (!paymentId) {
            finishError('approve missing paymentId', paymentIdArg)
            return Promise.resolve()
          }
          // 지갑 시트가 뜨는 동안 페이지 fetch가 멈출 수 있어 beacon을 먼저 실어둔다.
          beaconPiApi('/api/pi/approve', { paymentId, kind: checkoutKind(payment.metadata), sandbox: PI_SANDBOX })
          if (options.advanceOnApproval && approvedTxid) succeed({ paymentId, txid: approvedTxid })
          return postPiApiRetry('/api/pi/approve', { paymentId, kind: checkoutKind(payment.metadata), sandbox: PI_SANDBOX })
            .then((payload) => {
              if (options.advanceOnApproval) {
                succeed({ paymentId, txid: txidFromPiPayload(payload) || approvedTxid || `approved-${paymentId}` })
              }
              return payload
            })
            .catch((error) => {
              if (settled) return undefined
              finishError('approve failed', error)
              return undefined
            })
        },
        onReadyForServerCompletion: (paymentIdArg, txidArg) => {
          const paymentId = readPaymentId(paymentIdArg) || readPaymentId(txidArg)
          const txid = txidFromPiPayload(txidArg) || txidFromPiPayload(paymentIdArg)
          paymentInitiated = true
          logPi('log', 'onReadyForServerCompletion', { paymentId, txid })
          if (!paymentId) {
            if (!options.advanceOnApproval) finishError('completion missing ids', { paymentId, txid })
            return Promise.resolve()
          }
          const settledTxid = txid || `approved-${paymentId}`
          if (options.advanceOnApproval) succeed({ paymentId, txid: settledTxid })
          else if (!txid) {
            finishError('completion missing ids', { paymentId, txid })
            return Promise.resolve()
          }
          if (!txid) return Promise.resolve()
          beaconPiApi('/api/pi/complete', {
            paymentId,
            txid,
            amount,
            metadata: payment.metadata,
            kind: checkoutKind(payment.metadata),
            sandbox: PI_SANDBOX,
          })
          return postPiApiRetry('/api/pi/complete', {
            paymentId,
            txid,
            amount,
            metadata: payment.metadata,
            kind: checkoutKind(payment.metadata),
            sandbox: PI_SANDBOX,
          })
            .then(() => {
              succeed({ paymentId, txid })
            })
            .catch((error) => {
              if (settled) return undefined
              // 지갑 충전은 서버 검증 완료만이 충전 근거 — 실패 시 절대 잔액을 올리지 않는다.
              // 실제 체인 결제가 됐다면 Horizon 입금 폴러가 txid로 검증 후 충전한다.
              if (options.strictCompletion) {
                finishError('complete failed', error)
                return undefined
              }
              // txid exists → the blockchain transfer already settled. Treat the checkout as
              // paid; the server finishes the payment via onIncompletePaymentFound recovery.
              logPi('warn', 'complete failed after retry; treating as settled', { paymentId, txid, error })
              succeed({ paymentId, txid })
              return undefined
            })
        },
        onCancel: (paymentId) => {
          paymentInitiated = true
          logPi('warn', 'onCancel', { paymentId })
          finishError('cancelled', new Error('결제가 취소되었습니다.'))
        },
        onError: (error, paymentInfo) => {
          const paymentId = readPaymentId(paymentInfo)
          const txid = txidFromPiPayload(paymentInfo)
          logPi('error', 'onError', { error, paymentInfo, paymentId, txid })
          if (options.advanceOnApproval && paymentId && txid) {
            succeed({ paymentId, txid })
            return
          }
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
  const lockRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [paid, setPaid] = useState(false)

  const fail = (error: unknown) => {
    const next = error instanceof Error ? error : new Error(describePiUserMessage(error))
    if (!(error instanceof Error)) next.cause = error
    logPi('error', 'checkout failed', next)
    onFailed?.(next)
    if (!onFailed) window.alert(describePiUserMessage(next))
  }

  const handleClick = () => {
    if (lockRef.current || disabled) return
    lockRef.current = true
    setBusy(true)
    let delivered = false
    const deliver = (result: PiCheckoutResult) => {
      if (delivered || !result.paymentId || !result.txid) return
      delivered = true
      setPaid(true)
      setBusy(false)
      onPaid?.(result)
    }
    const unlock = () => {
      if (delivered) return
      lockRef.current = false
      setBusy(false)
    }
    try {
      void startPiCheckout({ amount, memo, metadata, advanceOnApproval: true, onSettled: deliver })
        .then((result) => deliver(result))
        .catch((error) => {
          if (!delivered) fail(error)
        })
        .finally(unlock)
    } catch (error) {
      unlock()
      fail(error)
    }
  }

  return (
    <button
      type="button"
      {...buttonProps}
      disabled={busy || paid || disabled}
      aria-busy={busy}
      onClick={handleClick}
      className={`${className ?? ''} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {busy ? 'Pi 결제 진행 중…' : paid ? '결제 완료' : children}
    </button>
  )
}
