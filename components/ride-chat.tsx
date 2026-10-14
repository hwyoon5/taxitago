'use client'

import { useEffect, useRef, useState } from 'react'
import { Languages, X } from 'lucide-react'
import { fetchChatRoom, sendChatMessage } from '@/lib/comms-client'
import { localEventSourceUrl } from '@/lib/app-origin'
import { useLocale } from '@/components/locale-provider'
import type { ChatMessage, CommsRole, PublicChatRoom } from '@/lib/comms-types'

const PASSENGER_QUICK = ['chat.q1', 'chat.q2', 'chat.q3', 'chat.q4'] as const
const DRIVER_QUICK = ['chat.dq1', 'chat.dq2', 'chat.dq3', 'chat.dq4'] as const

export default function RideChat({
  rideId,
  actorId,
  role,
  peerName,
  onClose,
}: {
  rideId: string
  actorId: string
  role: CommsRole
  peerName: string
  onClose: () => void
}) {
  const { locale, t } = useLocale()
  const tRef = useRef(t)
  tRef.current = t
  const [room, setRoom] = useState<PublicChatRoom | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const archived = room?.status === 'archived'

  useEffect(() => {
    let cancelled = false
    void fetchChatRoom(rideId, actorId, role, locale).then((next) => {
      if (!cancelled) setRoom(next)
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : tRef.current('chat.openFail'))
    })

    const params = new URLSearchParams({ actorId, role, lang: locale })
    const source = new EventSource(localEventSourceUrl(`api/rides/${encodeURIComponent(rideId)}/chat/stream`, params))
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string; message?: ChatMessage; room?: PublicChatRoom; reason?: string }
        if (payload.room) setRoom(payload.room)
        if (payload.type === 'message' && payload.message) {
          setRoom((current) =>
            current
              ? { ...current, messages: current.messages.some((item) => item.id === payload.message?.id) ? current.messages : [...current.messages, payload.message!] }
              : current,
          )
          // 방금 도착한 메시지에 내 언어 번역이 없으면 한 번 다시 가져와 채운다.
          if (!payload.message.translations?.[locale]) {
            void fetchChatRoom(rideId, actorId, role, locale)
              .then((next) => { if (!cancelled) setRoom(next) })
              .catch(() => undefined)
          }
        }
        if (payload.type === 'archived') {
          setRoom((current) => (current ? { ...current, status: 'archived', closeReason: payload.reason === 'cancelled' ? 'cancelled' : 'completed', closedAt: new Date().toISOString() } : current))
        }
      } catch {
        undefined
      }
    }
    const poll = window.setInterval(() => {
      void fetchChatRoom(rideId, actorId, role, locale).then((next) => {
        if (!cancelled) setRoom(next)
      }).catch(() => undefined)
    }, 4000)

    return () => {
      cancelled = true
      source.close()
      window.clearInterval(poll)
    }
  }, [rideId, actorId, role, locale])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [room?.messages.length])

  const send = (text: string) => {
    const value = text.trim()
    if (!value || archived) return
    setDraft('')
    void sendChatMessage(rideId, actorId, role, value)
      .then(setRoom)
      .catch((err) => setError(err instanceof Error ? err.message : t('chat.sendFail')))
  }

  const mine = (message: ChatMessage) => message.senderRole === role
  const quick = (role === 'driver' ? DRIVER_QUICK : PASSENGER_QUICK).map((key) => t(key))

  return (
    <div className="fixed inset-0 z-[97] flex items-end bg-[#1e1033]/55 sm:items-center sm:p-4">
      <section className="mx-auto flex h-[78vh] w-full max-w-md flex-col rounded-t-[32px] bg-white shadow-2xl sm:rounded-[32px]">
        <header className="flex items-center justify-between border-b border-[#EDE5FF] px-4 py-3">
          <div>
            <p className="flex items-center gap-1 text-xs font-black text-[#4C1FB8]">
              <Languages className="h-3.5 w-3.5" />
              {t('chat.title')} · {t('chat.autoTrans')}
            </p>
            <h3 className="text-base font-black text-[#0F172A]">{peerName}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2" aria-label={t('chat.close')}>
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 space-y-2 overflow-y-auto bg-[#F8F5FF] px-4 py-4">
          {(room?.messages ?? []).map((message) => {
            const isMine = mine(message)
            const translated = isMine ? undefined : message.translations?.[locale]
            const shown = translated || message.text
            const showOriginal = Boolean(translated && translated !== message.text)
            return (
              <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <p className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm font-bold ${isMine ? 'bg-[#4C1FB8] text-white' : 'bg-white text-[#0F172A] shadow-sm'}`}>
                  {shown}
                  {showOriginal ? (
                    <span className={`mt-1 block text-[10px] font-semibold leading-4 ${isMine ? 'text-white/60' : 'text-[#94A3B8]'}`}>
                      {t('chat.original')}: {message.text}
                    </span>
                  ) : null}
                </p>
              </div>
            )
          })}
          {archived ? (
            <p className="rounded-2xl bg-[#FEF3C7] px-3 py-2 text-center text-xs font-bold text-[#92400E]">
              {room?.closeReason === 'cancelled' ? t('chat.archivedCancel') : t('chat.archivedDone')}
            </p>
          ) : null}
          {error ? <p className="text-center text-xs font-bold text-[#B91C1C]">{error}</p> : null}
          <div ref={bottomRef} />
        </div>
        <div className="border-t border-[#EDE5FF] bg-white px-3 pb-4 pt-3">
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {quick.map((reply) => (
              <button
                key={reply}
                type="button"
                disabled={archived}
                onClick={() => send(reply)}
                className="shrink-0 rounded-full border border-[#D8CCF5] bg-[#F8F5FF] px-3 py-1.5 text-[11px] font-black text-[#4C1FB8] disabled:opacity-40"
              >
                {reply}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              send(draft)
            }}
          >
            <input
              value={draft}
              disabled={archived}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={archived ? t('chat.closedPh') : role === 'driver' ? t('chat.toPassenger') : t('chat.toDriver')}
              className="min-w-0 flex-1 rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] px-4 py-3 text-sm font-bold outline-none focus:border-[#4C1FB8] disabled:opacity-50"
            />
            <button type="submit" disabled={archived} className="rounded-2xl bg-[#4C1FB8] px-4 font-black text-white disabled:opacity-40">
              {t('chat.send')}
            </button>
          </form>
        </div>
      </section>
    </div>
  )
}
