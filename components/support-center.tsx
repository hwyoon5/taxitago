'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  createTicket,
  fetchLostInbox,
  fetchLostItem,
  fetchLostRides,
  fetchTicket,
  fetchTickets,
  sendLostMessage,
  sendTicketMessage,
  setLostStatus,
  submitLostItem,
} from '@/lib/support-client'
import {
  LOST_ITEM_TYPES,
  LOST_STATUS_LABEL,
  TICKET_CATEGORY_LABEL,
  TICKET_STATUS_LABEL,
  type LostItem,
  type LostItemType,
  type LostKind,
  type SupportActor,
  type SupportTicket,
  type TicketCategory,
} from '@/lib/support-types'

type Tab = 'ask' | 'lost' | 'tickets'

const SAMPLE_RIDES = [
  { id: '', route: '서울시청 → 강남역', driverName: '김민수', plate: '서울 31바 1842', vehicle: '현대 아슬란' },
  { id: '', route: '인천공항 → 홍대입구', driverName: '이준호', plate: '서울 12아 5521', vehicle: '제네시스 G80' },
]

export type LostPrefill = {
  rideId?: string
  route?: string
  driverName?: string
  plate?: string
  vehicle?: string
}

export default function SupportCenter({
  actorId,
  actorRole,
  onNotice,
  prefillLost,
}: {
  actorId: string
  actorRole: Exclude<SupportActor, 'admin'>
  onNotice?: (message: string) => void
  prefillLost?: LostPrefill | null
}) {
  const [tab, setTab] = useState<Tab>(prefillLost ? 'lost' : 'ask')
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [lost, setLost] = useState<LostItem[]>([])
  const [openTicket, setOpenTicket] = useState<SupportTicket | null>(null)
  const [openLost, setOpenLost] = useState<LostItem | null>(null)

  const reload = () => {
    void fetchTickets(actorId, actorRole)
      .then((next) => {
        setTickets(next)
        setOpenTicket((current) => current ? next.find((item) => item.id === current.id) ?? current : current)
      })
      .catch(() => undefined)
    void fetchLostInbox(actorId, actorRole)
      .then((next) => {
        setLost(next)
        setOpenLost((current) => current ? next.find((item) => item.id === current.id) ?? current : current)
      })
      .catch(() => undefined)
  }

  useEffect(() => {
    reload()
    const timer = window.setInterval(reload, 8000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', reload)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', reload)
    }
  }, [actorId, actorRole])

  const applyTicketUpdate = useCallback((ticket: SupportTicket) => {
    setTickets((items) => items.map((item) => (item.id === ticket.id ? ticket : item)))
    setOpenTicket((current) => (current && current.id === ticket.id ? ticket : current))
  }, [])
  const applyLostUpdate = useCallback((item: LostItem) => {
    setLost((rows) =>
      rows
        .map((row) => (row.id === item.id ? item : row))
        .filter((row) => actorRole !== 'driver' || (row.status !== 'returned' && row.status !== 'closed')),
    )
    setOpenLost((current) => (current && current.id === item.id ? item : current))
  }, [actorRole])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-[#F1F5F9] p-1">
        {([
          ['ask', '1:1 문의'],
          ['lost', '분실물'],
          ['tickets', '내 접수'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-xl py-2 text-[11px] font-black ${tab === id ? 'bg-[#4C1FB8] text-white' : 'text-[#64748B]'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'ask' ? (
        <TicketForm
          actorId={actorId}
          actorRole={actorRole}
          onCreated={(ticket) => {
            setTickets((items) => [ticket, ...items.filter((item) => item.id !== ticket.id)])
            onNotice?.('1:1 문의가 접수되었습니다.')
            setTab('tickets')
            setOpenTicket(ticket)
          }}
        />
      ) : null}
      {tab === 'lost' ? (
        <LostForm
          actorId={actorId}
          actorRole={actorRole}
          prefill={prefillLost}
          items={lost}
          onCreated={(item) => {
            setLost((items) => [item, ...items.filter((row) => row.id !== item.id)])
            onNotice?.('분실물이 접수되었고 해당 기사님과 연결됩니다.')
            setOpenLost(item)
          }}
          onOpen={setOpenLost}
        />
      ) : null}
      {tab === 'tickets' ? (
        <div className="space-y-3">
          <TicketList tickets={tickets} onOpen={setOpenTicket} />
          {lost.length ? (
            <div className="space-y-2">
              <p className="text-xs font-black text-[#4C1FB8]">분실물 접수</p>
              {lost.map((item) => {
                const reply = [...item.messages].reverse().find((message) => message.fromRole === 'admin')
                return (
                  <button key={item.id} type="button" onClick={() => setOpenLost(item)} className="w-full rounded-2xl border-2 border-[#CBD5E1] bg-white p-4 text-left">
                    <p className="text-[11px] font-black text-[#4C1FB8]">분실물 · {LOST_STATUS_LABEL[item.status]}</p>
                    <p className="mt-1 text-sm font-black text-[#0F172A]">{item.itemType}</p>
                    {reply ? <p className="mt-1 line-clamp-2 text-xs font-bold text-[#4C1FB8]">고객지원 답변 · {reply.text}</p> : <p className="mt-1 text-xs font-bold text-[#64748B]">답변을 기다리는 중입니다.</p>}
                  </button>
                )
              })}
            </div>
          ) : null}
          <Link href="/admin/support" className="block text-center text-[11px] font-black text-[#64748B]">관리자 문의함</Link>
        </div>
      ) : null}
      {openTicket ? (
        <TicketThread
          ticket={openTicket}
          actorId={actorId}
          role={actorRole}
          onClose={() => setOpenTicket(null)}
          onUpdate={applyTicketUpdate}
        />
      ) : null}
      {openLost ? (
        <LostThread
          item={openLost}
          actorId={actorId}
          role={actorRole}
          onClose={() => setOpenLost(null)}
          onUpdate={applyLostUpdate}
        />
      ) : null}
    </div>
  )
}

function TicketForm({
  actorId,
  actorRole,
  onCreated,
}: {
  actorId: string
  actorRole: Exclude<SupportActor, 'admin'>
  onCreated: (ticket: SupportTicket) => void
}) {
  const [category, setCategory] = useState<TicketCategory>('general')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const categories: TicketCategory[] = ['fare_dispute', 'general', 'payment', 'safety', 'lost']
  return (
    <div>
      <p className="text-xs font-black text-[#4C1FB8]">요금 분쟁 · 일반 문의</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {categories.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setCategory(item)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-black ${category === item ? 'bg-[#4C1FB8] text-white' : 'border border-[#D8CCF5] bg-white text-[#4C1FB8]'}`}
          >
            {TICKET_CATEGORY_LABEL[item]}
          </button>
        ))}
      </div>
      <input
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        placeholder="제목 (선택)"
        className="mt-3 w-full rounded-2xl border-2 border-[#CBD5E1] px-3 py-3 text-sm font-bold outline-none focus:border-[#4C1FB8]"
      />
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        placeholder="문의 내용을 입력해 주세요"
        className="mt-2 w-full rounded-2xl border-2 border-[#CBD5E1] px-3 py-3 text-sm font-bold outline-none focus:border-[#4C1FB8]"
      />
      <button
        type="button"
        disabled={busy || !body.trim()}
        onClick={() => {
          setBusy(true)
          setError('')
          void createTicket({ userId: actorId, userRole: actorRole, category, subject, body })
            .then((ticket) => {
              setBody('')
              setSubject('')
              onCreated(ticket)
            })
            .catch((reason) => setError(reason instanceof Error && reason.message ? `접수에 실패했습니다 (${reason.message}). 잠시 후 다시 시도해 주세요.` : '접수에 실패했습니다. 잠시 후 다시 시도해 주세요.'))
            .finally(() => setBusy(false))
        }}
        className="mt-3 w-full rounded-2xl bg-[#4C1FB8] py-3.5 text-sm font-black text-white disabled:opacity-60"
      >
        {busy ? '접수 중…' : '문의 보내기'}
      </button>
      {error ? <p className="mt-2 text-center text-xs font-black text-[#DC2626]">{error}</p> : null}
      <p className="mt-3 text-center text-xs font-bold text-[#64748B]">긴급 전화 1588-0000 · 매일 09:00–22:00</p>
    </div>
  )
}

function TicketList({ tickets, onOpen }: { tickets: SupportTicket[]; onOpen: (ticket: SupportTicket) => void }) {
  if (!tickets.length) return <p className="rounded-2xl border-2 border-dashed border-[#CBD5E1] p-5 text-center text-sm font-bold text-[#64748B]">아직 접수한 문의가 없습니다.</p>
  return (
    <div className="space-y-2">
      {tickets.map((ticket) => (
        <button key={ticket.id} type="button" onClick={() => onOpen(ticket)} className="w-full rounded-2xl border-2 border-[#CBD5E1] bg-white p-4 text-left">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-black text-[#4C1FB8]">{TICKET_CATEGORY_LABEL[ticket.category]}</p>
            <span className="flex items-center gap-1.5">
              {ticket.messages.some((message) => message.fromRole === 'admin') ? (
                <span className="rounded-full bg-[#ECFDF5] px-2 py-1 text-[10px] font-black text-[#047857]">{ticket.autoResolved ? '자동 답변 완료' : '답변 완료'}</span>
              ) : null}
              <span className="rounded-full bg-[#F8F5FF] px-2 py-1 text-[10px] font-black text-[#4C1FB8]">{TICKET_STATUS_LABEL[ticket.status]}</span>
            </span>
          </div>
          <p className="mt-1 text-sm font-black text-[#0F172A]">{ticket.subject}</p>
          <p className="mt-1 line-clamp-2 text-xs font-bold text-[#64748B]">{ticket.body}</p>
          {ticket.messages.some((message) => message.fromRole === 'admin') ? (
            <p className="mt-2 line-clamp-2 text-xs font-bold text-[#4C1FB8]">고객지원 답변 · {ticket.messages.filter((message) => message.fromRole === 'admin').at(-1)?.text}</p>
          ) : (
            <p className="mt-2 text-xs font-bold text-[#94A3B8]">답변을 기다리는 중입니다.</p>
          )}
        </button>
      ))}
    </div>
  )
}

function TicketThread({
  ticket,
  actorId,
  role,
  onClose,
  onUpdate,
}: {
  ticket: SupportTicket
  actorId: string
  role: SupportActor
  onClose: () => void
  onUpdate: (ticket: SupportTicket) => void
}) {
  const [draft, setDraft] = useState('')
  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchTicket(ticket.id).then((next) => {
        if (next) onUpdate(next)
      })
    }, 3000)
    return () => window.clearInterval(timer)
  }, [ticket.id, onUpdate])
  return (
    <div className="fixed inset-0 z-[105] flex items-end bg-[#1e1033]/50 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto flex max-h-[90vh] w-full max-w-md flex-col rounded-t-[32px] bg-white p-5 sm:rounded-[32px]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-black text-[#4C1FB8]">{TICKET_STATUS_LABEL[ticket.status]}</p>
            <h3 className="mt-1 text-lg font-black">{ticket.subject}</h3>
          </div>
          <button type="button" onClick={onClose} className="text-sm font-black text-[#64748B]">
            닫기
          </button>
        </div>
        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {ticket.messages.map((message) => (
            <div key={message.id} className={`rounded-2xl px-3 py-2 text-sm font-bold ${message.fromRole === 'admin' ? 'bg-[#F8F5FF] text-[#4C1FB8]' : 'bg-[#F1F5F9] text-[#0F172A]'}`}>
              <p className="text-[10px] font-black">{message.fromRole === 'admin' ? (message.auto ? '자동 답변' : '고객지원 답변') : '나'}</p>
              <p className="mt-1 leading-5">{message.text}</p>
              {message.editedAt ? <p className="mt-1 text-[10px] font-bold opacity-70">수정됨</p> : null}
            </div>
          ))}
        </div>
        <div className="relative mt-3">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={role === 'driver' ? '고객지원에 메시지' : '추가 문의'} className="h-11 w-full rounded-2xl border-2 border-[#CBD5E1] py-0 pl-3 pr-[4.25rem] text-sm font-bold outline-none" />
          <button
            type="button"
            onClick={() => {
              const text = draft.trim()
              if (!text) return
              setDraft('')
              void sendTicketMessage(ticket.id, actorId, role, text).then(onUpdate)
            }}
            className="absolute right-1.5 top-1/2 flex h-8 w-14 -translate-y-1/2 items-center justify-center whitespace-nowrap rounded-xl bg-[#4C1FB8] text-xs font-black text-white"
          >
            전송
          </button>
        </div>
      </section>
    </div>
  )
}

function LostForm({
  actorId,
  actorRole,
  prefill,
  items,
  onCreated,
  onOpen,
}: {
  actorId: string
  actorRole: Exclude<SupportActor, 'admin'>
  prefill?: LostPrefill | null
  items: LostItem[]
  onCreated: (item: LostItem) => void
  onOpen: (item: LostItem) => void
}) {
  const [rides, setRides] = useState<Awaited<ReturnType<typeof fetchLostRides>>>([])
  const [kind, setKind] = useState<LostKind>(actorRole === 'driver' ? 'found' : 'lost')
  const [itemType, setItemType] = useState<LostItemType>('휴대폰')
  const [description, setDescription] = useState('')
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16))
  const [rideKey, setRideKey] = useState(prefill?.rideId || prefill?.route || '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void fetchLostRides(actorId, actorRole).then(setRides)
  }, [actorId, actorRole])

  const options = [
    ...rides.map((ride) => ({ key: ride.id, rideId: ride.id, route: ride.route, driverName: ride.driverName, plate: ride.plate, vehicle: ride.vehicle })),
    ...SAMPLE_RIDES.map((ride) => ({ key: ride.route, rideId: '', route: ride.route, driverName: ride.driverName, plate: ride.plate, vehicle: ride.vehicle })),
  ]
  const selected = options.find((item) => item.key === rideKey) || (prefill ? { key: prefill.rideId || prefill.route || '', rideId: prefill.rideId || '', route: prefill.route || '', driverName: prefill.driverName || '', plate: prefill.plate || '', vehicle: prefill.vehicle || '' } : options[0])

  return (
    <div>
      <p className="text-xs font-black text-[#4C1FB8]">탑승 내역과 연결해 접수</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setKind('lost')} className={`rounded-2xl py-2 text-xs font-black ${kind === 'lost' ? 'bg-[#4C1FB8] text-white' : 'border border-[#D8CCF5] text-[#4C1FB8]'}`}>분실</button>
        <button type="button" onClick={() => setKind('found')} className={`rounded-2xl py-2 text-xs font-black ${kind === 'found' ? 'bg-[#4C1FB8] text-white' : 'border border-[#D8CCF5] text-[#4C1FB8]'}`}>습득</button>
      </div>
      <select value={selected?.key} onChange={(event) => setRideKey(event.target.value)} className="mt-3 w-full rounded-2xl border-2 border-[#CBD5E1] px-3 py-3 text-sm font-bold">
        {options.map((item) => (
          <option key={item.key} value={item.key}>
            {item.route} · {item.driverName || '기사'}
          </option>
        ))}
      </select>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {LOST_ITEM_TYPES.map((type) => (
          <button key={type} type="button" onClick={() => setItemType(type)} className={`rounded-full px-3 py-1.5 text-[11px] font-black ${itemType === type ? 'bg-[#4C1FB8] text-white' : 'border border-[#D8CCF5] text-[#4C1FB8]'}`}>
            {type}
          </button>
        ))}
      </div>
      <label className="mt-3 block text-xs font-black text-[#334155]">
        분실/습득 시각
        <input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} className="mt-1 w-full rounded-2xl border-2 border-[#CBD5E1] px-3 py-2.5 text-sm font-bold" />
      </label>
      <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="색깔, 브랜드, 좌석 위치 등" className="mt-2 w-full rounded-2xl border-2 border-[#CBD5E1] px-3 py-3 text-sm font-bold" />
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void submitLostItem({
            kind,
            itemType,
            description,
            occurredAt: new Date(occurredAt).toISOString(),
            rideId: selected?.rideId || undefined,
            reporterId: actorId,
            reporterRole: actorRole,
            route: selected?.route,
            driverName: selected?.driverName,
            plate: selected?.plate,
            vehicle: selected?.vehicle,
          })
            .then(onCreated)
            .catch(() => undefined)
            .finally(() => setBusy(false))
        }}
        className="mt-3 w-full rounded-2xl bg-[#4C1FB8] py-3.5 text-sm font-black text-white disabled:opacity-60"
      >
        {busy ? '접수 중…' : '기사에게 연결해 접수'}
      </button>
      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <button key={item.id} type="button" onClick={() => onOpen(item)} className="w-full rounded-2xl border-2 border-[#CBD5E1] bg-white p-3 text-left">
            <div className="flex justify-between">
              <p className="text-xs font-black text-[#4C1FB8]">{item.kind === 'lost' ? '분실' : '습득'} · {item.itemType}</p>
              <span className="text-[10px] font-black text-[#64748B]">{LOST_STATUS_LABEL[item.status]}</span>
            </div>
            <p className="mt-1 text-sm font-black">{item.route}</p>
            <p className="mt-1 text-xs font-bold text-[#64748B]">{item.driverName ? `${item.driverName} 기사님` : '매칭 대기'} · {item.plate || '차량 확인 중'}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function LostThread({
  item,
  actorId,
  role,
  onClose,
  onUpdate,
}: {
  item: LostItem
  actorId: string
  role: SupportActor
  onClose: () => void
  onUpdate: (item: LostItem) => void
}) {
  const [draft, setDraft] = useState('')
  useEffect(() => {
    const pull = () => {
      void fetchLostItem(item.id).then(onUpdate).catch(() => undefined)
    }
    pull()
    const timer = window.setInterval(pull, 3000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') pull()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', pull)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', pull)
    }
  }, [item.id, onUpdate])
  return (
    <div className="fixed inset-0 z-[105] flex items-end bg-[#1e1033]/50 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto flex max-h-[90vh] w-full max-w-md flex-col rounded-t-[32px] bg-white p-5 sm:rounded-[32px]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-black text-[#4C1FB8]">{LOST_STATUS_LABEL[item.status]} · {item.itemType}</p>
            <h3 className="mt-1 text-lg font-black">{item.route}</h3>
            <p className="mt-1 text-xs font-bold text-[#64748B]">{item.driverName} · {item.vehicle} · {item.plate}</p>
          </div>
          <button type="button" onClick={onClose} className="text-sm font-black text-[#64748B]">닫기</button>
        </div>
        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {item.messages.length ? item.messages.map((message) => (
            <div key={message.id} className={`rounded-2xl px-3 py-2 text-sm font-bold ${message.fromRole === 'admin' ? 'bg-[#F8F5FF] text-[#4C1FB8]' : message.fromId === actorId ? 'bg-[#4C1FB8] text-white' : 'bg-[#F1F5F9] text-[#0F172A]'}`}>
              <p className="text-[10px] font-black">{message.fromRole === 'admin' ? '고객지원 답변' : message.fromId === actorId ? '나' : role === 'driver' ? '승객' : '기사님'}</p>
              <p className="mt-1 leading-5">{message.text}</p>
            </div>
          )) : <p className="text-sm font-bold text-[#64748B]">아직 답변이 없습니다.</p>}
        </div>
        {item.status === 'returned' || item.status === 'closed' ? (
          <p className="mt-3 rounded-2xl bg-[#F8F5FF] px-3 py-2.5 text-center text-xs font-black text-[#4C1FB8]">
            {item.status === 'returned' ? '물건 반환이 완료된 건입니다.' : '종료된 건입니다.'}
          </p>
        ) : (
          <div className={`mt-3 grid gap-2 ${item.status === 'open' ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {item.status !== 'open' ? (
              <button
                type="button"
                onClick={() => void setLostStatus(item.id, 'returned', actorId, role).then(onUpdate).catch(() => undefined)}
                className="rounded-2xl bg-[#047857] py-2.5 text-xs font-black text-white"
              >
                {role === 'driver' ? '반환 완료' : '수령 확인'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void setLostStatus(item.id, 'closed', actorId, role).then(onUpdate).catch(() => undefined)}
              className="rounded-2xl border-2 border-[#CBD5E1] py-2.5 text-xs font-black text-[#475569]"
            >
              종료
            </button>
          </div>
        )}
        <div className="relative mt-2">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={role === 'driver' ? '승객에게 메시지' : '기사님께 메시지'} className="h-11 w-full rounded-2xl border-2 border-[#CBD5E1] py-0 pl-3 pr-[4.25rem] text-sm font-bold" />
          <button
            type="button"
            onClick={() => {
              const text = draft.trim()
              if (!text) return
              setDraft('')
              void sendLostMessage(item.id, actorId, role, text).then(onUpdate)
            }}
            className="absolute right-1.5 top-1/2 flex h-8 w-14 -translate-y-1/2 items-center justify-center whitespace-nowrap rounded-xl bg-[#4C1FB8] text-xs font-black text-white"
          >
            전송
          </button>
        </div>
      </section>
    </div>
  )
}
