import type { AppLocale } from '@/lib/i18n'
import { detectTextLang } from '@/lib/text-lang'

/**
 * 브라우저 Web Speech API(STT·TTS) 래퍼 — 앱 locale을 BCP-47 언어 태그로
 * 매핑해 음성 인식·음성 안내의 언어가 UI 언어와 항상 일치하게 한다.
 * 지원하지 않는 브라우저에서는 null/false를 돌려 UI가 대체 입력을 보여준다.
 */
export const SPEECH_LANGS: Record<AppLocale, string> = {
  ko: 'ko-KR',
  en: 'en-US',
  ja: 'ja-JP',
  zh: 'zh-CN',
}

type SpeechRecognitionAlternative = { transcript: string; confidence?: number }
type SpeechRecognitionResultLike = { isFinal: boolean; length: number; [index: number]: SpeechRecognitionAlternative }
type SpeechRecognitionEventLike = { resultIndex: number; results: { length: number; [index: number]: SpeechRecognitionResultLike } }
type SpeechRecognitionErrorLike = { error?: string; message?: string }

/** 브라우저 구현체별 생성자 차이를 흡수하는 최소 인터페이스. */
export interface SpeechRecognizer {
  start(): void
  stop(): void
  abort(): void
}

interface SpeechRecognitionLike extends SpeechRecognizer {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
}

type RecognitionCtor = new () => SpeechRecognitionLike

/**
 * 한 결과 슬롯의 후보(alternatives) 중 가장 그럴듯한 문구를 고른다.
 * 1순위: 글자 종류가 선택된 인식 언어와 일치(엔진이 다른 문자로 잡은 후보를 걸러냄),
 * 2순위: confidence. 후보가 없으면 첫 번째 transcript를 그대로 쓴다.
 */
function bestTranscript(result: SpeechRecognitionResultLike | undefined, locale: AppLocale) {
  if (!result) return ''
  let best = ''
  let bestScore = -1
  for (let i = 0; i < result.length; i += 1) {
    const alt = result[i]
    const text = (alt?.transcript ?? '').trim()
    if (!text) continue
    const confidence = typeof alt.confidence === 'number' ? alt.confidence : 0
    const scriptMatch = detectTextLang(text) === locale ? 1 : 0
    const score = scriptMatch * 2 + confidence
    if (score > bestScore) {
      bestScore = score
      best = text
    }
  }
  return best || (result[0]?.transcript ?? '').trim()
}

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isSpeechRecognitionSupported() {
  return recognitionCtor() !== null
}

export function isSpeechSynthesisSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function'
}

/**
 * 음성 인식 인스턴스를 만든다 — 미지원이면 null.
 * onResult는 중간/최종 결과를 모두 흘려보내며 isFinal로 구분한다.
 */
export function createSpeechRecognizer(options: {
  locale: AppLocale
  onResult: (text: string, isFinal: boolean) => void
  onError?: (error: string) => void
  onStart?: () => void
  onEnd?: () => void
}): SpeechRecognizer | null {
  const Ctor = recognitionCtor()
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = SPEECH_LANGS[options.locale] ?? SPEECH_LANGS.ko
  // continuous: 짧은 침묵마다 세션이 끊겨 문장 중간이 잘리는 문제를 막는다 —
  // 종료는 호출부가 stop()을 호출할 때까지 유지된다.
  rec.continuous = true
  rec.interimResults = true
  rec.maxAlternatives = 3
  rec.onstart = () => options.onStart?.()
  rec.onend = () => options.onEnd?.()
  rec.onerror = (event) => options.onError?.(event?.error || 'unknown')
  rec.onresult = (event) => {
    // continuous 모드에서는 results 전체가 누적 목록이므로 0부터 다시 합친다.
    // isFinal은 "마지막 발화 단위가 확정됐는지"만 알린다.
    let finals = ''
    let interim = ''
    let lastIsFinal = false
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i]
      const text = bestTranscript(result, options.locale)
      if (result?.isFinal) finals += `${text} `
      else interim += text
      lastIsFinal = Boolean(result?.isFinal)
    }
    const combined = `${finals}${interim}`.trim()
    if (combined) options.onResult(combined, lastIsFinal)
  }
  return rec
}

/** 음성 안내(TTS) — 짧은 안내 문구를 현재 앱 언어로 읽어 준다. */
export function speakText(text: string, locale: AppLocale, rate = 1) {
  const trimmed = text.trim()
  if (!isSpeechSynthesisSupported() || !trimmed) return false
  try {
    const utter = new window.SpeechSynthesisUtterance(trimmed)
    utter.lang = SPEECH_LANGS[locale] ?? SPEECH_LANGS.ko
    utter.rate = rate
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utter)
    return true
  } catch {
    return false
  }
}

/** 진행 중인 TTS 안내를 중단한다. */
export function stopSpeaking() {
  if (!isSpeechSynthesisSupported()) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    undefined
  }
}
