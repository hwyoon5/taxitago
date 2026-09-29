'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  editTicketReply,
  fetchLostInbox,
  fetchTickets,
  sendLostMessage,
  sendTicketMessage,
  setTicketStatus,
} from '@/lib/support-client'
import {
  LOST_STATUS_LABEL,
  TICKET_CATEGORY_LABEL,
  TICKET_STATUS_LABEL,
  type LostItem,
  type SupportTicket,
  type TicketStatus,
} from '@/lib/support-types'

const ADMIN_ID = 'ops-admin'
const STATUSES: TicketStatus[] = ['received', 'in_progress', 'waiting', 'resolved', 'closed']

export default function AdminSupportDesk() {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [lost, setLost] = useState<LostItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [kind, setKind] = useState<'ticket' | 'lost'>('ticket')
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = () => {
    void fetchTickets(ADMIN_ID, 'admin').then(setTickets)
    void fetchLostInbox(ADMIN_ID, 'admin').then(setLost)
  }

  useEffect(() => {
    reload()
    const timer = window.setInterval(reload, 3000)
    return () => window.clearInterval(timer)
  }, [])

  const ticket = tickets.find((item) => kind === 'ticket' && item.id === selectedId) ?? null
  const item = lost.find((row) => kind === 'lost' && row.id === selectedId) ?? null
  const latestAdmin = ticket?.messages.filter((message) => message.fromRole === 'admin').at(-1) ?? null

  const openTicket = (next: SupportTicket) => {
    setKind('ticket')
    setSelectedId(next.id)
    const reply = next.messages.filter((message) => message.fromRole === 'admin').at(-1)
    setDraft(reply?.text || '')
    setEditing(Boolean(reply))
  }
  const openLost = (next: LostItem) => {
    setKind('lost')
    setSelectedId(next.id)
    const reply = [...next.messages].reverse().find((message) => message.fromRole === 'admin')
    setDraft(reply?.text || '')
    setEditing(false)
  }
  const tell = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }
  const saveTicketReply = () => {
    if (!ticket || busy) return
    const text = draft.trim()
    if (!text) return
    setBusy(true)
    const request = editing && latestAdmin
      ? editTicketReply(ticket.id, latestAdmin.id, text)
      : sendTicketMessage(ticket.id, ADMIN_ID, 'admin', text).then((next) => {
          setEditing(true)
          return next
        })
    void request
      .then((next) => {
        setTickets((rows) => rows.map((row) => (row.id === next.id ? next : row)))
        tell(editing && latestAdmin ? '답변을 수정했습니다.' : '답변을 등록했습니다.')
      })
      .catch((error) => tell(error instanceof Error ? error.message : '답변을 저장하지 못했어요.'))
      .finally(() => setBusy(false))
  }
  const saveLostReply = () => {
    if (!item || busy) return
    const text = draft.trim()
    if (!text) return
    setBusy(true)
    void sendLostMessage(item.id, ADMIN_ID, 'admin', text)
      .then((next) => {
        setLost((rows) => rows.map((row) => (row.id === next.id ? next : row)))
        setDraft('')
        tell('분실물 답변을 등록했습니다.')
      })
      .catch((error) => tell(error instanceof Error ? error.message : '답변을 저장하지 못했어요.'))
      .finally(() => setBusy(false))
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl bg-[#F8FAFC] px-4 py-6 text-[#0F172A]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black text-[#4C1FB8]">ADMIN</p>
          <h1 className="mt-1 text-2xl font-black">문의 관리</h1>
          <p className="mt-1 text-sm font-bold text-[#64748B]">1:1 문의와 분실물 접수를 확인하고 답변을 남깁니다.</p>
        </div>
        <Link href="/" className="rounded-full bg-white px-3 py-2 text-xs font-black text-[#4C1FB8]">홈</Link>
      </div>
      {notice ? <p className="mt-3 rounded-full bg-[#0F172A] px-3 py-2 text-center text-xs font-black text-white">{notice}</p> : null}
      <div className="mt-4 grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-2">
          <p className="text-xs font-black text-[#4C1FB8]">접수 목록 · {tickets.length + lost.length}건</p>
          {tickets.length + lost.length === 0 ? (
            <p className="rounded-2xl border-2 border-dashed border-[#CBD5E1] bg-white p-5 text-center text-sm font-bold text-[#64748B]">아직 접수된 문의가 없습니다.</p>
          ) : null}
          {tickets.map((row) => (
            <button key={row.id} type="button" onClick={() => openTicket(row)} className={`w-full rounded-2xl border-2 bg-white p-3 text-left ${selectedId === row.id && kind === 'ticket' ? 'border-[#4C1FB8]' : 'border-[#CBD5E1]'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-black text-[#4C1FB8]">{TICKET_CATEGORY_LABEL[row.category]}</p>
                <span className="rounded-full bg-[#F8F5FF] px-2 py-0.5 text-[10px] font-black text-[#4C1FB8]">{TICKET_STATUS_LABEL[row.status]}</span>
              </div>
              <p className="mt-1 text-sm font-black">{row.subject}</p>
              <p className="mt-1 line-clamp-2 text-xs font-bold text-[#64748B]">{row.body}</p>
              <p className="mt-1 text-[11px] font-bold text-[#64748B]">{row.userRole === 'driver' ? '기사' : '이용자'} · {row.userId}</p>
            </button>
          ))}
          {lost.map((row) => (
            <button key={row.id} type="button" onClick={() => openLost(row)} className={`w-full rounded-2xl border-2 bg-white p-3 text-left ${selectedId === row.id && kind === 'lost' ? 'border-[#4C1FB8]' : 'border-[#CBD5E1]'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-black text-[#4C1FB8]">분실물 · {row.kind === 'lost' ? '분실' : '습득'}</p>
                <span className="rounded-full bg-[#F8F5FF] px-2 py-0.5 text-[10px] font-black text-[#4C1FB8]">{LOST_STATUS_LABEL[row.status]}</span>
              </div>
              <p className="mt-1 text-sm font-black">{row.itemType}</p>
              <p className="mt-1 line-clamp-2 text-xs font-bold text-[#64748B]">{row.description || row.route}</p>
              <p className="mt-1 text-[11px] font-bold text-[#64748B]">{row.reporterRole === 'driver' ? '기사' : '이용자'} · {row.reporterId}</p>
            </button>
          ))}
        </section>
        <section className="rounded-[24px] border-2 border-[#CBD5E1] bg-white p-4">
          {!ticket && !item ? <p className="text-sm font-bold text-[#64748B]">왼쪽 목록에서 문의를 선택해 주세요.</p> : null}
          {ticket ? (
            <div>
              <p className="text-xs font-black text-[#4C1FB8]">{TICKET_CATEGORY_LABEL[ticket.category]} · {TICKET_STATUS_LABEL[ticket.status]}</p>
              <h2 className="mt-1 text-lg font-black">{ticket.subject}</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-[#334155]">{ticket.body}</p>
              <p className="mt-2 text-[11px] font-bold text-[#64748B]">{ticket.userRole === 'driver' ? '기사' : '이용자'} · {ticket.userId}</p>
              <select
                value={ticket.status}
                onChange={(event) => {
                  void setTicketStatus(ticket.id, event.target.value as TicketStatus).then((next) => {
                    setTickets((rows) => rows.map((row) => (row.id === next.id ? next : row)))
                    tell('상태를 바꿨습니다.')
                  })
                }}
                className="mt-3 w-full rounded-xl border border-[#D8CCF5] px-2 py-2 text-xs font-black text-[#4C1FB8]"
              >
                {STATUSES.map((status) => <option key={status} value={status}>{TICKET_STATUS_LABEL[status]}</option>)}
              </select>
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                {ticket.messages.map((message) => (
                  <div key={message.id} className={`rounded-2xl px-3 py-2 text-sm font-bold ${message.fromRole === 'admin' ? 'bg-[#F8F5FF] text-[#4C1FB8]' : 'bg-[#F1F5F9] text-[#0F172A]'}`}>
                    <p className="text-[10px] font-black">{message.fromRole === 'admin' ? '관리자 답변' : '고객'}</p>
                    <p className="mt-1 leading-5">{message.text}</p>
                    {message.editedAt ? <p className="mt-1 text-[10px] font-bold text-[#8b8495]">수정됨</p> : null}
                  </div>
                ))}
              </div>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} placeholder={latestAdmin ? '등록한 답변을 수정하거나 새 답변을 작성' : '답변을 작성하세요'} className="mt-3 w-full rounded-2xl border-2 border-[#CBD5E1] px-3 py-3 text-sm font-bold outline-none" />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" disabled={busy} onClick={() => { setEditing(false); setDraft(''); }} className="rounded-2xl border-2 border-[#CBD5E1] py-2.5 text-xs font-black text-[#475569]">새 답변</button>
                <button type="button" disabled={busy} onClick={saveTicketReply} className="rounded-2xl bg-[#4C1FB8] py-2.5 text-xs font-black text-white disabled:opacity-60">{busy ? '저장 중…' : editing && latestAdmin ? '답변 수정' : '답변 등록'}</button>
              </div>
            </div>
          ) : null}
          {item ? (
            <div>
              <p className="text-xs font-black text-[#4C1FB8]">분실물 · {LOST_STATUS_LABEL[item.status]}</p>
              <h2 className="mt-1 text-lg font-black">{item.itemType}</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-[#334155]">{item.description || item.route}</p>
              <p className="mt-2 text-[11px] font-bold text-[#64748B]">{item.reporterRole === 'driver' ? '기사' : '이용자'} · {item.reporterId}</p>
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                {item.messages.map((message) => (
                  <div key={message.id} className={`rounded-2xl px-3 py-2 text-sm font-bold ${message.fromRole === 'admin' ? 'bg-[#F8F5FF] text-[#4C1FB8]' : 'bg-[#F1F5F9]'}`}>
                    <p className="text-[10px] font-black">{message.fromRole === 'admin' ? '관리자 답변' : '고객'}</p>
                    <p className="mt-1 leading-5">{message.text}</p>
                  </div>
                ))}
              </div>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} placeholder="분실물 답변" className="mt-3 w-full rounded-2xl border-2 border-[#CBD5E1] px-3 py-3 text-sm font-bold outline-none" />
              <button type="button" disabled={busy} onClick={saveLostReply} className="mt-2 w-full rounded-2xl bg-[#4C1FB8] py-2.5 text-xs font-black text-white disabled:opacity-60">{busy ? '저장 중…' : '답변 등록'}</button>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  )
}
