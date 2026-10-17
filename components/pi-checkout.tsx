'use client'

import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { apiFetch } from '@/lib/app-origin'
import { isPiWalletAddress, PLATFORM_DEPOSIT_WALLET } from '@/lib/pi-wallet'
import { resolvePiSandbox } from '@/lib/pi-sandbox'

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

export type PiCheckoutResult = {
  paymentId: string
  txid: string
  /** 결제 수신 지갑 주소(수령인) — 서버 완료 응답의 검증된 to_address가 우선. */
  payee?: string
}

/**
 * Developer portal testnet → true. Mainnet app → NEXT_PUBLIC_PI_SANDBOX=false.
 * test.* / localhost / preview 호스트는 env가 메인넷이어도 sandbox로 강제된다 —
 * 메인넷 심사 빌드가 테스트 도메인에 붙어도 라이브 키·네트워크가 섞이지 않는다.
 */
export const PI_SANDBOX = resolvePiSandbox({
  host: typeof window === 'undefined' ? null : window.location.hostname,
})

/**
 * 인증 스코프 — 메인넷은 'wallet_address'를 추가로 요청한다. 이 스코프는 KYC와
 * 메인넷 이전을 마친 계정만 부여할 수 있어 "KYC 인증 통과 계정" 게이트의
 * 실용적 근거가 된다. 테스트넷은 지갑 미보유 개발 계정이 많으므로 요청하지
 * 않는다 — 요청하면 지갑 없는 테스트 계정이 인증 단계에서 튕긴다.
 */
