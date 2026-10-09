'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useAdminAuth } from '@/components/admin-guard'
import { getAdminKey } from '@/lib/admin-key'
import AdminPartners from '@/components/admin-partners'
import AdminSettlements from '@/components/admin-settlements'
import AdminFareSettings from '@/components/admin-fare-settings'
import AdminStaff from '@/components/admin-staff'
import AdminUsers from '@/components/admin-users'
import AdminNotepad from '@/components/admin-notepad'
import AdminAuditLog from '@/components/admin-audit-log'
import AttachmentGallery from '@/components/photo-gallery'
import { positionDisplayLabel } from '@/lib/staff-positions'
import {
  editTicketReply,
  fetchAdminInbox,
  fetchLostInbox,
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

const SELECTION_KEY = 'taxitago.admin.selection'
const DRAFT_PREFIX = 'taxitago.admin.draft.'

function loadDraft(kind: 'ticket' | 'lost', id: string) {
  try {
    return window.sessionStorage.getItem(`${DRAFT_PREFIX}${kind}:${id}`)
  } catch {
    return null
  }
}

function saveDraft(kind: 'ticket' | 'lost', id: string, text: string) {
  try {
    if (text) window.sessionStorage.setItem(`${DRAFT_PREFIX}${kind}:${id}`, text)
    else window.sessionStorage.removeItem(`${DRAFT_PREFIX}${kind}:${id}`)
  } catch {
    undefined
  }
}

function loadSelection(): { kind: 'ticket' | 'lost'; id: string } | null {
  try {
    const raw = window.sessionStorage.getItem(SELECTION_KEY)
    const parsed = raw ? (JSON.parse(raw) as { kind?: string; id?: string }) : null
    if ((parsed?.kind === 'ticket' || parsed?.kind === 'lost') && typeof parsed.id === 'string') {
      return { kind: parsed.kind, id: parsed.id }
    }
  } catch {
    undefined
  }
  return null
}

function saveSelection(kind: 'ticket' | 'lost', id: string) {
  try {
    window.sessionStorage.setItem(SELECTION_KEY, JSON.stringify({ kind, id }))
  } catch {
    undefined
  }
}

function clearAdminWork() {
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = window.sessionStorage.key(i)
      if (key && (key === SELECTION_KEY || key.startsWith(DRAFT_PREFIX))) window.sessionStorage.removeItem(key)
    }
  } catch {
    undefined
  }
}

