import { resolveNetworkMode, type PiNetworkMode } from '@/lib/pi-sandbox'

/**
 * Upstash/Vercel KV REST 공용 헬퍼 — 장부 스토어들이 각자 복제하던
 * kvCommand를 한곳으로 모았다. 요청마다 8초 타임아웃과 1회 재시도를 두어
 * 일시적 REST 장애가 읽기/쓰기를 통째로 죽이지 않게 한다.
 *
 * 네트워크 분리 모델 (테스트넷 ↔ 메인넷):
 * - 데이터 스코프는 배포 env가 결정한다 — NEXT_PUBLIC_PI_SANDBOX 등이
 *   클라이언트 SDK 번들에도 박혀 있으므로 env가 곧 그 배포의 네트워크다.
 *   요청 Host 힌트는 Pi API 승인 판정 전용이며 장부 스코프는 건드리지 않는다.
 * - TAXITAGO_DATA_SCOPE(또는 PI_DATA_SCOPE)='testnet'|'mainnet'으로
 *   장부 네임스페이스를 명시 고정할 수 있다.
 * - 테스트넷 스코프는 기존 'taxitago:*' 키를 그대로 쓴다(누적 데이터 보존).
 *   메인넷 스코프는 'taxitago:main:*' 네임스페이스 — env 전환 즉시 장부가
 *   완전히 새로 시작되어 테스트넷 장부와 절대 섞이지 않는다.
 * - KV_REST_API_URL_TESTNET/KV_REST_API_TOKEN_TESTNET,
 *   KV_REST_API_URL_MAINNET/KV_REST_API_TOKEN_MAINNET이 설정되면
 *   네트워크별 전용 KV(물리적 분리)를 쓰고, 없으면 공용 KV를 쓴다.
 */

/** 장부 데이터가 속한 네트워크 — TAXITAGO_DATA_SCOPE env → Pi 네트워크 env 순 */
export function dataNetwork(): PiNetworkMode {
  const explicit = (process.env.TAXITAGO_DATA_SCOPE || process.env.PI_DATA_SCOPE || '').trim().toLowerCase()
  if (explicit === 'mainnet' || explicit === 'testnet') return explicit
  return resolveNetworkMode()
}

/**
 * 네트워크 분리 KV 키. 테스트넷은 기존 키(=기존 데이터)를 유지하고
 * 메인넷만 'taxitago:main:*'로 분리한다. 운영 데이터 스토어(기기·계정·
 * 관리자 설정 등)는 이 함수를 쓰지 않고 전역 키를 유지한다.
 */
export function netKey(key: string): string {
  if (dataNetwork() !== 'mainnet') return key
  const body = key.startsWith('taxitago:') ? key.slice('taxitago:'.length) : key
  return `taxitago:main:${body}`
}

/** 파일 폴백 경로도 같은 스코프로 분리 — 메인넷이면 data/x.mainnet.json */
export function netFilePath(filePath: string): string {
  if (dataNetwork() !== 'mainnet') return filePath
  return filePath.replace(/\.json$/i, '.mainnet.json')
}

/** 현재 네트워크가 쓸 KV 엔드포인트 — 전용 env 우선, 없으면 공용 env 폴백 */
function kvEndpoint(): { url: string; token: string } {
  const suffix = dataNetwork() === 'mainnet' ? 'MAINNET' : 'TESTNET'
  const url = (
    process.env[`KV_REST_API_URL_${suffix}`] ||
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    ''
  ).trim().replace(/\/+$/, '')
  const token = (
    process.env[`KV_REST_API_TOKEN_${suffix}`] ||
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    ''
  ).trim()
  return { url, token }
}

export const kvConfigured = (() => {
  const endpoint = kvEndpoint()
  return Boolean(endpoint.url && endpoint.token)
})()

export async function kvCommand<T>(command: (string | number)[]): Promise<T | null> {
  const { url, token } = kvEndpoint()
  if (!url || !token) throw new Error('kv endpoint not configured')
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        cache: 'no-store',
        signal: AbortSignal.timeout(8_000),
      })
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200)
        throw new Error(`kv request failed: ${res.status} ${detail}`)
      }
      const data = (await res.json()) as { result?: T | null }
      return data.result ?? null
    } catch (error) {
      lastError = error
      if (attempt === 0) {
        console.warn('[kv] request failed; retrying once', {
          command: String(command[0]),
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  throw lastError
}

/** SET key 1 NX PX ttl — 송금/출금 멱등 클레임 전용. 성공 시에만 true. */
export async function kvSetNx(key: string, ttlMs: number): Promise<boolean> {
  const { url, token } = kvEndpoint()
  if (!url || !token) return false
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', key, '1', 'NX', 'PX', ttlMs]),
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null)
  if (!res || !res.ok) return false
  const data = (await res.json().catch(() => ({}))) as { result?: string | null }
  return data.result === 'OK'
}