const piAuthScopes = () => (PI_SANDBOX ? ['username', 'payments'] : ['username', 'payments', 'wallet_address'])

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
      // 이미 최종 상태(완료·취소·만료·미존재)라 Pi가 거절한 건은 더 이상 락을 잡지
      // 않으므로 추적에서 제외한다 — 매 결제마다 재시도되는 좀비 건 방지.
      // 'Pi API 404'처럼 메시지 없는 본문 404도 '결제 없음'으로 수렴한다.
      if (/already|final|complet|cancel|expir|not.?found|\b404\b|만료/i.test(errorText(error))) {
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
  // '퀵보드 이용'은 과거 메타데이터 표기 — '킥보드 이용'과 함께 인식한다.
  return label === '자전거 이용' || label === '킥보드 이용' || label === '퀵보드 이용'
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
/**
 * authenticate는 지갑 로그인 시트에서 사용자 승인을 기다리는 상호작용이라
 * 응답이 느릴 수 있다 — 20초는 현장 승인을 자르기에 짧아 여유를 둔다.
 * 이 상한은 SDK가 시트도 못 띄우고 프라미스가 영원히 pending인 경우를
 * 막는 워치독이지, 사용자 승인 속도를 재촉하는 제한이 아니다.
 */
const PI_AUTH_RESPONSE_TIMEOUT_MS = 90_000

function authenticatePi(pi: PiSdk) {
  initPi(pi)
  if (!authPromise) {
    // Fire-and-forget: if the SDK awaits this callback before resolving
    // authenticate, a leftover incomplete payment would stall every checkout
    // behind a /api/pi/complete round-trip.
    const pending = pi.authenticate(piAuthScopes(), (payment) => {
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
        logPi('log', 'authenticate ok', { scopes: piAuthScopes(), auth })
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

/**
 * Pi 결제 API의 절대 오리진 — 앱이 Pi App Studio 래퍼(*.piappengine.com)나
 * 프리뷰 도메인에서 열리면 상대 경로('/api/pi/approve')가 그쪽 서버로 가서
 * 승인 요청이 우리 백엔드에 아예 도달하지 않는다. 정식 도메인·로컬에서는
 * same-origin을 유지하고, 그 외 호스트에서는 정규 백엔드 오리진으로 고정한다.
 * NEXT_PUBLIC_PI_API_ORIGIN으로 재지정 가능 — 네트워크별로
 * NEXT_PUBLIC_PI_API_ORIGIN_TESTNET/_MAINNET이 우선한다.
 * 기본값도 네트워크별로 분리: 테스트넷은 test.taxitago.co.kr,
 * 메인넷은 taxitago.co.kr — 메인넷 기본값이 테스트 도메인이면 래퍼 앱의
 * 승인 요청이 테스트넷 백엔드로 새어 영원히 만료된다.
 * (클라이언트 번들은 NEXT_PUBLIC_*를 정적으로 인라인하므로 동적 키 접근 불가)
 */
const PI_API_CANONICAL_ORIGIN = (
  (PI_SANDBOX
    ? (process.env.NEXT_PUBLIC_PI_API_ORIGIN_TESTNET || '').trim()
    : (process.env.NEXT_PUBLIC_PI_API_ORIGIN_MAINNET || '').trim()) ||
  (process.env.NEXT_PUBLIC_PI_API_ORIGIN || '').trim() ||
  (PI_SANDBOX ? 'https://test.taxitago.co.kr' : 'https://taxitago.co.kr')
).replace(/\/+$/, '')
const PI_API_CANONICAL_HOST = (() => {
  try {
    return new URL(PI_API_CANONICAL_ORIGIN).hostname.toLowerCase()
  } catch {
    return ''
  }
})()

function piApiBaseOrigin() {
  if (typeof window === 'undefined') return ''
  const host = window.location.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local')
  ) {
    return ''
  }
  // 테스트넷(샌드박스) 결제는 앱이 어느 도메인에서 열리든 항상 테스트 백엔드로
  // 보낸다. 샌드박스 앱 URL이 프로덕션 도메인(taxitago.co.kr)으로 등록돼 있으면
  // same-origin 호출이 메인넷 키를 쓰는 프로덕션 백엔드로 가 승인이 영원히
  // 실패하고, 그 요청은 테스트 배포 로그에도 남지 않는다 — "서버에 요청이 아예
  // 도달하지 않는" 것처럼 보이는 원인이다.
  if (PI_SANDBOX) {
    return host === PI_API_CANONICAL_HOST ? '' : PI_API_CANONICAL_ORIGIN
  }
  // 메인넷 — 정식 도메인에서는 same-origin, 래퍼/프리뷰 호스트에서는 정식
  // 백엔드 오리진으로 고정한다. test.* 호스트는 piHostSuggestsSandbox가
  // sandbox로 강제하므로 이 분기에 도달하지 않는다.
  if (host === 'taxitago.co.kr' || host === 'www.taxitago.co.kr' || host === PI_API_CANONICAL_HOST) {
    return ''
  }
  return PI_API_CANONICAL_ORIGIN
}

/** Pi 결제 경로만 절대 오리진으로 해석한다 — canonical은 trailing-slash 정규형. */
function piApiUrl(path: string) {
  const normalized = `/${path.replace(/^\/+|\/+$/g, '')}/`
  const base = piApiBaseOrigin()
  return base ? `${base}${normalized}` : normalized
}

async function piApiFetch(path: string, init?: RequestInit) {
  const url = piApiUrl(path)
  if (typeof fetch === 'function') {
    return fetch(url, { cache: 'no-store', ...init })
  }
  // 극구형 WebView에 fetch가 없으면 모든 승인/완료 요청이 침묵 실패한다 —
  // XMLHttpRequest 폴백으로 최소한의 POST 경로를 확보한다.
  return xhrPiApi(url, init)
}

/** fetch 부재 환경용 XMLHttpRequest 폴백 — Response 최소 호환형을 반환한다. */
function xhrPiApi(url: string, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest()
      xhr.open(init?.method || 'GET', url, true)
      const headers = init?.headers
      if (headers) {
        for (const [key, value] of Object.entries(headers as Record<string, string>)) {
          try {
            xhr.setRequestHeader(key, value)
          } catch {
            /* 허용되지 않는 헤더는 건너뛴다 */
          }
        }
      }
      xhr.timeout = 30_000
      xhr.onload = () => {
        const text = xhr.responseText ?? ''
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          json: () => Promise.resolve(JSON.parse(text)),
          text: () => Promise.resolve(text),
        } as Response)
      }
      xhr.onerror = () => reject(new Error(`XHR ${url} network error`))
      xhr.ontimeout = () => reject(new Error(`XHR ${url} timed out`))
      xhr.send(typeof init?.body === 'string' ? init.body : undefined)
    } catch (error) {
      reject(error instanceof Error ? error : new Error('XHR request failed'))
    }
  })
}

/**
 * 직렬화가 실패해도 요청 자체를 죽이지 않는다 — metadata에 순환 참조나
 * BigInt가 섞이면 JSON.stringify가 동기 예외를 던져 fetch 호출 전에 콜백이
 * 죽고 서버에 요청이 한 건도 나가지 않는다.
 */
function safeJsonStringify(body: Record<string, unknown>) {
  try {
    return JSON.stringify(body)
  } catch {
    try {
      const shallow: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(body)) {
        shallow[key] = typeof value === 'object' && value !== null ? '[unserializable]' : value
      }
      return JSON.stringify(shallow)
    } catch {
      return '{}'
    }
  }
}

