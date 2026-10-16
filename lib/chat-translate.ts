import { resolveNaverRestCredentials, resolveNaverSearchCredentials } from '@/lib/naver-apigw'
import { detectTextLang } from '@/lib/text-lang'
import type { ChatLang } from '@/lib/comms-types'

const CHAT_LANGS: ChatLang[] = ['ko', 'en', 'ja', 'zh']

export function isChatLang(value: string | null | undefined): value is ChatLang {
  return CHAT_LANGS.includes(value as ChatLang)
}

/**
 * 채팅 메시지의 언어를 글자 종류로 추정한다 — 감지 규칙의 단일 소스는
 * 클라이언트도 쓸 수 있는 lib/text-lang.ts다.
 */
export const detectChatLang = detectTextLang

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
const PROVIDER_NAMES = ['libre', 'papago-ncp', 'papago-open'] as const

/** env 기준으로 사용 가능한 번역 provider 이름 목록 — 번역 누락 원인 진단용. */
export function translateProvidersConfigured(): string[] {
  const configured: string[] = []
  if (/^https?:\/\//i.test((process.env.TRANSLATE_API_URL || '').trim())) configured.push('libre')
  const ncp = resolveNaverRestCredentials()
  if (ncp.keyId && ncp.secret) configured.push('papago-ncp')
  const search = resolveNaverSearchCredentials()
  if ((process.env.PAPAGO_CLIENT_ID || '').trim() || search.keyId) configured.push('papago-open')
  return configured
}

// 동일 문장의 반복 번호를 막는 프로세스 내 소형 캐시.
const cache = new Map<string, { translated: string; provider: string }>()
const cacheKey = (text: string, source: ChatLang, target: ChatLang) => `${source}:${target}:${text}`

/**
 * provider 체인을 순회하며 번역하고, 성공한 provider 이름까지 돌려준다.
 * 각 provider의 실패는 로그로 남겨 번역 누락 원인을 배포 환경에서 바로 볼 수 있다.
 */
export async function translateChatTextVerbose(
  text: string,
  source: ChatLang,
  target: ChatLang,
): Promise<{ translated: string; provider: string } | null> {
  if (source === target) return null
  const key = cacheKey(text, source, target)
  const hit = cache.get(key)
  if (hit) return hit
  const configured = translateProvidersConfigured()
  if (configured.length === 0) {
    console.warn('[translate] no provider configured — set TRANSLATE_API_URL or Papago/NCP env')
    return null
  }
  for (let i = 0; i < PROVIDERS.length; i += 1) {
    const name = PROVIDER_NAMES[i]
    if (!configured.includes(name)) continue
    try {
      const translated = await PROVIDERS[i](text, source, target)
      if (translated && translated !== text) {
        if (cache.size > 500) cache.clear()
        cache.set(key, { translated, provider: name })
        return { translated, provider: name }
      }
      console.warn('[translate] provider returned empty/same', { provider: name, source, target })
    } catch (error) {
      console.warn('[translate] provider failed', { provider: name, source, target, error })
    }
  }
  console.warn('[translate] all providers failed', { source, target, configured })
  return null
}

export async function translateChatText(text: string, source: ChatLang, target: ChatLang): Promise<string | null> {
  return (await translateChatTextVerbose(text, source, target))?.translated ?? null
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
