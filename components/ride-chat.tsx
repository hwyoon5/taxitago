'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { fetchChatRoom, sendChatMessage } from '@/lib/comms-client'
import type { ChatMessage, CommsRole, PublicChatRoom } from '@/lib/comms-types'

const PASSENGER_QUICK = ['문 앞에 도착했습니다', '안전하게 이동 중입니다', '빨리 와주세요', '짐이 있어요']
const DRIVER_QUICK = ['곧 도착합니다', '정차 위치를 알려주세요', '안전 운전하겠습니다', '도착했습니다']

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
  const [room, setRoom] = useState<PublicChatRoom | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const archived = room?.status === 'archived'

  useEffect(() => {
    let cancelled = false
    void fetchChatRoom(rideId, actorId, role).then((next) => {
      if (!cancelled) setRoom(next)
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : '채팅을 열지 못했어요.')
    })

    const params = new URLSearchParams({ actorId, role })
    const source = new EventSource(`/api/rides/${encodeURIComponent(rideId)}/chat/stream?${params.toString()}`)
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
        }
        if (payload.type === 'archived') {
          setRoom((current) => (current ? { ...current, status: 'archived', closeReason: payload.reason === 'cancelled' ? 'cancelled' : 'completed', closedAt: new Date().toISOString() } : current))
        }
      } catch {
        undefined
      }
    }
    const poll = window.setInterval(() => {
      void fetchChatRoom(rideId, actorId, role).then((next) => {
        if (!cancelled) setRoom(next)
      }).catch(() => undefined)
    }, 4000)

    return () => {
      cancelled = true
      source.close()
      window.clearInterval(poll)
    }
  }, [rideId, actorId, role])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [room?.messages.length])

  const send = (text: string) => {
    const value = text.trim()
    if (!value || archived) return
    setDraft('')
    void sendChatMessage(rideId, actorId, role, value)
      .then(setRoom)
      .catch((err) => setError(err instanceof Error ? err.message : '전송 실패'))
  }

  const mine = (message: ChatMessage) => message.senderRole === role
  const quick = role === 'driver' ? DRIVER_QUICK : PASSENGER_QUICK

  return (
    <div className="fixed inset-0 z-[97] flex items-end bg-[#1e1033]/55 sm:items-center sm:p-4">
      <section className="mx-auto flex h-[78vh] w-full max-w-md flex-col rounded-t-[32px] bg-white shadow-2xl sm:rounded-[32px]">
        <header className="flex items-center justify-between border-b border-[#EDE5FF] px-4 py-3">
          <div>
            <p className="text-xs font-black text-[#4C1FB8]">실시간 안심 채팅</p>
            <h3 className="text-base font-black text-[#0F172A]">{peerName}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2" aria-label="채팅 닫기">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 space-y-2 overflow-y-auto bg-[#F8F5FF] px-4 py-4">
          {(room?.messages ?? []).map((message) => (
            <div key={message.id} className={`flex ${mine(message) ? 'justify-end' : 'justify-start'}`}>
              <p className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm font-bold ${mine(message) ? 'bg-[#4C1FB8] text-white' : 'bg-white text-[#0F172A] shadow-sm'}`}>
                {message.text}
              </p>
            </div>
          ))}
          {archived ? (
            <p className="rounded-2xl bg-[#FEF3C7] px-3 py-2 text-center text-xs font-bold text-[#92400E]">
              운행이 {room?.closeReason === 'cancelled' ? '취소' : '완료'}되어 채팅방이 안전하게 종료·보관되었습니다.
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
              placeholder={archived ? '종료된 채팅방입니다' : '메시지를 입력해 주세요'}
              className="min-w-0 flex-1 rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] px-4 py-3 text-sm font-bold outline-none focus:border-[#4C1FB8] disabled:opacity-50"
            />
            <button type="submit" disabled={archived} className="rounded-2xl bg-[#4C1FB8] px-4 font-black text-white disabled:opacity-40">
              전송
            </button>
          </form>
        </div>
      </section>
    </div>
  )
}
