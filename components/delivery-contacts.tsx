'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Phone, X } from 'lucide-react'
import { appendDeliveryChat, loadDeliveryChat, type DeliveryChatPeer, type DeliveryJob } from '@/lib/delivery-job'
import { telHref } from '@/lib/phone'

const DRIVER_QUICK = ['픽업 장소로 이동 중입니다', '상품을 인수했습니다', '배송 중입니다', '곧 도착합니다']

export function DeliveryContactCard({
  job,
  onChat,
}: {
  job: DeliveryJob
  onChat: (peer: DeliveryChatPeer) => void
}) {
  return (
    <div className="space-y-2">
      <ContactRow
        title="발신인 연락처"
        phone={job.senderPhone}
        onChat={() => onChat('sender')}
      />
      <ContactRow
        title="수신인 연락처"
        phone={job.recipientPhone}
        onChat={() => onChat('recipient')}
      />
    </div>
  )
}

function ContactRow({
  title,
  phone,
  onChat,
}: {
  title: string
  phone: string
  onChat: () => void
}) {
  const href = telHref(phone)
  return (
    <div className="rounded-2xl border border-[#BBF7D0] bg-white p-3">
      <p className="text-[10px] font-black text-[#047857]">{title}</p>
      <p className="mt-1 font-mono text-base font-black tracking-tight text-[#0F172A]">{phone}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <a
          href={href}
          className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-black ${href ? 'bg-[#047857] text-white' : 'pointer-events-none bg-[#E2E8F0] text-[#94A3B8]'}`}
        >
          <Phone className="h-3.5 w-3.5" />
          전화 연결
        </a>
        <button
          type="button"
          onClick={onChat}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-[#047857] bg-white py-2.5 text-xs font-black text-[#047857]"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          채팅하기
        </button>
      </div>
    </div>
  )
}

export function DeliveryChatSheet({
  job,
  peer,
  onClose,
}: {
  job: DeliveryJob
  peer: DeliveryChatPeer
  onClose: () => void
}) {
  const peerName = peer === 'sender' ? '발신인' : '수신인'
  const peerPhone = peer === 'sender' ? job.senderPhone : job.recipientPhone
  const [messages, setMessages] = useState(() => loadDeliveryChat(job.id, peer))
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMessages(loadDeliveryChat(job.id, peer))
  }, [job.id, peer])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const send = (text: string) => {
    const value = text.trim()
    if (!value) return
    setDraft('')
    const next = appendDeliveryChat(job.id, {
      id: `${Date.now()}`,
      peer,
      sender: 'driver',
      text: value,
      at: new Date().toISOString(),
    })
    setMessages(next)
  }

  return (
    <div className="fixed inset-0 z-[97] flex items-end bg-[#1e1033]/55 sm:items-center sm:p-4">
      <section className="mx-auto flex h-[min(88vh,640px)] w-full max-w-md flex-col rounded-t-[32px] bg-white shadow-2xl sm:rounded-[32px]">
        <div className="flex items-start justify-between border-b border-[#E2E8F0] px-5 py-4">
          <div>
            <p className="text-xs font-black text-[#047857]">배송 채팅 · {peerName}</p>
            <h2 className="mt-1 text-lg font-black text-[#0F172A]">{peerPhone}</h2>
            <p className="mt-1 text-[11px] font-bold text-[#64748B]">인앱 메시지 연동 준비 · 이 배송 건에만 저장됩니다</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="닫기">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <p className="rounded-2xl bg-[#F0FDF4] px-3 py-3 text-center text-xs font-bold text-[#047857]">
              {peerName}에게 보낼 메시지를 입력해 주세요.
            </p>
          ) : null}
          {messages.map((item) => (
            <div key={item.id} className={`flex ${item.sender === 'driver' ? 'justify-end' : 'justify-start'}`}>
              <p className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm font-bold ${item.sender === 'driver' ? 'bg-[#047857] text-white' : 'bg-[#F1F5F9] text-[#0F172A]'}`}>
                {item.text}
              </p>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="border-t border-[#E2E8F0] px-4 py-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {DRIVER_QUICK.map((item) => (
              <button key={item} type="button" onClick={() => send(item)} className="rounded-full bg-[#F0FDF4] px-2.5 py-1 text-[11px] font-black text-[#047857]">
                {item}
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
              onChange={(event) => setDraft(event.target.value)}
              placeholder="메시지 입력"
              className="min-w-0 flex-1 rounded-2xl border-2 border-[#DCFCE7] bg-[#F8FAFC] px-3 py-3 text-sm font-bold outline-none focus:border-[#047857]"
            />
            <button type="submit" className="rounded-2xl bg-[#047857] px-4 py-3 text-sm font-black text-white">
              전송
            </button>
          </form>
        </div>
      </section>
    </div>
  )
}
