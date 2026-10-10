import { piRound } from '@/lib/pi-format'

/**
 * 호스트가 명백히 테스트넷 전용 환경이면 true, 판단 불가면 null.
 * true가 나오면 env가 메인넷이어도 sandbox로 강제한다 — 메인넷 심사 env가
 * 테스트 도메인에 붙었을 때 라이브 키·메인넷 Horizon이 섞이는 것을 막는다.
 * (클라이언트/서버 공용 — window.location.hostname 또는 Host 헤더를 넘긴다.)
 */
export function piHostSuggestsSandbox(host: string | null | undefined): boolean | null {
  const value = (host || '').trim().toLowerCase().split(':')[0]
  if (!value) return null
  if (value === 'test.taxitago.co.kr' || value.startsWith('test.')) return true
  if (value === 'localhost' || value === '127.0.0.1' || value === '::1' || value.endsWith('.local')) return true
  if (value.endsWith('.vercel.app') || value.endsWith('.v0.app') || value.endsWith('.piappengine.com')) return true
  return null
}

/** env 문자열 → boolean. 인식 불가 값은 null로 돌려 안전 기본값 경로를 태운다. */
function parseSandboxFlag(raw: string | undefined | null): boolean | null {
  const value = (raw ?? '').trim().toLowerCase()
  if (!value) return null
  if (value === 'false' || value === '0' || value === 'mainnet') return false
  if (value === 'true' || value === '1' || value === 'testnet' || value === 'sandbox') return true
  return null
}

/**
 * Pi 네트워크 결정 — 우선순위:
 * 1) hint: 클라이언트 SDK가 실제로 init한 sandbox 값(결제가 생성된 네트워크)
 * 2) host: 테스트넷 전용 도메인이면 env 무관 강제 testnet
 * 3) env: NEXT_PUBLIC_PI_SANDBOX → NEXT_PUBLIC_NETWORK_MODE → PI_SANDBOX → PI_NETWORK_MODE
 *    ('testnet'/'mainnet' 문자열도 인식 — NEXT_PUBLIC_NETWORK_MODE=mainnet으로 전환 가능)
 * 4) Vercel preview/development 배포는 testnet
 * 5) 기본값 true — 이 앱은 테스트넷 기본 운영
 */
export function resolvePiSandbox(opts?: { hint?: boolean | null; host?: string | null }): boolean {
  if (typeof opts?.hint === 'boolean') return opts.hint
  if (piHostSuggestsSandbox(opts?.host) === true) return true
  const env =
    parseSandboxFlag(process.env.NEXT_PUBLIC_PI_SANDBOX) ??
    parseSandboxFlag(process.env.NEXT_PUBLIC_NETWORK_MODE) ??
    parseSandboxFlag(process.env.PI_SANDBOX) ??
    parseSandboxFlag(process.env.PI_NETWORK_MODE)
  if (env !== null) return env
  const vercelEnv = (process.env.VERCEL_ENV || '').trim().toLowerCase()
  if (vercelEnv === 'preview' || vercelEnv === 'development') return true
  return true
}

export function isPiSandboxEnv() {
  return resolvePiSandbox()
}

export type PiNetworkMode = 'testnet' | 'mainnet'

/**
 * resolvePiSandbox의 타입화된 래퍼 — 'testnet' | 'mainnet'.
 * host/hint 우선순위는 resolvePiSandbox와 동일하다(테스트 도메인 강제 testnet 유지).
 */
export function resolveNetworkMode(opts?: { hint?: boolean | null; host?: string | null }): PiNetworkMode {
  return resolvePiSandbox(opts) ? 'testnet' : 'mainnet'
}

/** 요청 Host까지 반영한 서버측 판정 — host가 테스트 전용이면 env보다 우선한다. */
export function isPiSandboxRequest(request: Request | null | undefined, hint?: boolean | null) {
  const host = request?.headers.get('x-forwarded-host') ?? request?.headers.get('host')
  return resolvePiSandbox({ hint, host })
}

export function parseChargeAmount(value: unknown) {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  const rounded = piRound(amount)
  if (!Number.isFinite(rounded) || rounded <= 0 || rounded > 10_000) return null
  return rounded
}
