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
}

/**
 * 목적지 검색용 번역 — /api/translate(LibreTranslate→Papago 체인)로
 * 외국어 입력을 한국어 검색어로 바꾼다. 원본이 이미 한국어이거나
 * 번역기가 미설정·실패면 null을 돌려 호출부가 원문으로 검색하게 한다.
 */
export async function translateForSearch(text: string, target: ChatLang = 'ko'): Promise<TranslatedSearch | null> {
  const query = text.trim()
  if (!query) return null
  const source = detectTextLang(query)
  if (source === target) return null
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: query, source, target }),
      cache: 'no-store',
    })
    const payload = (await res.json().catch(() => null)) as {
      ok?: boolean
      translated?: string
      source?: string
    } | null
    const translated = typeof payload?.translated === 'string' ? payload.translated.trim() : ''
    if (!res.ok || payload?.ok !== true || !translated || translated === query) return null
    return { source, target, translated }
  } catch {
    return null
  }
}