function beaconPiApi(path: PiApiPath | string, body: Record<string, unknown>) {
  try {
    const url = piApiUrl(path)
    const payload = safeJsonStringify(body)
    // 문자열 데이터는 sendBeacon이 text/plain;charset=UTF-8로 보낸다 —
    // simple request라 cross-origin에서도 프리플라이트 없이 도달하고,
    // Blob 생성자가 없는 구형 WebView에서도 동작한다.
    let queued = false
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        queued = navigator.sendBeacon(url, payload)
      } catch {
        queued = false
      }
    }
    if (!queued) {
      // sendBeacon 미지원·큐 거부(WebView 제한) 시에도 요청이 유실되지 않도록
      // keepalive fetch로 보강한다 — text/plain은 프리플라이트가 필요 없다.
      void piApiFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: payload,
        keepalive: true,
        signal: piTimeoutSignal(10_000),
      }).catch((error) => logPi('warn', `${path} beacon-fetch failed`, error))
    }
    logPi('log', `${path} beacon`, { queued, url })
  } catch (error) {
    logPi('warn', `${path} beacon failed`, error)
  }
}

/**
 * 서버 로그로 관측 가능한 클라이언트 생명주기 트레이스 — Pi Browser 안에서는
 * 개발자 콘솔을 볼 수 없어 'SDK 콜백이 불렸는지'조차 확인이 안 된다. beacon은
 * 지갑 시트 중 스로틀되는 fetch와 달리 OS 큐에서 전송되므로 승인 요청 자체가
 * 유실돼도 트레이스는 남는다. /api/pi/trace는 로그만 남기고 204로 끝난다.
 */
function tracePi(label: string, extra?: Record<string, unknown>) {
  try {
    beaconPiApi('/api/pi/trace', {
      label,
      extra: {
        host: typeof location !== 'undefined' ? location.host : '',
        href: typeof location !== 'undefined' ? location.href : '',
        apiBase: piApiBaseOrigin() || '(same-origin)',
        ...extra,
      },
    })
  } catch {
    /* 트레이스 실패가 결제를 막으면 안 된다 */
  }
}

/**
 * 콜백 진입 신호 — SDK 콜백이 실제로 발화했는지를 서버 로그로 입증하기 위해
 * 각 콜백의 첫 문장에서 동기 호출한다. 파싱·헬퍼보다 먼저 나가야 하므로 모든
 * 단계를 개별 try로 감싼다:
 *  1) console.log — Pi Browser 콘솔은 못 보지만 데스크톱 디버깅용
 *  2) sendBeacon POST — OS 큐라 지갑 시트 중 JS 스로틀에도 전송
 *  3) new Image() GET 픽셀 — fetch/XHR/beacon이 통째로 막혀도 나가는 최후 채널
 * 셋 중 하나라도 도달하면 서버 로그에 '[Pi-trace] <label>'이 남는다.
 */
function signalPi(label: string, extra?: Record<string, unknown>) {
  try {
    console.log(`[Pi-signal] ${label}`, extra ?? '')
  } catch {
    /* ignore */
  }
  tracePi(label, extra)
  try {
    const params = new URLSearchParams()
    params.set('label', label.slice(0, 100))
    for (const [key, value] of Object.entries(extra ?? {}).slice(0, 6)) {
      if (value == null) continue
      params.set(key.slice(0, 40), String(value).slice(0, 120))
    }
    let url = ''
    try {
      url = `${piApiUrl('/api/pi/trace')}?${params.toString()}`
    } catch {
      url = `/api/pi/trace/?${params.toString()}`
    }
    const img = new Image()
    img.src = url
  } catch {
    /* 픽셀 핑 실패도 결제를 막지 않는다 */
  }
}

/**
 * 결제창이 열린 뒤 첫 승인 요청이 라우트 컴파일(dev)이나 서버리스 콜드
 * 스타트를 겪으면 지갑의 승인 마감(수십 초)이 응답 도착 전에 끝나
 * '결제 준비 중'에서 만료된다 — 결제 흐름 시작 시점에 {warmup:true} 마커
 * 요청으로 approve/complete 라우트를 미리 깨워둔다. 서버는 이를 결제가
 * 아닌 핑으로 인식해 에러 로그 없이 200을 돌려준다.
 */
