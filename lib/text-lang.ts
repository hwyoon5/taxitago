import type { ChatLang } from '@/lib/comms-types'

/**
 * 클라이언트·서버 공용 — 입력 텍스트의 언어를 글자 종류로 추정한다.
 * 한글 → ko, 가나(히라가나/가타카나) → ja, 한자 → zh, 그 외 → en.
 * 목적지 검색처럼 외국어 입력을 한국어 검색어로 변환할 때 원본 언어 판정에 쓴다.
 */
export function detectTextLang(text: string): ChatLang {
  if (/[가-힯ㄱ-ㅎㅏ-ㅣ]/.test(text)) return 'ko'
  if (/[぀-ヿ]/.test(text)) return 'ja'
  if (/[㐀-鿿豈-﫿]/.test(text)) return 'zh'
  return 'en'
}

export type TranslatedSearch = {
  source: ChatLang
  target: ChatLang
  translated: string
  provider?: string
}

// 동일 문장의 중복 번역 호출을 막는 소형 캐시(검색창 타이핑마다 provider를
// 두드리지 않도록) + 진행 중인 동일 요청의 중복 제거.
const clientCache = new Map<string, TranslatedSearch | null>()
const inFlight = new Map<string, Promise<TranslatedSearch | null>>()

/**
 * 목적지 검색용 번역 — /api/translate(LibreTranslate→Papago 체인)로
 * 외국어 입력을 한국어 검색어로 바꾼다. 원본이 이미 한국어이거나
 * 번역기가 미설정·실패면 null을 돌려 호출부가 원문으로 검색하게 한다.
 * 누락 원인(provider 미설정/모두 실패/요청 실패)은 console에 남겨
 * 배포 환경에서 바로 진단할 수 있게 한다.
 */
export function translateForSearch(text: string, target: ChatLang = 'ko'): Promise<TranslatedSearch | null> {
  const query = text.trim()
  if (!query) return Promise.resolve(null)
  const source = detectTextLang(query)
  if (source === target) return Promise.resolve(null)
  const key = `${source}:${target}:${query}`
  if (clientCache.has(key)) return Promise.resolve(clientCache.get(key) ?? null)
  const pending = inFlight.get(key)
  if (pending) return pending
  const request = (async (): Promise<TranslatedSearch | null> => {
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: query, source, target }),
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      })
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean
        translated?: string
        source?: string
        provider?: string | null
        configured?: string[]
      } | null
      const translated = typeof payload?.translated === 'string' ? payload.translated.trim() : ''
      if (!res.ok || payload?.ok !== true) {
        console.warn('[translate] request failed', { status: res.status, query })
        return null
      }
      if (!translated || translated === query) {
        // provider가 하나도 설정되지 않았거나 전부 실패해 원문이 그대로 온 경우.
        console.warn('[translate] no translation applied', {
          query,
          provider: payload?.provider ?? null,
          configured: payload?.configured ?? [],
        })
        return null
      }
      return { source, target, translated, provider: payload?.provider ?? undefined }
    } catch (error) {
      console.warn('[translate] fetch error', error)
      return null
    }
  })()
  inFlight.set(key, request)
  void request.then((value) => {
    inFlight.delete(key)
    // 성공 결과만 캐시 — provider 일시 장애 시 다음 입력에서 재시도할 수 있게 한다.
    if (!value) return
    if (clientCache.size > 200) clientCache.clear()
    clientCache.set(key, value)
  })
  return request
}
