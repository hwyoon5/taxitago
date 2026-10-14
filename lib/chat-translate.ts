import { resolveNaverRestCredentials, resolveNaverSearchCredentials } from '@/lib/naver-apigw'
import type { ChatLang } from '@/lib/comms-types'

const CHAT_LANGS: ChatLang[] = ['ko', 'en', 'ja', 'zh']

export function isChatLang(value: string | null | undefined): value is ChatLang {
  return CHAT_LANGS.includes(value as ChatLang)
}

/**
 * 채팅 메시지의 언어를 글자 종류로 추정한다.
 * 한글 → ko, 가나(히라가나/가타카나) → ja, 한자 → zh, 그 외 → en.
 */
export function detectChatLang(text: string): ChatLang {
  if (/[가-힯ㄱ-ㅎㅏ-ㅣ]/.test(text)) return 'ko'
  if (/[぀-ヿ]/.test(text)) return 'ja'
  if (/[㐀-鿿豈-﫿]/.test(text)) return 'zh'
  return 'en'
}

const PAPAGO_TARGET: Record<ChatLang, string> = { ko: 'ko', en: 'en', ja: 'ja', zh: 'zh-CN' }

type TranslateProvider = (text: string, source: ChatLang, target: ChatLang) => Promise<string | null>

/** LibreTranslate 호환 자체/외부 엔드포인트 — TRANSLATE_API_URL(+TRANSLATE_API_KEY) 지정 시 최우선 사용. */
const libreProvider: TranslateProvider = async (text, source, target) => {
  const endpoint = (process.env.TRANSLATE_API_URL || '').trim()
  if (!endpoint || !/^https?:\/\//i.test(endpoint)) return null
  const apiKey = (process.env.TRANSLATE_API_KEY || '').trim()
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source, target, format: 'text', ...(apiKey ? { api_key: apiKey } : {}) }),
    cache: 'no-store',
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as { translatedText?: string } | null
  return data?.translatedText?.trim() || null
}

/** NCP API Gateway Papago NMT — 지도용 NCP 키에 Papago가 활성화되어 있으면 그대로 동작한다. */
const papagoNcpProvider: TranslateProvider = async (text, source, target) => {
  const { keyId, secret } = resolveNaverRestCredentials()
  if (!keyId || !secret) return null
  const res = await fetch('https://naveropenapi.apigw.ntruss.com/nmt/v1/translation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-NCP-APIGW-API-KEY-ID': keyId,
      'X-NCP-APIGW-API-KEY': secret,
    },
    body: new URLSearchParams({ source: PAPAGO_TARGET[source], target: PAPAGO_TARGET[target], text }).toString(),
    cache: 'no-store',
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as { message?: { result?: { translatedText?: string } } } | null
  return data?.message?.result?.translatedText?.trim() || null
}

/** 구형 Papago(openapi.naver.com) — PAPAGO_CLIENT_ID/SECRET 또는 네이버 오픈API 검색 키 사용. */
const papagoOpenProvider: TranslateProvider = async (text, source, target) => {
  const search = resolveNaverSearchCredentials()
  const keyId = (process.env.PAPAGO_CLIENT_ID || '').trim() || search.keyId
  const secret = (process.env.PAPAGO_CLIENT_SECRET || '').trim() || search.secret
  if (!keyId || !secret) return null
  const res = await fetch('https://openapi.naver.com/v1/papago/n2mt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Naver-Client-Id': keyId,
      'X-Naver-Client-Secret': secret,
    },
    body: new URLSearchParams({ source: PAPAGO_TARGET[source], target: PAPAGO_TARGET[target], text }).toString(),
    cache: 'no-store',
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as { message?: { result?: { translatedText?: string } } } | null
  return data?.message?.result?.translatedText?.trim() || null
}

const PROVIDERS: TranslateProvider[] = [libreProvider, papagoNcpProvider, papagoOpenProvider]

// 동일 문장의 반복 번호를 막는 프로세스 내 소형 캐시.
const cache = new Map<string, string>()
const cacheKey = (text: string, source: ChatLang, target: ChatLang) => `${source}:${target}:${text}`

export async function translateChatText(text: string, source: ChatLang, target: ChatLang): Promise<string | null> {
  if (source === target) return null
  const key = cacheKey(text, source, target)
  const hit = cache.get(key)
  if (hit) return hit
  for (const provider of PROVIDERS) {
    try {
      const translated = await provider(text, source, target)
      if (translated && translated !== text) {
        if (cache.size > 500) cache.clear()
        cache.set(key, translated)
        return translated
      }
    } catch {
      continue
    }
  }
  return null
}

/**
 * 메시지를 나머지 3개 언어로 미리 번역한다.
 * 번역기가 설정/응답되지 않으면 해당 언어는 비워 두고 원문만 보인다.
 */
export async function translateChatAll(text: string): Promise<{ sourceLang: ChatLang; translations: Partial<Record<ChatLang, string>> }> {
  const sourceLang = detectChatLang(text)
  const entries = await Promise.all(
    CHAT_LANGS.filter((lang) => lang !== sourceLang).map(
      async (lang) => [lang, await translateChatText(text, sourceLang, lang)] as const,
    ),
  )
  const translations: Partial<Record<ChatLang, string>> = {}
  for (const [lang, value] of entries) {
    if (value) translations[lang] = value
  }
  return { sourceLang, translations }
}