let piApiWarmed = false
function warmPiPaymentApi() {
  if (piApiWarmed || typeof window === 'undefined') return
  piApiWarmed = true
  for (const path of ['/api/pi/approve', '/api/pi/complete'] as const) {
    void piApiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      // warmup 마커 — 서버가 이를 결제 요청으로 오인해 'paymentId required'
      // 에러 로그를 남기지 않도록 명시한다.
      body: safeJsonStringify({ warmup: true }),
      keepalive: true,
      signal: piTimeoutSignal(10_000),
    })
      .then((res) => logPi('log', `${path} warm`, { status: res.status }))
      .catch((error) => logPi('warn', `${path} warm failed`, error))
  }
}

async function postPiApi(path: PiApiPath, body: Record<string, unknown>) {
  const startedAt = Date.now()
  logPi('log', `${path} request`, { ...body, url: piApiUrl(path) })
  const response = await piApiFetch(path, {
    method: 'POST',
    // text/plain은 'simple request'라 cross-origin에서도 프리플라이트 없이
    // 곧장 전송된다 — WebView가 OPTIONS preflight를 유실하면 JSON POST는
    // 서버에 한 번도 도달하지 않는다("요청이 아예 없다" 증상의 제거).
    headers: { 'Content-Type': 'text/plain' },
    body: safeJsonStringify(body),
    // keepalive: 지갑 모달로 페이지가 백그라운드돼도 요청이 끝까지 전달된다.
    keepalive: true,
    // 서버 승인 예산(시도당 8s × 최대 2회 + 왕복)에 맞춘 상한 — 네트워크가
    // 멈춰도 결제 스피너가 무한 대기하지 않게 한다.
    signal: piTimeoutSignal(PI_APPROVE_SERVER_TIMEOUT_MS),
  })
  const payload = (await response.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null
  if (!response.ok || payload?.ok !== true) {
    const message = typeof payload?.error === 'string' ? payload.error : `${path} failed (${response.status})`
    logPi('error', `${path} failed`, { status: response.status, payload, message, ms: Date.now() - startedAt })
    throw new Error(message)
  }
  logPi('log', `${path} ok`, { status: response.status, payload, ms: Date.now() - startedAt })
  return payload
}

/**
 * REST형 대체 승인 경로 — POST /api/pi/payments/:id/approve.
 * 기본 /api/pi/approve 경로가 엣지 규칙·경로 차단 등으로 도달하지 못하는
 * 경우를 대비한 폴백이다. 핸들러·검증 로직은 동일한데, 승인은 멱등이라
 * beacon과 기본 fetch가 둘 다 도달해도 안전하다.
 */
async function postPiApproveRest(paymentId: string, body: Record<string, unknown>) {
  const path = `/api/pi/payments/${encodeURIComponent(paymentId)}/approve`
  const startedAt = Date.now()
  logPi('log', `${path} request (fallback)`, { paymentId, url: piApiUrl(path) })
  const response = await piApiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: safeJsonStringify(body),
    keepalive: true,
    signal: piTimeoutSignal(15_000),
  })
  const payload = (await response.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null
  if (!response.ok || payload?.ok !== true) {
    const message = typeof payload?.error === 'string' ? payload.error : `${path} failed (${response.status})`
    logPi('error', `${path} failed`, { status: response.status, payload, message, ms: Date.now() - startedAt })
    throw new Error(message)
  }
  logPi('log', `${path} ok`, { status: response.status, ms: Date.now() - startedAt })
  return payload
}

/**
 * AbortSignal.timeout() 폴백 — Pi Browser의 내장 WebView가 구형 Chromium이면
 * AbortSignal.timeout 자체가 없어 fetch init 객체 생성 시점에 동기 TypeError로
 * 죽고, 요청이 네트워크에 한 건도 나가지 않는다("서버에 요청이 아예 도달하지
 * 않는" 증상과 일치). 폴백은 AbortController + setTimeout으로 같은 동작을 한다.
 */
function piTimeoutSignal(ms: number): AbortSignal | undefined {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(ms)
    }
    const controller = new AbortController()
    window.setTimeout(() => controller.abort(), ms)
    return controller.signal
  } catch {
    return undefined
  }
}

const PI_CALL_TIMEOUT_MS = 8000
/** 로그인 시트는 사용자 상호작용이 필요 — 지갑에서 승인할 시간을 충분히
 *  준다(짧게 자르면 정상 승인이 '세션 만료'로 오인된다). */
const PI_AUTH_TIMEOUT_MS = 90_000
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
/**
 * App Studio 로그인 엔드포인트 — 앱별 고유 도메인(`backend.appstudio-<slug>
 * .piappengine.com`)이라 client ID로 파생되지 않는다. App Studio에서 만든 앱의
 * URL은 대시보드에서 확인해 NEXT_PUBLIC_PI_APP_STUDIO_LOGIN_URL로 주입한다.
 * 샌드박스 포털 앱(sandbox.minepi.com/app/taxitago-2w8q)에는 이 엔드포인트가
 * 없을 수 있어, 미설정이면 포워딩을 생략한다(구 앱 도메인 폴백 없음).
 */
