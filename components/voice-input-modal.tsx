'use client'

import { useEffect, useRef, useState } from 'react'
import { Languages, Mic, Square, X } from 'lucide-react'
import { useLocale } from '@/components/locale-provider'
import { APP_LOCALES, type AppLocale } from '@/lib/i18n'
import { createSpeechRecognizer, isSpeechRecognitionSupported, speakText, stopSpeaking, type SpeechRecognizer } from '@/lib/speech'
import { detectTextLang, translateForSearch } from '@/lib/text-lang'

type VoicePhase = 'idle' | 'listening' | 'translating' | 'done' | 'error' | 'unsupported'

// 최종 발화 후 이 시간만큼 새 결과가 없으면 자동으로 인식을 마무리한다.
const SILENCE_FINALIZE_MS = 2600
// 무입력 상태로 마이크가 계속 열려 있지 않도록 하는 세션 상한.
const SESSION_MAX_MS = 45000
// 엔진이 세션을 자체 종료했을 때 자동 재개 최대 횟수 — 무한 재시작 방지.
const MAX_AUTO_RESTARTS = 5

/**
 * 브라우저 Web Speech API 기반 음성 입력 시트.
 * - 열리면 선택된 인식 언어(기본: 앱 언어)로 인식을 자동 시작한다.
 *   한국어/English/日本語/中文 칩으로 말하는 언어를 바꿀 수 있다.
 * - continuous 모드로 짧은 침묵에 끊기지 않게 하고, 최종 발화 후
 *   SILENCE_FINALIZE_MS 동안 새 결과가 없으면 자동 마무리한다.
 *   엔진이 세션을 자체 종료하면 누적된 인식문을 보존한 채 자동 재개한다.
 * - 세션이 끝난 뒤 인식 결과가 한국어가 아니면 /api/translate로
 *   한국어 검색어를 만들어 원문과 함께 보여 주고, 확정 시 번역본이 넘어간다.
 * - 미지원·권한 거부·인식 실패 모두 인라인 안내로 수렴하고 크래시로 번지지 않는다.
 */