export default function AdminSupportDesk() {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [lost, setLost] = useState<LostItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [kind, setKind] = useState<'ticket' | 'lost'>('ticket')
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [freshIds, setFreshIds] = useState<string[]>([])
  const [notifEnabled, setNotifEnabled] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastSync, setLastSync] = useState('')
  const [storage, setStorage] = useState<'kv' | 'file' | null>(null)
  const [view, setView] = useState<'inbox' | 'users' | 'partners' | 'fare' | 'ledger' | 'staff' | 'audit' | 'memo'>('inbox')
  const seenRef = useRef<Set<string> | null>(null)
  const { logout, actor } = useAdminAuth()

  const reload = () => {
    setRefreshing(true)
    void Promise.allSettled([fetchAdminInbox(ADMIN_ID), fetchLostInbox(ADMIN_ID, 'admin')]).then(
      ([ticketResult, lostResult]) => {
        const denied =
          (ticketResult.status === 'rejected' && ticketResult.reason instanceof Error && ticketResult.reason.message === 'unauthorized') ||
          (lostResult.status === 'rejected' && lostResult.reason instanceof Error && lostResult.reason.message === 'unauthorized')
        if (denied) {
          setRefreshing(false)
          logout()
          return
        }
        const nextTickets = ticketResult.status === 'fulfilled' ? ticketResult.value.tickets : []
        const nextLost = lostResult.status === 'fulfilled' ? lostResult.value : []
        if (ticketResult.status === 'fulfilled') setStorage(ticketResult.value.storage)
        setTickets(nextTickets)
        setLost(nextLost)
        setRefreshing(false)
        setLastSync(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }))
        const current = new Set([...nextTickets.map((row) => `t:${row.id}`), ...nextLost.map((row) => `l:${row.id}`)])
        if (seenRef.current === null) {
          seenRef.current = current
          const saved = loadSelection()
          if (saved?.kind === 'ticket') {
            const found = nextTickets.find((row) => row.id === saved.id)
            if (found) openTicket(found)
          } else if (saved?.kind === 'lost') {
            const found = nextLost.find((row) => row.id === saved.id)
            if (found) openLost(found)
          }
          return
        }
        const arrived = [...current].filter((id) => !seenRef.current!.has(id))
        seenRef.current = current
        if (arrived.length) {
          setFreshIds((prev) => [...new Set([...prev, ...arrived])])
          const first = arrived[0]
          const source = first.startsWith('t:')
            ? nextTickets.find((row) => `t:${row.id}` === first)
            : nextLost.find((row) => `l:${row.id}` === first)
          const title = source && 'subject' in source ? source.subject : source && 'itemType' in source ? `분실물 · ${source.itemType}` : '새 문의'
          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(`택시타고 ${arrived.length > 1 ? `새 문의 ${arrived.length}건` : '새 문의'}`, { body: title })
          }
        }
      },
    )
  }

  useEffect(() => {
    reload()
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifEnabled(Notification.permission === 'granted')
    }
  }, [])

  const ticket = tickets.find((item) => kind === 'ticket' && item.id === selectedId) ?? null
  const item = lost.find((row) => kind === 'lost' && row.id === selectedId) ?? null
  const latestAdmin = ticket?.messages.filter((message) => message.fromRole === 'admin').at(-1) ?? null
  const needsAdmin = (row: SupportTicket) =>
    row.status !== 'closed' &&
    row.status !== 'resolved' &&
    (row.needsReview === true || row.status === 'received' || row.status === 'waiting')
  const pendingTickets = tickets.filter(needsAdmin)
  const otherTickets = tickets.filter((row) => !needsAdmin(row))
  const pendingCount = pendingTickets.length + lost.filter((row) => row.status === 'open').length

  const openTicket = (next: SupportTicket) => {
    setKind('ticket')
    setSelectedId(next.id)
    saveSelection('ticket', next.id)
    setFreshIds((prev) => prev.filter((id) => id !== `t:${next.id}`))
    const reply = next.messages.filter((message) => message.fromRole === 'admin').at(-1)
    const stored = loadDraft('ticket', next.id)
    setDraft(stored ?? reply?.text ?? '')
    setEditing(stored == null ? Boolean(reply) : stored === (reply?.text ?? ''))
  }
  const openLost = (next: LostItem) => {
    setKind('lost')
    setSelectedId(next.id)
    saveSelection('lost', next.id)
    setFreshIds((prev) => prev.filter((id) => id !== `l:${next.id}`))
    const reply = [...next.messages].reverse().find((message) => message.fromRole === 'admin')
    const stored = loadDraft('lost', next.id)
    setDraft(stored ?? reply?.text ?? '')
    setEditing(false)
  }
  const updateDraft = (value: string) => {
    setDraft(value)
    if (selectedId) saveDraft(kind, selectedId, value)
  }
  const tell = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }
  const guard = (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message === 'unauthorized') {
      logout()
      return
    }
    const message = error instanceof Error ? error.message : ''
    if (message === 'not_found') {
      tell('서버에서 해당 문의를 찾지 못했습니다. 영구 저장소 연결 상태를 확인한 뒤 새로고침해 주세요.')
      return
    }
    tell(message || fallback)
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
        saveDraft('ticket', next.id, text)
        tell(editing && latestAdmin ? '답변을 수정했습니다.' : '답변을 등록했습니다.')
      })
      .catch((error) => guard(error, '답변을 저장하지 못했어요.'))
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
        updateDraft('')
        tell('분실물 답변을 등록했습니다.')
      })
      .catch((error) => guard(error, '답변을 저장하지 못했어요.'))
      .finally(() => setBusy(false))
  }

  const roleBadge = (label: string) => {
    const tone = label.includes('기사')
      ? 'bg-[#DBEAFE] text-[#1D4ED8]'
      : label.startsWith('파트너')
        ? 'bg-[#DCFCE7] text-[#15803D]'
        : 'bg-[#F1F5F9] text-[#475569]'
    return <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${tone}`}>{label}</span>
  }
  const reporterLine = (reporter: SupportTicket['reporter'] | undefined, id: string) =>
    `${reporter?.name ? `${reporter.name} · ` : ''}${id}${reporter?.phone ? ` · ${reporter.phone}` : ''}`

  const ticketCard = (row: SupportTicket, pending: boolean) => (
    <button key={row.id} type="button" onClick={() => openTicket(row)} className={`w-full rounded-2xl border-2 bg-white p-3 text-left ${pending ? 'border-[#FCA5A5]' : 'border-[#CBD5E1]'} ${selectedId === row.id && kind === 'ticket' ? 'border-[#4C1FB8]' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-black text-[#4C1FB8]">
          {roleBadge(row.reporter?.label ?? (row.userRole === 'driver' ? '기사' : '이용자(승객)'))}
          {TICKET_CATEGORY_LABEL[row.category]}
          {pending ? <span className="rounded-full bg-[#DC2626] px-1.5 py-0.5 text-[9px] font-black text-white">확인 필요</span> : null}
          {row.autoResolved ? <span className="rounded-full bg-[#DCFCE7] px-1.5 py-0.5 text-[9px] font-black text-[#15803D]">자동 답변</span> : null}
          {freshIds.includes(`t:${row.id}`) ? <span className="rounded-full bg-[#DC2626] px-1.5 py-0.5 text-[9px] font-black text-white">NEW</span> : null}
        </p>
        <span className="rounded-full bg-[#F8F5FF] px-2 py-0.5 text-[10px] font-black text-[#4C1FB8]">{TICKET_STATUS_LABEL[row.status]}</span>
      </div>
      <p className="mt-1 text-sm font-black">{row.subject}</p>
      <p className="mt-1 line-clamp-2 text-xs font-bold text-[#64748B]">{row.body}</p>
      <p className="mt-1 text-[11px] font-bold text-[#64748B]">{reporterLine(row.reporter, row.userId)}</p>
    </button>
  )

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl bg-[#F8FAFC] px-4 py-6 text-[#0F172A]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black text-[#4C1FB8]">ADMIN</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-black">
            문의 관리
            {pendingCount ? (
              <span className="rounded-full bg-[#DC2626] px-2 py-0.5 text-xs font-black text-white">미처리 {pendingCount}</span>
            ) : null}
          </h1>
          <p className="mt-1 text-sm font-bold text-[#64748B]">1:1 문의와 분실물 접수를 확인하고 답변을 남깁니다.</p>
          {actor ? (
            <p className="mt-1 text-[11px] font-black text-[#4C1FB8]">
              로그인: {actor.staffName}({actor.staffId}) · {actor.position ? positionDisplayLabel(actor.position) : actor.role === 'master' ? '최고 관리자' : actor.role === 'manager' ? '매니저' : '직원'}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reload}
            disabled={refreshing}
            className="rounded-full border-2 border-[#D8CCF5] bg-white px-3 py-2 text-xs font-black text-[#4C1FB8] disabled:opacity-60"
          >
            {refreshing ? '새로고침 중…' : '새로고침'}
          </button>
          {typeof window !== 'undefined' && 'Notification' in window && !notifEnabled && Notification.permission === 'default' ? (
            <button
              type="button"
              onClick={() => {
                void Notification.requestPermission().then((permission) => setNotifEnabled(permission === 'granted'))
              }}
              className="rounded-full border-2 border-[#D8CCF5] bg-white px-3 py-2 text-xs font-black text-[#4C1FB8]"
            >
              알림 켜기
            </button>
          ) : null}
          {getAdminKey() ? (
            <button
              type="button"
              onClick={() => {
                clearAdminWork()
                logout()
              }}
              className="rounded-full border-2 border-[#CBD5E1] bg-white px-3 py-2 text-xs font-black text-[#475569]"
            >
              로그아웃
            </button>
          ) : null}
          <Link href="/" className="rounded-full bg-white px-3 py-2 text-xs font-black text-[#4C1FB8]">홈</Link>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 rounded-2xl bg-[#EDE9FE] p-1">
        {(['inbox', 'users', 'partners', 'fare', 'ledger', 'staff', 'audit', 'memo'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setView(tab)}
            className={`rounded-xl py-2 text-xs font-black ${view === tab ? 'bg-white text-[#4C1FB8] shadow-sm' : 'text-[#64748B]'}`}
          >
            {tab === 'inbox'
              ? '문의 관리'
              : tab === 'users'
                ? '가입자'
                : tab === 'partners'
                  ? '기사·파트너'
                : tab === 'fare'
                  ? '수수료 설정'
                  : tab === 'ledger'
                    ? '정산 내역'
                    : tab === 'staff'
                      ? '직원 관리'
                      : tab === 'memo'
                        ? '메모장'
                        : '업무 기록'}
          </button>
        ))}
      </div>
      {view === 'partners' ? (
        <div className="mt-4">
          <AdminPartners />
        </div>
      ) : view === 'users' ? (
        <AdminUsers />
      ) : view === 'fare' ? (
        <AdminFareSettings />
      ) : view === 'ledger' ? (
        <AdminSettlements />
      ) : view === 'staff' ? (
        <AdminStaff />
      ) : view === 'audit' ? (
        <AdminAuditLog />
      ) : view === 'memo' ? (
        <AdminNotepad />
      ) : (
      <>
      {storage === 'file' ? (
        <p className="mt-3 rounded-2xl border-2 border-[#F59E0B] bg-[#FFFBEB] px-4 py-3 text-xs font-bold leading-5 text-[#92400E]">
          영구 저장소(KV)가 연결되지 않았습니다. 이 환경에서는 새로고침·재배포 후 문의가 사라질 수 있습니다. Vercel 대시보드에서 KV(또는 Upstash Redis)를 연결하고 KV_REST_API_URL / KV_REST_API_TOKEN을 설정해 주세요.
        </p>
      ) : null}
      {freshIds.length ? (
        <button
          type="button"
          onClick={() => {
            const first = freshIds[0]
            setFreshIds((prev) => prev.slice(1))
            if (first.startsWith('t:')) {
              const found = tickets.find((row) => `t:${row.id}` === first)
              if (found) openTicket(found)
            } else {
              const found = lost.find((row) => `l:${row.id}` === first)
              if (found) openLost(found)
            }
          }}
          className="mt-3 w-full rounded-2xl bg-[#DC2626] py-2.5 text-xs font-black text-white"
        >
          새로 접수된 문의 {freshIds.length}건 — 눌러서 확인
        </button>
      ) : null}
      {notice ? <p className="mt-3 rounded-full bg-[#0F172A] px-3 py-2 text-center text-xs font-black text-white">{notice}</p> : null}
      <div className="mt-4 grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-2">
          <p className="flex items-center justify-between text-xs font-black text-[#4C1FB8]">
            <span>접수 목록 · {tickets.length + lost.length}건</span>
            {lastSync ? <span className="font-bold text-[#94A3B8]">마지막 새로고침 {lastSync}</span> : null}
          </p>
          {tickets.length + lost.length === 0 ? (
            <p className="rounded-2xl border-2 border-dashed border-[#CBD5E1] bg-white p-5 text-center text-sm font-bold text-[#64748B]">아직 접수된 문의가 없습니다.</p>
          ) : null}
          {pendingTickets.length ? (
            <div className="space-y-2 rounded-2xl border-2 border-[#FCA5A5] bg-[#FEF2F2] p-2">
              <p className="px-1 text-[11px] font-black text-[#DC2626]">관리자 확인 필요 · {pendingTickets.length}건</p>
              {pendingTickets.map((row) => ticketCard(row, true))}
            </div>
          ) : null}
          {otherTickets.map((row) => ticketCard(row, false))}
          {lost.map((row) => (
            <button key={row.id} type="button" onClick={() => openLost(row)} className={`w-full rounded-2xl border-2 bg-white p-3 text-left ${selectedId === row.id && kind === 'lost' ? 'border-[#4C1FB8]' : 'border-[#CBD5E1]'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[11px] font-black text-[#4C1FB8]">
                  {roleBadge(row.reporter?.label ?? (row.reporterRole === 'driver' ? '기사' : '이용자(승객)'))}
                  분실물 · {row.kind === 'lost' ? '분실' : '습득'}
                  {freshIds.includes(`l:${row.id}`) ? <span className="rounded-full bg-[#DC2626] px-1.5 py-0.5 text-[9px] font-black text-white">NEW</span> : null}
                </p>
                <span className="rounded-full bg-[#F8F5FF] px-2 py-0.5 text-[10px] font-black text-[#4C1FB8]">{LOST_STATUS_LABEL[row.status]}</span>
              </div>
              <p className="mt-1 text-sm font-black">{row.itemType}</p>
              <p className="mt-1 line-clamp-2 text-xs font-bold text-[#64748B]">{row.description || row.route}</p>
              <p className="mt-1 text-[11px] font-bold text-[#64748B]">{reporterLine(row.reporter, row.reporterId)}</p>
            </button>
          ))}
        </section>
        <section className="rounded-[24px] border-2 border-[#CBD5E1] bg-white p-4">
          {!ticket && !item ? <p className="text-sm font-bold text-[#64748B]">왼쪽 목록에서 문의를 선택해 주세요.</p> : null}
          {ticket ? (
            <div>
              <p className="text-xs font-black text-[#4C1FB8]">
                {TICKET_CATEGORY_LABEL[ticket.category]} · {TICKET_STATUS_LABEL[ticket.status]}
                {ticket.autoResolved ? ' · 자동 답변 완료' : ''}
              </p>
              <h2 className="mt-1 text-lg font-black">{ticket.subject}</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-[#334155]">{ticket.body}</p>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-[#64748B]">
                {roleBadge(ticket.reporter?.label ?? (ticket.userRole === 'driver' ? '기사' : '이용자(승객)'))}
                {reporterLine(ticket.reporter, ticket.userId)}
              </p>
              <AttachmentGallery entityId={ticket.id} photoCount={ticket.photoCount} />
              <select
                value={ticket.status}
                onChange={(event) => {
                  void setTicketStatus(ticket.id, event.target.value as TicketStatus)
                    .then((next) => {
                      setTickets((rows) => rows.map((row) => (row.id === next.id ? next : row)))
                      tell('상태를 바꿨습니다.')
                    })
                    .catch((error) => guard(error, '상태를 바꾸지 못했어요.'))
                }}
                className="mt-3 w-full rounded-xl border border-[#D8CCF5] px-2 py-2 text-xs font-black text-[#4C1FB8]"
              >
                {STATUSES.map((status) => <option key={status} value={status}>{TICKET_STATUS_LABEL[status]}</option>)}
              </select>
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                {ticket.messages.map((message) => (
                  <div key={message.id} className={`rounded-2xl px-3 py-2 text-sm font-bold ${message.fromRole === 'admin' ? 'bg-[#F8F5FF] text-[#4C1FB8]' : 'bg-[#F1F5F9] text-[#0F172A]'}`}>
                    <p className="text-[10px] font-black">{message.fromRole === 'admin' ? (message.auto ? '자동 답변' : '관리자 답변') : '고객'}</p>
                    <p className="mt-1 leading-5">{message.text}</p>
                    {message.editedAt ? <p className="mt-1 text-[10px] font-bold text-[#8b8495]">수정됨</p> : null}
                  </div>
                ))}
              </div>
              <textarea value={draft} onChange={(event) => updateDraft(event.target.value)} rows={4} placeholder={latestAdmin ? '등록한 답변을 수정하거나 새 답변을 작성' : '답변을 작성하세요'} className="mt-3 w-full rounded-2xl border-2 border-[#CBD5E1] px-3 py-3 text-sm font-bold outline-none" />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" disabled={busy} onClick={() => { setEditing(false); updateDraft(''); }} className="rounded-2xl border-2 border-[#CBD5E1] py-2.5 text-xs font-black text-[#475569]">새 답변</button>
                <button type="button" disabled={busy} onClick={saveTicketReply} className="rounded-2xl bg-[#4C1FB8] py-2.5 text-xs font-black text-white disabled:opacity-60">{busy ? '저장 중…' : editing && latestAdmin ? '답변 수정' : '답변 등록'}</button>
              </div>
            </div>
          ) : null}
          {item ? (
            <div>
              <p className="text-xs font-black text-[#4C1FB8]">분실물 · {LOST_STATUS_LABEL[item.status]}</p>
              <h2 className="mt-1 text-lg font-black">{item.itemType}</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-[#334155]">{item.description || item.route}</p>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-[#64748B]">
                {roleBadge(item.reporter?.label ?? (item.reporterRole === 'driver' ? '기사' : '이용자(승객)'))}
                {reporterLine(item.reporter, item.reporterId)}
              </p>
              <AttachmentGallery entityId={item.id} photoCount={item.photoCount} />
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                {item.messages.map((message) => (
                  <div key={message.id} className={`rounded-2xl px-3 py-2 text-sm font-bold ${message.fromRole === 'admin' ? 'bg-[#F8F5FF] text-[#4C1FB8]' : 'bg-[#F1F5F9]'}`}>
                    <p className="text-[10px] font-black">{message.fromRole === 'admin' ? '관리자 답변' : '고객'}</p>
                    <p className="mt-1 leading-5">{message.text}</p>
                  </div>
                ))}
              </div>
              <textarea value={draft} onChange={(event) => updateDraft(event.target.value)} rows={4} placeholder="분실물 답변" className="mt-3 w-full rounded-2xl border-2 border-[#CBD5E1] px-3 py-3 text-sm font-bold outline-none" />
              <button type="button" disabled={busy} onClick={saveLostReply} className="mt-2 w-full rounded-2xl bg-[#4C1FB8] py-2.5 text-xs font-black text-white disabled:opacity-60">{busy ? '저장 중…' : '답변 등록'}</button>
            </div>
          ) : null}
        </section>
      </div>
      </>
      )}
    </main>
  )
}
