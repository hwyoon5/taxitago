'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, X } from 'lucide-react'
import { useLocale } from '@/components/locale-provider'
import { createSpeechRecognizer, isSpeechRecognitionSupported, type SpeechRecognizer } from '@/lib/speech'

type VoicePhase = 'idle' | 'listening' | 'done' | 'error' | 'unsupported'

/**
 * 브라우저 Web Speech API 기반 음성 입력 시트.
 * - 열리면 현재 앱 언어(ko-KR/en-US/ja-JP/zh-CN)로 인식을 자동 시작한다.
 * - 인식된 텍스트는 onResult로 넘긴다(호출부에서 검색어 등으로 활용).
 * - 미지원·권한 거부·인식 실패 모두 인라인 안내로 수렴하고 크래시로 번지지 않는다.
 */
export default function VoiceInputModal({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const { locale, t } = useLocale()
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [transcript, setTranscript] = useState('')
  const recognizerRef = useRef<SpeechRecognizer | null>(null)

  const start = () => {
    if (!isSpeechRecognitionSupported()) {
      setPhase('unsupported')
      return
    }
    recognizerRef.current?.abort()
    setTranscript('')
    setPhase('listening')
    const recognizer = createSpeechRecognizer({
      locale,
      onResult: (text, isFinal) => {
        setTranscript(text)
        if (isFinal) setPhase('done')
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = () => {
    recognizerRef.current?.abort()
    recognizerRef.current = null
    onClose()
  }
  const confirm = () => {
    const text = transcript.trim()
    if (!text) return
    onResult(text)
    close()
  }

  const status =
    phase === 'listening'
      ? t('voice.listening')
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
        <div className="mt-5 flex flex-col items-center">
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
            disabled={!transcript.trim()}
            className="flex-1 rounded-2xl bg-[#4A82B8] py-3 text-sm font-black text-white transition hover:bg-[#3F74A8] active:scale-[0.99] disabled:opacity-40"
          >
            {t('voice.useText')}
          </button>
        </div>
      </section>
    </div>
  )
}