export default function VoiceInputModal({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const { locale, t } = useLocale()
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [transcript, setTranscript] = useState('')
  const [translated, setTranslated] = useState('')
  const [speechLang, setSpeechLang] = useState<AppLocale>(locale)
  const recognizerRef = useRef<SpeechRecognizer | null>(null)
  const sessionRef = useRef(0)
  // 같은 세션 안에서 인식기가 교체될 때 구형 인스턴스의 콜백이 신형을
  // 오염시키지 않도록 세대 번호로 구분한다.
  const generationRef = useRef(0)
  // wantListeningRef: 사용자가 듣기를 원하는 상태인지 — 엔진의 자체 onend와
  // 우리가 요청한 종료를 구분해 자동 재개 여부를 결정한다.
  const wantListeningRef = useRef(false)
  const restartsRef = useRef(0)
  const noSpeechRetriedRef = useRef(false)
  const transcriptRef = useRef('')
  const silenceTimerRef = useRef(0)
  const sessionTimerRef = useRef(0)

  const clearTimers = () => {
    window.clearTimeout(silenceTimerRef.current)
    window.clearTimeout(sessionTimerRef.current)
  }

  const stopActive = () => {
    try {
      recognizerRef.current?.stop()
    } catch {
      /* 이미 종료된 인식기 — 무시 */
    }
  }

  const abortActive = () => {
    try {
      recognizerRef.current?.abort()
    } catch {
      /* 이미 종료된 인식기 — 무시 */
    }
  }

  // 인식 세션이 끝났을 때 마무리 — 한국어가 아니면 검색용 번역을 붙인다.
  const finishSession = (session: number, lang: AppLocale) => {
    const text = transcriptRef.current.trim()
    if (!text) {
      setPhase('done')
      return
    }
    if (detectTextLang(text) === 'ko') {
      setTranslated('')
      setPhase('done')
      speakText(text, 'ko')
      return
    }
    setPhase('translating')
    void translateForSearch(text, 'ko')
      .then((result) => {
        if (session !== sessionRef.current) return
        if (result?.translated) setTranslated(result.translated)
        setPhase('done')
        // 이용자에게는 원문을 선택한 인식 언어로 읽어 주고, 검색에는 번역본이 넘어간다.
        speakText(text, lang)
      })
      .catch(() => {
        if (session !== sessionRef.current) return
        setPhase('done')
      })
  }

  /** 인식기 하나를 만들어 세션에 연결한다 — 최초 시작·자동 재개·no-speech 재시도가 공용. */
  const beginRecognizer = (session: number, lang: AppLocale) => {
    const gen = ++generationRef.current
    const prev = recognizerRef.current
    recognizerRef.current = null
    try {
      prev?.abort()
    } catch {
      /* 이미 종료된 인식기 — 무시 */
    }
    const stale = () => session !== sessionRef.current || gen !== generationRef.current
    const recognizer = createSpeechRecognizer({
      locale: lang,
      onResult: (text, isFinal) => {
        if (stale()) return
        transcriptRef.current = text
        setTranscript(text)
        // 발화가 확정되면 침묵 타이머를 건다 — 이후 새 음성이 없으면 자동 마무리.
        if (isFinal) {
          window.clearTimeout(silenceTimerRef.current)
          silenceTimerRef.current = window.setTimeout(() => {
            if (stale()) return
            wantListeningRef.current = false
            stopActive()
          }, SILENCE_FINALIZE_MS)
        }
      },
      onError: (code) => {
        if (stale() || code === 'aborted') return
        // 마이크는 열렸는데 음성이 없었던 경우 — 한 번은 조용히 다시 듣는다.
        if (code === 'no-speech' && !noSpeechRetriedRef.current && wantListeningRef.current) {
          noSpeechRetriedRef.current = true
          beginRecognizer(session, lang)
          return
        }
        wantListeningRef.current = false
        setPhase(code === 'not-allowed' || code === 'service-not-allowed' ? 'unsupported' : 'error')
      },
      onEnd: () => {
        if (stale()) return
        // 엔진이 자체적으로 세션을 닫은 경우(Android Chrome 등) — 사용자가
        // 아직 듣기를 원하면 누적 인식문을 보존한 채 자동으로 재개한다.
        if (wantListeningRef.current && restartsRef.current < MAX_AUTO_RESTARTS) {
          restartsRef.current += 1
          beginRecognizer(session, lang)
          return
        }
        wantListeningRef.current = false
        finishSession(session, lang)
      },
    })
    recognizerRef.current = recognizer
    if (!recognizer) {
      wantListeningRef.current = false
      setPhase('unsupported')
      return
    }
    try {
      recognizer.start()
    } catch {
      // 시작 직후 오류 — 사용자가 재시도 버튼으로 다시 열 수 있게 error로 수렴.
      wantListeningRef.current = false
      setPhase('error')
    }
  }

  const start = () => {
    if (!isSpeechRecognitionSupported()) {
      setPhase('unsupported')
      // STT를 쓸 수 없을 때도 TTS 안내는 제공해 음성 지원 경험을 유지한다.
      speakText(t('voice.unsupported'), locale)
      return
    }
    // 구형 콜백이 abort에 반응해 finishSession을 돌리지 않도록 세션·세대를 먼저 무효화한다.
    const session = ++sessionRef.current
    generationRef.current += 1
    wantListeningRef.current = false
    abortActive()
    clearTimers()
    wantListeningRef.current = true
    restartsRef.current = 0
    noSpeechRetriedRef.current = false
    transcriptRef.current = ''
    setTranscript('')
    setTranslated('')
    setPhase('listening')
    beginRecognizer(session, speechLang)
    // 세션 상한 — 무음 상태로 마이크가 영구히 열리지 않게 한다.
    sessionTimerRef.current = window.setTimeout(() => {
      if (session !== sessionRef.current) return
      wantListeningRef.current = false
      stopActive()
    }, SESSION_MAX_MS)
  }

  // 열리자마자 바로 듣기 시작 — 별도 탭 없이 말할 수 있게 한다.
  useEffect(() => {
    start()
    return () => {
      sessionRef.current += 1
      wantListeningRef.current = false
      clearTimers()
      abortActive()
      recognizerRef.current = null
      stopSpeaking()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speechLang])

  const stopListening = () => {
    // stop()은 최종 결과를 비운 뒤 onEnd를 발생시켜 마무리 번역으로 이어진다.
    wantListeningRef.current = false
    stopActive()
  }

  const close = () => {
    sessionRef.current += 1
    wantListeningRef.current = false
    clearTimers()
    abortActive()
    recognizerRef.current = null
    stopSpeaking()
    onClose()
  }
  const confirm = () => {
    // 검색에는 번역본을 넘긴다 — 번역이 없으면 원문 그대로.
    const text = (translated || transcript).trim()
    if (!text) return
    onResult(text)
    close()
  }

  const status =
    phase === 'listening'
      ? transcript || t('voice.listening')
      : phase === 'translating'
        ? t('voice.translating')
        : phase === 'unsupported'
          ? t('voice.unsupported')
          : phase === 'error'
            ? t('voice.failed')
            : transcript
              ? transcript
              : t('voice.tap')

  return (
    <div className="fixed inset-0 z-[145] flex items-end justify-center bg-[#0F172A]/45 sm:items-center" onClick={close}>
      <section
        className="w-full max-w-md rounded-t-[28px] bg-white px-5 pb-7 pt-4 shadow-2xl sm:rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-input-title"
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[#E2E8F0]" />
        <div className="flex items-center justify-between gap-2">
          <h3 id="voice-input-title" className="text-lg font-black text-[#0F172A]">
            {t('voice.title')}
          </h3>
          <button type="button" onClick={close} aria-label={t('settings.close')} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F1F5F9] text-[#64748B]">
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* 말하는 언어 — Web Speech API는 인식기당 한 언어만 인식하므로 선택지를 둔다 */}
        <div className="mt-3 flex items-center gap-1.5">
          <Languages className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" />
          <span className="mr-0.5 text-[11px] font-black text-[#64748B]">{t('voice.langLabel')}</span>
          {APP_LOCALES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSpeechLang(item.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-black transition active:scale-95 ${
                speechLang === item.id ? 'bg-[#4A82B8] text-white' : 'bg-[#F1F5F9] text-[#64748B]'
              }`}
            >
              {item.nativeName}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-col items-center">
          <button
            type="button"
            onClick={phase === 'listening' ? stopListening : start}
            aria-label={phase === 'listening' ? t('voice.stop') : t('voice.tap')}
            className={`flex h-20 w-20 items-center justify-center rounded-full text-white shadow-[0_12px_24px_rgba(74,130,184,0.35)] transition active:scale-95 ${
              phase === 'listening' ? 'animate-pulse bg-[#4A82B8]' : 'bg-[#4A82B8] hover:bg-[#3F74A8]'
            }`}
          >
            {phase === 'listening' ? <Square className="h-7 w-7" /> : <Mic className="h-9 w-9" />}
          </button>
          <p aria-live="polite" className={`mt-4 min-h-10 w-full text-center text-sm font-bold leading-5 ${phase === 'error' || phase === 'unsupported' ? 'text-[#B45309]' : 'text-[#0F172A]'}`}>
            {status}
          </p>
          {translated ? (
            <p className="mt-1 w-full rounded-xl bg-[#E8F1FA] px-3 py-2 text-center text-[12px] font-black text-[#3F74A8]">
              {t('voice.translatedSearch', { q: translated })}
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={start}
            disabled={phase === 'unsupported'}
            className="flex-1 rounded-2xl border-2 border-[#CBD5E1] bg-white py-3 text-sm font-black text-[#334155] transition active:scale-[0.99] disabled:opacity-40"
          >
            {t('voice.retry')}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!transcript.trim() || phase === 'translating'}
            className="flex-1 rounded-2xl bg-[#4A82B8] py-3 text-sm font-black text-white transition hover:bg-[#3F74A8] active:scale-[0.99] disabled:opacity-40"
          >
            {t('voice.useText')}
          </button>
        </div>
      </section>
    </div>
  )
}
