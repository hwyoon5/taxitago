'use client'

import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { apiFetch } from '@/lib/app-origin'
import { resolvePiSandbox } from '@/lib/pi-sandbox'
import { payFromBalance } from '@/lib/balance-pay'
import { loadPiIdentity } from '@/lib/partner-account'

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

/**
 * Developer portal testnet → true. Mainnet app → NEXT_PUBLIC_PI_SANDBOX=false.
 * test.* / localhost / preview 호스트는 env가 메인넷이어도 sandbox로 강제된다 —
 * 메인넷 심사 빌드가 테스트 도메인에 붙어도 라이브 키·네트워크가 섞이지 않는다.
 */
export const PI_SANDBOX = resolvePiSandbox({
  host: typeof window === 'undefined' ? null : window.location.hostname,
})

const PI_AUTH_SCOPES = ['username', 'payments'] as const

let initialized = false
let authPromise: Promise<unknown> | null = null

type PendingIncompletePayment = { paymentId: string; txid: string; label: string }

let pendingIncomplete: PendingIncompletePayment | null = null

/**
 * 미완료 결제 추적 — Pi SDK는 onIncompletePaymentFound를 authenticate 안에서만
 * 호출하므로, 세션 중에 완료 처리에 실패한 결제는 여기 남겨 다음 createPayment
 * 전에 drainIncompletePayments가 마저 정리한다. 남은 미완료 건이 새 결제의
 * 승인을 붙잡아 지갑이 '결제 만료(승인 프로세스 시간 초과)'로 끝나는 것을 막는다.
 * 값: txid — ''이면 체인 미제출 건으로 complete 대신 cancel로 종료한다.
 */
const knownIncomplete = new Map<string, string>()
const recoveringIds = new Set<string>()
const incompleteInFlight = new Set<Promise<void>>()

function queueIncompleteRecovery(paymentId: string, txid: string) {
  if (!paymentId || recoveringIds.has(paymentId)) return
  knownIncomplete.set(paymentId, txid)
  recoveringIds.add(paymentId)
  const request = txid
    ? postPiApiRetry('/api/pi/complete', { paymentId, txid, sandbox: PI_SANDBOX })
    : postPiApiRetry('/api/pi/cancel', { paymentId, sandbox: PI_SANDBOX })
  const task = request
    .then((payload) => {
      // 취소 요청이 '사실상 완료된 건'을 발견하면 서버가 txid를 돌려준다 —
      // 그 경우 complete로 전환해 마감한다.
      const redirectedTxid = txidFromPiPayload(payload)
      if (!txid && redirectedTxid && payload && typeof payload === 'object' && (payload as Record<string, unknown>).redirected === 'complete') {
        if (knownIncomplete.get(paymentId) === '') knownIncomplete.set(paymentId, redirectedTxid)
        queueIncompleteRecovery(paymentId, redirectedTxid)
        return
      }
      if (knownIncomplete.get(paymentId) === txid) knownIncomplete.delete(paymentId)
    })
    .catch((error) => {
      // 이미 최종 상태(완료·취소·만료)라 Pi가 거절한 건은 더 이상 락을 잡지
      // 않으므로 추적에서 제외한다 — 매 결제마다 재시도되는 좀비 건 방지.
      if (/already|final|complet|cancel|expir|not.?found|만료/i.test(errorText(error))) {
        knownIncomplete.delete(paymentId)
      }
      logPi('warn', 'incomplete payment recovery failed', { paymentId, txid, error: errorText(error) })
    })
    .finally(() => {
      recoveringIds.delete(paymentId)
      incompleteInFlight.delete(task)
    })
  incompleteInFlight.add(task)
}

/**
 * createPayment 직전에 미완료 결제를 모두 정리한다. 진행 중인 복구를 기다리고,
 * 실패로 남은 건을 다시 큐에 넣어 최대 몇 번까지 회수를 시도한다.
 */
async function drainIncompletePayments() {
  for (let round = 0; round < 4; round += 1) {
    if (incompleteInFlight.size) await Promise.allSettled([...incompleteInFlight])
    const retry = [...knownIncomplete.keys()].filter((id) => !recoveringIds.has(id))
    if (!retry.length) break
    for (const id of retry) queueIncompleteRecovery(id, knownIncomplete.get(id) ?? '')
  }
}

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
  if (!paymentId) return
  // txid가 있으면 서버 complete로 마감, 없으면(승인 후 체인 미제출) cancel로 종료 —
  // 둘 중 하나로 반드시 '미완료' 상태를 해소해야 다음 결제가 막히지 않는다.
  queueIncompleteRecovery(paymentId, txid)
}

