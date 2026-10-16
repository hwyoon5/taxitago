'use client'

import { useEffect, useRef, useState } from 'react'
import { Languages, Mic, X } from 'lucide-react'
import { useLocale } from '@/components/locale-provider'
import { APP_LOCALES, type AppLocale } from '@/lib/i18n'
import { createSpeechRecognizer, isSpeechRecognitionSupported, speakText, stopSpeaking, type SpeechRecognizer } from '@/lib/speech'
import { detectTextLang, translateForSearch } from '@/lib/text-lang'

type VoicePhase = 'idle' | 'listening' | 'translating' | 'done' | 'error' | 'unsupported'

/**
 * 브라우저 Web Speech API 기반 음성 입력 시트.
 * - 열리면 선택된 인식 언어(기본: 앱 언어)로 인식을 자동 시작한다.
 *   한국어/English/日本語/中文 칩으로 말하는 언어를 바꿀 수 있다.
 * - 인식 결과가 한국어가 아니면 /api/translate로 한국어 검색어를 만들어
 *   원문과 함께 보여 주고, 확정 시 번역본이 검색어로 넘어간다.
 * - 미지원·권한 거부·인식 실패 모두 인라인 안내로 수렴하고 크래시로 번지지 않는다.
 */
export default function VoiceInputModal({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const { locale, t } = useLocale()
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [transcript, setTranscript] = useState('')
  const [translated, setTranslated] = useState('')
  const [speechLang, setSpeechLang] = useState<AppLocale>(locale)
  const recognizerRef = useRef<SpeechRecognizer | null>(null)
  const translateSeq = useRef(0)

  const start = () => {
    if (!isSpeechRecognitionSupported()) {
      setPhase('unsupported')
      // STT를 쓸 수 없을 때도 TTS 안내는 제공해 음성 지원 경험을 유지한다.
      speakText(t('voice.unsupported'), locale)
      return
    }
    recognizerRef.current?.abort()
    setTranscript('')
    setTranslated('')
    setPhase('listening')
    const recognizer = createSpeechRecognizer({
      locale: speechLang,
      onResult: (text, isFinal) => {
        setTranscript(text)
        if (!isFinal) return
        // 인식 결과가 한국어가 아니면 검색용 한국어로 번역해 함께 보여 준다.
        if (detectTextLang(text) === 'ko') {
          setTranslated('')
          setPhase('done')
          speakText(text, 'ko')
          return
        }
        setPhase('translating')
        const seq = ++translateSeq.current
        void translateForSearch(text, 'ko')
          .then((result) => {
            if (seq !== translateSeq.current) return
            if (result?.translated) {
              setTranslated(result.translated)
              // 이용자에게는 번역본을 앱 언어 발음 대신 원문 언어로 읽어 주고,
              // 검색에는 번역본이 넘어간다.
              speakText(text, speechLang)
            }
            setPhase('done')
          })
          .catch(() => {
            if (seq !== translateSeq.current) return
            setPhase('done')
          })
      },
      onError: (code) => setPhase(code === 'not-allowed' || code === 'service-not-allowed' ? 'unsupported' : 'error'),
      onEnd: () => {
        setPhase((prev) => (prev === 'listening' ? 'done' : prev))
      },
    })
    recognizerRef.current = recognizer
    if (!recognizer) {
      setPhase('unsupported')
      return
    }
    try {
      recognizer.start()
    } catch {
      setPhase('error')
    }
  }

  // 열리자마자 바로 듣기 시작 — 별도 탭 없이 말할 수 있게 한다.
  useEffect(() => {
    start()
    return () => {
      recognizerRef.current?.abort()
      recognizerRef.current = null
      stopSpeaking()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speechLang])

  const close = () => {
    recognizerRef.current?.abort()
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
      ? t('voice.listening')
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
            onClick={start}
            aria-label={t('voice.tap')}
            className={`flex h-20 w-20 items-center justify-center rounded-full text-white shadow-[0_12px_24px_rgba(74,130,184,0.35)] transition active:scale-95 ${
              phase === 'listening' ? 'animate-pulse bg-[#4A82B8]' : 'bg-[#4A82B8] hover:bg-[#3F74A8]'
            }`}
          >
            <Mic className="h-9 w-9" />
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
