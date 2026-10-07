/**
 * Upstash/Vercel KV REST 공용 헬퍼 — 장부 스토어들이 각자 복제하던
 * kvCommand를 한곳으로 모았다. 요청마다 8초 타임아웃과 1회 재시도를 두어
 * 일시적 REST 장애가 읽기/쓰기를 통째로 죽이지 않게 한다.
 */
const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()

export const kvConfigured = Boolean(kvUrl && kvToken)

export async function kvCommand<T>(command: (string | number)[]): Promise<T | null> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(kvUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
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