/**
 * Pi.authenticate가 시트를 띄우지 못하거나 SDK가 응답을 누락해도 프라미스가
 * 영원히 pending으로 남지 않도록 강제 상한 — 초과 시 authPromise를 리셋해
 * 다음 시도가 새 authenticate를 시작할 수 있게 한다.
 */
const PI_AUTH_RESPONSE_TIMEOUT_MS = 20_000

function authenticatePi(pi: PiSdk) {
  initPi(pi)
  if (!authPromise) {
    // Fire-and-forget: if the SDK awaits this callback before resolving
    // authenticate, a leftover incomplete payment would stall every checkout
    // behind a /api/pi/complete round-trip.
    const pending = pi.authenticate([...PI_AUTH_SCOPES], (payment) => {
      void onIncompletePaymentFound(payment)
    })
    const watchdog = new Promise<never>((_, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error(`Pi.authenticate 응답 없음(${PI_AUTH_RESPONSE_TIMEOUT_MS / 1000}초) — 인증 시트가 열리지 않았거나 네트워크가 지연되고 있습니다.`))
      }, PI_AUTH_RESPONSE_TIMEOUT_MS)
      // SDK가 정상 settle되면 타이머를 해제해 잔여 reject가 새어 나가지 않게 한다.
      pending.finally(() => window.clearTimeout(timer))
    })
    authPromise = Promise.race([pending, watchdog])
      .then((auth) => {
        logPi('log', 'authenticate ok', { scopes: PI_AUTH_SCOPES, auth })
        return auth
      })
      .catch((error) => {
        // 타임아웃 포함 모든 실패에서 캐시를 리셋 — pending인 SDK 프라미스가
        // 남아 있어도 다음 호출이 신선한 authenticate로 재시도한다.
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

export function isPiBrowser() {
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
  if (/timed out|TimeoutError|AbortError|응답 없음/i.test(text)) {
    return 'Pi 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.'
  }
  // 인증 시트가 뜨지 않는 환경(일반 브라우저 등)은 세션 문제가 아니다 —
  // "authenticate" 문자열이 세션 정규식에 걸려 오진하는 것을 막는다.
  if (!isPiBrowser() && /authenticate|pi browser|window\.Pi/i.test(text)) {
    return 'Pi Browser 환경이 아닙니다. 파이 브라우저에서 다시 열어 주세요.'
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
type PiApiPath = '/api/pi/approve' | '/api/pi/complete' | '/api/pi/cancel'

function beaconPiApi(path: PiApiPath, body: Record<string, unknown>) {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return
    const queued = navigator.sendBeacon(`${path}/`, new Blob([JSON.stringify(body)], { type: 'application/json' }))
    logPi('log', `${path} beacon`, { queued })
  } catch (error) {
    logPi('warn', `${path} beacon failed`, error)
  }
}

async function postPiApi(path: PiApiPath, body: Record<string, unknown>) {
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

function piApiLabel(path: PiApiPath) {
  return path === '/api/pi/approve' ? 'Pi 결제 승인' : path === '/api/pi/complete' ? 'Pi 결제 완료' : 'Pi 결제 취소'
}

/** Serverless cold starts and Pi API latency can push one call past the window — retry once. */
async function postPiApiRetry(path: PiApiPath, body: Record<string, unknown>, retries = 1) {
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
    // 관리자 이용 정지(Lock) 계정은 로그인 완료 직전에 차단한다.
    // 조회 실패(404 미등록·네트워크)는 로그인을 막지 않고 서비스 게이트가 처리한다.
    try {
      const res = await apiFetch(`/api/partner/link?uid=${encodeURIComponent(session.uid)}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      })
      const data = (await res.json().catch(() => null)) as { locked?: boolean } | null
      if (res.ok && data?.locked) {
        throw new Error('관리자에 의해 이용이 정지된 계정입니다.')
      }
    } catch (error) {
      if (error instanceof Error && error.message === '관리자에 의해 이용이 정지된 계정입니다.') throw error
    }
    logPi('log', 'sign-in session', session)
    return session
  } catch (error) {
    resetPiSession()
    // Lock 차단은 샌드박스 폴백으로 삼키지 않고 그대로 이용자에게 전달한다.
    if (error instanceof Error && error.message === '관리자에 의해 이용이 정지된 계정입니다.') throw error
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
 * 발급 토큰을 백엔드(/api/pi/auth → Pi /v2/me)로 재검증한다. 로그인 시점에서는
 * 감사 용도로만 쓰고 절대 throw하지 않는다 — 방금 authenticate로 받은 토큰이
 * 권위이고, /v2/me가 테스트넷 토큰을 거절(401)하는 환경에서 이 검사로 모든
 * 정상 로그인이 차단되는 사태를 막기 위함이다. 위조 방지는 API 호출 시점의
 * 서버 검증(/api/rides의 verifyPiAccessToken)이 그대로 담당한다.
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
      // 무한 대기하므로 상한을 둔다(서버 /v2/me 8s + 왕복 여유).
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null
    if (!res.ok || data?.ok !== true) {
      // 401 포함 어떤 거절도 로그인을 차단하지 않는다 — 로그만 남기고 진행.
      logPi('warn', 'sign-in verification rejected', { status: res.status, data })
      return
    }
    logPi('log', 'sign-in verified on server', { uid: session.uid })
  } catch (error) {
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
  // 서버 장부 크레딧 귀속용 식별자 — 없으면 모의 충전이 앱 잔액에 반영되지 않는다.
  const identity = typeof window === 'undefined' ? null : loadPiIdentity()
  const response = await apiFetch('/api/pi/charge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount,
      memo,
      metadata: { kind: 'wallet-charge' },
      uid: identity?.uid || undefined,
      wallet: identity?.wallet || undefined,
    }),
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
  // SDK 스크립트는 일반 브라우저에서도 로드되지만 authenticate는 Pi Browser
  // 안에서만 동작한다 — 테스트넷에서는 SDK가 있어도 Pi Browser 밖이면
  // 모의 결제로 빠져야 QR로 연 수동 결제 흐름이 끊기지 않는다.
  if ((!pi || !isPiBrowser()) && PI_SANDBOX) {
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

  // 이전 결제가 미완료로 남아 있으면 새 결제의 승인이 막혀 지갑이 만료된다 —
  // createPayment 전에 미완료 건을 complete/cancel로 반드시 정리한다.
  await drainIncompletePayments()

  // 승인 타임아웃·만료 류 실패이고 아직 paymentId가 생성되지 않았다면
  // (체인 청구가 물리적으로 불가능한 단계) 세션 리셋 + 미완료 정리 후 1회 재시도.
  let lastError: unknown
  for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
    const attempt: { paymentId: string; txid: string } = { paymentId: '', txid: '' }
    try {
      return await runCreatePayment(pi, payment, options, attempt)
    } catch (error) {
      lastError = error
      if (attemptIndex === 0 && !attempt.paymentId && isExpiryLikeError(error)) {
        logPi('warn', 'createPayment failed pre-initiation; resetting session and retrying once', error)
        resetPiSession()
        try {
          await withTimeout(authenticatePi(pi), PI_AUTH_TIMEOUT_MS, 'Pi.authenticate (retry)')
        } catch (authError) {
          logPi('warn', 'retry authenticate failed', authError)
        }
        await drainIncompletePayments()
        continue
      }
      throw error
    }
  }
  throw lastError
}

/** 만료·승인 타임아웃 류 — 미완료 결제 락이 원인일 때 재시도 가치가 있는 오류. */
function isExpiryLikeError(error: unknown) {
  return /만료|expired|timeout|timed out|승인|approv/i.test(errorText(error))
}

type PaymentAttemptState = { paymentId: string; txid: string }

function runCreatePayment(
  pi: PiSdk,
  payment: { amount: number; memo: string; metadata: Record<string, unknown> },
  options: {
    amount: number
    memo: string
    metadata?: Record<string, unknown>
    advanceOnApproval?: boolean
    strictCompletion?: boolean
    onSettled?: (result: PiCheckoutResult) => void
  },
  attempt: PaymentAttemptState,
) {
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
      // 이 시도에서 생성된 결제는 미완료로 남았을 수 있다 — 다음 결제가
      // 막히지 않도록 복구 큐에 올린다(txid 없으면 cancel로 종료된다).
      if (attempt.paymentId) queueIncompleteRecovery(attempt.paymentId, attempt.txid)
      const failure: PiCheckoutError = error instanceof Error ? error : new Error(describePiUserMessage(error))
      if (paymentInitiated) failure.piInitiated = true
      reject(failure)
    }

    try {
      pi.createPayment(payment, {
        onReadyForServerApproval: (paymentIdArg) => {
          const paymentId = readPaymentId(paymentIdArg)
          const approvedTxid = txidFromPiPayload(paymentIdArg)
          if (paymentId) attempt.paymentId = paymentId
          if (approvedTxid) attempt.txid = approvedTxid
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
          if (paymentId) attempt.paymentId = paymentId
          if (txid) attempt.txid = txid
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
            amount: payment.amount,
            metadata: payment.metadata,
            kind: checkoutKind(payment.metadata),
            sandbox: PI_SANDBOX,
          })
          return postPiApiRetry('/api/pi/complete', {
            paymentId,
            txid,
            amount: payment.amount,
            metadata: payment.metadata,
            kind: checkoutKind(payment.metadata),
            sandbox: PI_SANDBOX,
          })
            .then(() => {
              succeed({ paymentId, txid })
            })
            .catch((error) => {
              if (settled) return undefined
              // 완료 확인에 실패한 결제는 미완료로 남는다 — 다음 결제가 이 건에
              // 막혀 만료되지 않도록 복구 큐에 올려 재시도·정리한다.
              queueIncompleteRecovery(paymentId, txid)
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
          const id = readPaymentId(paymentId)
          if (id) attempt.paymentId = id
          paymentInitiated = true
          logPi('warn', 'onCancel', { paymentId })
          finishError('cancelled', new Error('결제가 취소되었습니다.'))
        },
        onError: (error, paymentInfo) => {
          const paymentId = readPaymentId(paymentInfo)
          const txid = txidFromPiPayload(paymentInfo)
          if (paymentId) attempt.paymentId = paymentId
          if (txid) attempt.txid = txid
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

/**
 * 앱 잔액 결제 버튼 — PiCheckoutButton과 같은 props를 받지만 Pi SDK 시트 대신
 * 서버 잔액 장부(/api/wallet/spend)에서 즉시 차감한다. 잔액 부족 시 서버가
 * 400을 돌려주고 onFailed로 안내 문구가 전달된다.
 * metadata.kind 매핑: escrow-lock → ride(rideId 필요), manual-settle → manual
 * (manualId 필요), 나머지 → service 정산.
 */
export function BalanceCheckoutButton({
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
    const next = error instanceof Error ? error : new Error(String(error))
    logPi('error', 'balance pay failed', next)
    onFailed?.(next)
    if (!onFailed) window.alert(next.message || '결제를 처리하지 못했습니다.')
  }

  const handleClick = () => {
    if (lockRef.current || disabled) return
    lockRef.current = true
    setBusy(true)
    const kind = checkoutKind(metadata)
    const purpose =
      kind === 'escrow-lock' ? 'ride' : kind === 'manual-settle' ? 'manual' : 'service'
    const meta = metadata ?? {}
    void payFromBalance({
      purpose,
      amount,
      rideId: typeof meta.rideId === 'string' ? meta.rideId : undefined,
      manualId: typeof meta.manualId === 'string' ? meta.manualId : undefined,
      label: typeof meta.label === 'string' ? meta.label : memo,
      place: typeof meta.place === 'string' ? meta.place : undefined,
      service: typeof meta.service === 'string' ? meta.service : undefined,
      partnerId: typeof meta.partnerId === 'string' ? meta.partnerId : undefined,
      partnerName: typeof meta.partnerName === 'string' ? meta.partnerName : undefined,
    })
      .then((result) => {
        setPaid(true)
        setBusy(false)
        onPaid?.(result)
      })
      .catch((error) => {
        lockRef.current = false
        setBusy(false)
        fail(error)
      })
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
      {busy ? '잔액 결제 처리 중…' : paid ? '결제 완료' : children}
    </button>
  )
}