// 네트워크별 엔드포인트 env(NEXT_PUBLIC_PI_APP_STUDIO_LOGIN_URL_TESTNET/
// _MAINNET)가 있으면 우선한다 — App Studio 앱은 네트워크마다 고유 도메인.
const PI_APP_STUDIO_LOGIN_URL = (
  (PI_SANDBOX
    ? (process.env.NEXT_PUBLIC_PI_APP_STUDIO_LOGIN_URL_TESTNET || '').trim()
    : (process.env.NEXT_PUBLIC_PI_APP_STUDIO_LOGIN_URL_MAINNET || '').trim()) ||
  (process.env.NEXT_PUBLIC_PI_APP_STUDIO_LOGIN_URL || '').trim()
)
/**
 * 이 SDK가 결제를 생성하는 Pi 앱의 식별자 — 샌드박스 앱(taxitago-2w8q)의
 * Auth client ID(포털에서 공개 값으로 발급). 포털에서 앱이 분리된 경우
 * 백엔드 API 키의 앱과 다르면 승인이 401/404로 끝나므로, 상관관계용으로
 * 승인 요청 body에 함께 실어 보낸다.
 * 네트워크별 env(NEXT_PUBLIC_PI_APP_ID_TESTNET/_MAINNET) → 공용
 * NEXT_PUBLIC_PI_APP_ID → 테스트넷 기본값 순. 메인넷에서는 테스트넷 식별자를
 * 보내지 않도록 기본값을 비운다(서버는 '(unknown)'으로 처리한다).
 */
const PI_APP_INSTANCE =
  (PI_SANDBOX
    ? (process.env.NEXT_PUBLIC_PI_APP_ID_TESTNET || '').trim()
    : (process.env.NEXT_PUBLIC_PI_APP_ID_MAINNET || '').trim()) ||
  (process.env.NEXT_PUBLIC_PI_APP_ID || '').trim() ||
  (PI_SANDBOX ? 'Lqzm93E4twPAWjR_CQ3qgMYdWyFbOPYl9e-dxB_u9s8' : '')

/**
 * authenticate 직후 accessToken을 App Studio 로그인 엔드포인트로 교환한다.
 * 실패해도 로그인 자체는 막지 않고 경고만 남긴다 — 서버 측 /api/pi/auth가
 * 동일 토큰을 한 번 더 포워딩하므로 CORS/일시 장애로 검증이 끊기지 않는다.
 */
