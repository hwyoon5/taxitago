'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Phone, X } from 'lucide-react'
import { fetchChatRoom, fetchSafeCall } from '@/lib/comms-client'
import { playCommsAlert } from '@/lib/alert-sound'
import type { CommsRole } from '@/lib/comms-types'

type CommsAlert = { kind: 'chat' | 'call'; preview: string }

// 배차된 운행 동안 상대방의 채팅 메시지/안심 통화 요청을 폴링으로 감지해
// 플로팅 알림 배너 + 알림음으로 노출한다. 채팅/통화 UI가 열려 있으면
// 배너는 띄우지 않되 seen 마킹은 유지해 닫은 뒤 재알림이 울리지 않게 한다.
export default function RideCommsAlerts({
  rideId,
  actorId,
  role,
  peerName,
  chatOpen,
  callOpen,
  onOpenChat,
  onOpenCall,
}: {
  rideId?: string | null
  actorId: string
  role: CommsRole
  peerName: string
  chatOpen?: boolean
  callOpen?: boolean
  onOpenChat: () => void
  onOpenCall: () => void
}) {
  const [alert, setAlert] = useState<CommsAlert | null>(null)
  const seenRef = useRef<Set<string>>(new Set())
  const primedRef = useRef(false)
  const callFlagRef = useRef(false)
  const openRef = useRef({ chat: false, call: false })
  openRef.current = { chat: !!chatOpen, call: !!callOpen }

  useEffect(() => {
    seenRef.current = new Set()
    primedRef.current = false
    callFlagRef.current = false
    setAlert(null)
  }, [rideId])

  useEffect(() => {
    if (!rideId || !actorId) return
    let cancelled = false
    const tick = async () => {
      try {
        const room = await fetchChatRoom(rideId, actorId, role)
        if (cancelled) return
        const fresh = room.messages.filter((m) => m.senderRole !== role && !seenRef.current.has(m.id))
        for (const m of room.messages) seenRef.current.add(m.id)
        if (!primedRef.current) {
          primedRef.current = true
        } else if (fresh.length && !openRef.current.chat) {
          const last = fresh[fresh.length - 1]
          playCommsAlert('message')
          setAlert((cur) => (cur?.kind === 'call' ? cur : { kind: 'chat', preview: last.text }))
        }
      } catch {
        undefined
      }
      try {
        const call = await fetchSafeCall(rideId, actorId, role)
        if (cancelled) return
        const live = call.status === 'ringing' || call.status === 'active'
        if (live) {
          if (!callFlagRef.current && !openRef.current.call) {
            callFlagRef.current = true
            playCommsAlert('call')
            setAlert({ kind: 'call', preview: '인앱 음성 통화 요청' })
          }
        } else {
          callFlagRef.current = false
          setAlert((cur) => (cur?.kind === 'call' ? null : cur))
        }
      } catch {
        undefined
      }
    }
    void tick()
    const timer = window.setInterval(tick, 3500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [rideId, actorId, role])

  if (!alert) return null
  const isCall = alert.kind === 'call'
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[120] flex justify-center px-4">
      <section className="pointer-events-auto w-full max-w-md rounded-3xl border-2 border-[#C4B5FD] bg-white p-4 shadow-[0_18px_40px_rgba(15,23,42,0.35)]">
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${isCall ? 'bg-[#047857]' : 'bg-[#4C1FB8]'}`}>
            {isCall ? <Phone className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black text-[#4C1FB8]">{isCall ? '인앱 음성 통화 요청' : '새 메시지 도착'}</p>
            <p className="mt-0.5 text-sm font-black text-[#0F172A]">{peerName}</p>
            <p className="mt-0.5 truncate text-xs font-bold text-[#64748B]">{alert.preview}</p>
          </div>
          <button type="button" onClick={() => setAlert(null)} aria-label="알림 닫기" className="shrink-0 rounded-full bg-[#F1F5F9] p-1.5 text-[#64748B]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setAlert(null)} className="rounded-2xl border-2 border-[#E2E8F0] bg-white py-2.5 text-xs font-black text-[#64748B]">
            나중에
          </button>
          <button
            type="button"
            onClick={() => {
              setAlert(null)
              if (isCall) onOpenCall()
              else onOpenChat()
            }}
            className={`rounded-2xl py-2.5 text-xs font-black text-white ${isCall ? 'bg-[#047857]' : 'bg-[#4C1FB8]'}`}
          >
            {isCall ? '통화 연결' : '채팅 열기'}
          </button>
        </div>
      </section>
    </div>
  )
}