async function loginPiAppStudio(accessToken: string) {
  // App Studio 엔드포인트가 없는 앱(샌드박스 포털 앱 등)에서는 호출하지 않는다.
  if (!PI_APP_STUDIO_LOGIN_URL) return false
  try {
    const res = await fetch(PI_APP_STUDIO_LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: safeJsonStringify({ accessToken }),
      signal: piTimeoutSignal(10_000),
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
    warmPiPaymentApi()
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
  /** 지갑 주소가 인증 결과에서 실제로 내려온 경우 true — false면
   *  uid로 만든 합성 주소이며 메인넷 KYC 게이트를 통과하지 못한다. */
  walletVerified?: boolean
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
  const realWallet =
    pickString(user, ['walletAddress', 'wallet_address', 'wallet']) ||
    pickString(asRecord(user?.credentials), ['wallet_address', 'walletAddress', 'wallet']) ||
    pickString(root, ['walletAddress', 'wallet_address', 'wallet'])
  const wallet = realWallet || walletFromPiUid(uid)
  const accessToken = pickString(root, ['accessToken', 'access_token']) || undefined
  return { uid, username, wallet, accessToken, walletVerified: Boolean(realWallet) }
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
    // 메인넷 KYC 강제 — wallet_address 스코프는 KYC·메인넷 이전 완료 계정에만
    // 부여된다. 지갑 주소가 안 내려오면 스코프가 거절된 것이므로 가입/이용을
    // 막고 안내한다(테스트넷은 지갑 없는 개발 계정을 허용하므로 검사 안 함).
    if (!PI_SANDBOX && !session.walletVerified) {
      throw new Error('Pi KYC 인증이 완료된 계정만 이용할 수 있습니다. Pi 앱에서 KYC와 메인넷 이전을 완료한 뒤 다시 로그인해 주세요.')
    }
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
        signal: piTimeoutSignal(8_000),
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
    const res = await piApiFetch('/api/pi/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: safeJsonStringify({ uid: session.uid, accessToken: session.accessToken }),
      // apiFetch엔 기본 타임아웃이 없다 — 검증 서버가 멈추면 로그인 스피너가
      // 무한 대기하므로 상한을 둔다(서버 /v2/me 8s + 왕복 여유).
      signal: piTimeoutSignal(15_000),
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

/** 결제가 Pi 측에 실제로 생성된 이후 발생한 실패 — 무상 폴백으로 넘기면 안 된다. */
type PiCheckoutError = Error & { piInitiated?: boolean }

function checkoutKind(metadata?: Record<string, unknown>) {
  const kind = metadata?.kind
  return typeof kind === 'string' ? kind.trim() : ''
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

/**
 * Pi 결제 응답(PaymentDTO·서버 래퍼)에서 수령인 지갑 주소를 읽는다.
 * 서버 complete 응답의 `payee`, DTO의 `to_address`, 체인 트랜잭션의
 * `to` 순으로 찾고 형식(G + 55자)이 확인된 값만 돌려준다.
 */
function payeeFromPiPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  const direct = record.payee ?? record.toAddress ?? record.to_address
  if (isPiWalletAddress(direct)) return (direct as string).trim()
  const transaction = record.transaction
  if (transaction && typeof transaction === 'object') {
    const to = (transaction as Record<string, unknown>).to ?? (transaction as Record<string, unknown>).to_address
    if (isPiWalletAddress(to)) return (to as string).trim()
  }
  const payment = record.payment
  if (payment && typeof payment === 'object') return payeeFromPiPayload(payment)
  return ''
}

const PI_SERVER_TIMEOUT_MS = 45000

/**
 * Testnet-only mock checkout for environments where window.Pi never loads
 * (PC web, plain mobile browsers). Books the same server-side records a real
 * completion would via /api/pi/mock-pay — the server only honors this on a
 * testnet host with the explicit PI_MOCK_PAY env enabled; otherwise the
 * request is rejected and the error surfaces as a normal checkout failure.
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
  const response = await piApiFetch('/api/pi/mock-pay', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: safeJsonStringify({ amount, memo: options.memo.slice(0, 25), metadata: options.metadata ?? {} }),
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
  const result = {
    paymentId: payload.paymentId,
    txid: payload.txid || `approved-${payload.paymentId}`,
    // 모의 결제에도 수령인 표기를 유지 — 영수증 UI가 항목을 고정으로 보여 준다.
    payee: PLATFORM_DEPOSIT_WALLET,
  }
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

  tracePi('checkout start', { amount, memo: options.memo.slice(0, 25) })
  warmPiPaymentApi()
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
  // 결제는 반드시 인증된 지갑 세션 위에서 생성한다 — 세션 UID를 메타데이터와
  // 서버 승인/완료 요청에 함께 실어 Pi가 결제를 만든 계정과 서버 기록이
  // 같은 사용자로 대조된다(서버 검증은 Pi가 반환한 user_uid가 권위이며,
  // 이 값은 로그 상관관계와 분쟁 추적용이다).
  let sessionUid = ''
  try {
    const auth = await withTimeout(authenticatePi(pi), PI_AUTH_TIMEOUT_MS, 'Pi.authenticate')
    sessionUid = parsePiAuthResult(auth)?.uid ?? ''
  } catch (error) {
    // 캐시된 세션 토큰이 만료됐을 수 있다 — 리셋 후 재인증을 한 번 시도해
    // "세션 끊김"이 곧바로 결제 실패로 번지지 않게 한다.
    if (!isSessionError(error)) throw error
    logPi('warn', 'stale session; re-authenticating', error)
    resetPiSession()
    const auth = await withTimeout(authenticatePi(pi), PI_AUTH_TIMEOUT_MS, 'Pi.authenticate retry')
    sessionUid = parsePiAuthResult(auth)?.uid ?? ''
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
    metadata: {
      // 수령인 지갑 주소를 결제 메타데이터에 실어 둔다 — Pi 포털 결제 상세와
      // 서버 장부·영수증에서 동일 수신지를 대조할 수 있다(호출부 재지정 가능).
      payeeWallet: PLATFORM_DEPOSIT_WALLET,
      ...(options.metadata ?? {}),
      ...(sessionUid ? { piUid: sessionUid } : {}),
    },
  }
  logPi('log', 'window.Pi.createPayment', payment)

  // 이전 결제가 미완료로 남아 있으면 새 결제의 승인이 막혀 지갑이 만료된다 —
  // createPayment 전에 미완료 건을 complete/cancel로 반드시 정리한다. 다만
  // 좀비 건의 복구가 지연돼도 새 결제 시작 자체가 멈추지 않게 상한을 둔다.
  await Promise.race([
    drainIncompletePayments(),
    new Promise((resolve) => window.setTimeout(resolve, 8_000)),
  ])

  // 지갑 시트를 열기 전에 서버의 Pi API 키 상태를 점검한다 — 키 거절(401)이나
  // 미설정이면 approve가 어차피 실패해 지갑이 '승인 프로세스 시간 초과'로
  // 만료되므로, 여기서 명확한 원인으로 즉시 중단한다. 헬스체크 호출 자체의
  // 실패(네트워크·구배포)는 판단 불가로 두고 결제를 진행한다.
  try {
    const health = (await piApiFetch('/api/pi/health', { signal: piTimeoutSignal(10_000) })
      .then((res) => res.json().catch(() => null))) as {
      ready?: boolean
      keyStatus?: string
    } | null
    if (health && health.ready === false) {
      const reason =
        health.keyStatus === 'rejected'
          ? 'Pi API 키가 Pi 서버에서 거절되었습니다(401/403).'
          : health.keyStatus === 'unreachable'
            ? '결제 서버가 Pi 서버에 연결되지 않습니다.'
            : '서버에 Pi API 키가 설정되어 있지 않습니다.'
      throw new Error(`Pi 결제 서버 설정에 문제가 있어 결제를 시작할 수 없습니다. ${reason} 관리자에게 문의해 주세요.`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('결제 서버 설정')) throw error
    logPi('warn', 'pi health check failed; proceeding anyway', error)
  }

  // 승인 타임아웃·만료 류 실패이고 아직 paymentId가 생성되지 않았다면
  // (체인 청구가 물리적으로 불가능한 단계) 세션 리셋 + 미완료 정리 후 1회 재시도.
  let lastError: unknown
  for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
    const attempt: { paymentId: string; txid: string } = { paymentId: '', txid: '' }
    try {
      return await runCreatePayment(pi, payment, options, attempt, sessionUid)
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
  sessionUid = '',
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
      // 시트가 열리는 경계 — 여기까지 로그가 있고 approval entry가 없으면
      // createPayment~콜백 사이(SDK·앱 등록·미완료 락)가 끊긴 것으로 확정된다.
      signalPi('createPayment invoked', { amount: payment.amount })
      pi.createPayment(payment, {
        onReadyForServerApproval: (paymentIdArg) => {
          // 첫 문장 — 파싱보다 먼저 발화해야 "콜백이 불렸다"가 서버에 입증된다.
          signalPi('approval callback entry', {
            argType: typeof paymentIdArg,
            argPreview: String(paymentIdArg).slice(0, 80),
          })
          // SDK 콜백 인자 형태가 달라도 누락되지 않도록 attempt 값으로 보강한다.
          const paymentId = readPaymentId(paymentIdArg) || attempt.paymentId
          // 문자열 인자는 paymentId뿐이다 — txid로 오인해 attempt에 심으면
          // 실패 복구가 /api/pi/complete에 paymentId를 txid로 보내 404를 낸다.
          // txid는 객체(PaymentDTO.transaction.txid)에서만 읽는다.
          const approvedTxid =
            typeof paymentIdArg === 'object' && paymentIdArg !== null ? txidFromPiPayload(paymentIdArg) : ''
          if (paymentId) attempt.paymentId = paymentId
          if (approvedTxid) attempt.txid = approvedTxid
          paymentInitiated = true
          logPi('log', 'onReadyForServerApproval', { paymentId, approvedTxid })
          tracePi('onReadyForServerApproval fired', { paymentId })
          if (!paymentId) {
            finishError('approve missing paymentId', paymentIdArg)
            return Promise.resolve()
          }
          // 지갑 시트가 뜨는 동안 페이지 fetch가 멈출 수 있어 beacon을 먼저 실어둔다.
          const approveBody = {
            paymentId,
            kind: checkoutKind(payment.metadata),
            sandbox: PI_SANDBOX,
            uid: sessionUid,
            appInstance: PI_APP_INSTANCE,
          }
          beaconPiApi('/api/pi/approve', approveBody)
          // REST형 대체 경로도 beacon으로 함께 실어둔다 — 기본 경로가 전혀
          // 도달하지 않는 환경에서도 승인 한 번은 서버에 닿게 한다(멱등).
          beaconPiApi(`/api/pi/payments/${encodeURIComponent(paymentId)}/approve`, approveBody)
          if (options.advanceOnApproval && approvedTxid) succeed({ paymentId, txid: approvedTxid })
          return postPiApiRetry('/api/pi/approve', approveBody)
            .then((payload) => {
              if (options.advanceOnApproval) {
                succeed({
                  paymentId,
                  txid: txidFromPiPayload(payload) || approvedTxid || `approved-${paymentId}`,
                  payee: payeeFromPiPayload(payload) || undefined,
                })
              }
              return payload
            })
            .catch(async (error) => {
              if (settled) return undefined
              // 기본 경로 실패 → REST형 승인 경로로 최종 시도. 둘 다 실패해야
              // 진짜 approve 실패로 표면화한다.
              try {
                const payload = await postPiApproveRest(paymentId, approveBody)
                if (options.advanceOnApproval) {
                  succeed({
                    paymentId,
                    txid: txidFromPiPayload(payload) || approvedTxid || `approved-${paymentId}`,
                    payee: payeeFromPiPayload(payload) || undefined,
                  })
                }
                return payload
              } catch {
                tracePi('approve request failed', { paymentId, error: errorText(error) })
                finishError('approve failed', error)
                return undefined
              }
            })
        },
        onReadyForServerCompletion: (paymentIdArg, txidArg) => {
          // 첫 문장 — 파싱 전 진입 신호.
          signalPi('completion callback entry', {
            argType: typeof paymentIdArg,
            txidType: typeof txidArg,
            argPreview: String(txidArg).slice(0, 80),
          })
          // 문자열 인자는 위치대로 paymentId/txid다 — txidArg 문자열을
          // paymentId로 역추출하거나 paymentIdArg 문자열을 txid로 쓰면
          // complete가 틀린 식별자로 Pi를 호출해 404가 떨어진다.
          const paymentId =
            readPaymentId(paymentIdArg) ||
            (typeof txidArg === 'object' && txidArg !== null ? readPaymentId(txidArg) : '') ||
            attempt.paymentId
          const txid =
            (typeof txidArg === 'string' ? txidArg.trim() : txidFromPiPayload(txidArg)) ||
            (typeof paymentIdArg === 'object' && paymentIdArg !== null ? txidFromPiPayload(paymentIdArg) : '') ||
            attempt.txid
          if (paymentId) attempt.paymentId = paymentId
          if (txid) attempt.txid = txid
          paymentInitiated = true
          logPi('log', 'onReadyForServerCompletion', { paymentId, txid })
          tracePi('onReadyForServerCompletion fired', { paymentId, txid })
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
          const completeBody = {
            paymentId,
            txid,
            amount: payment.amount,
            metadata: payment.metadata,
            kind: checkoutKind(payment.metadata),
            sandbox: PI_SANDBOX,
            uid: sessionUid,
            appInstance: PI_APP_INSTANCE,
          }
          beaconPiApi('/api/pi/complete', completeBody)
          return postPiApiRetry('/api/pi/complete', completeBody)
            .then((payload) => {
              // 서버가 검증한 수령인 주소(to_address)를 영수증까지 그대로 운반한다.
              succeed({ paymentId, txid, payee: payeeFromPiPayload(payload) || undefined })
            })
            .catch((error) => {
              if (settled) return undefined
              tracePi('complete request failed', { paymentId, txid, error: errorText(error) })
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
          signalPi('cancel callback entry', { argType: typeof paymentId })
          const id = readPaymentId(paymentId)
          if (id) attempt.paymentId = id
          paymentInitiated = true
          logPi('warn', 'onCancel', { paymentId })
          tracePi('onCancel fired', { paymentId: id })
          finishError('cancelled', new Error('결제가 취소되었습니다.'))
        },
        onError: (error, paymentInfo) => {
          signalPi('error callback entry', { error: errorText(error) })
          const paymentId = readPaymentId(paymentInfo)
          const txid = txidFromPiPayload(paymentInfo)
          if (paymentId) attempt.paymentId = paymentId
          if (txid) attempt.txid = txid
          logPi('error', 'onError', { error, paymentInfo, paymentId, txid })
          tracePi('onError fired', { paymentId, txid, error: errorText(error) })
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
  advanceOnApproval = true,
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
  /** true면 서버 승인 직후 버튼을 '결제 완료'로 놓는다 — 이용 종료 정산처럼
   *  완료(txid) 확정이 선행돼야 하는 흐름에서는 false로 넘긴다. */
  advanceOnApproval?: boolean
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
      void startPiCheckout({ amount, memo, metadata, advanceOnApproval, onSettled: deliver })
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
