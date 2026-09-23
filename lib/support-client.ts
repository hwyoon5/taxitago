import { apiFetch } from '@/lib/app-origin'
import type {
  LostItem,
  LostItemType,
  LostKind,
  LostStatus,
  SosAlert,
  SosStatus,
  SupportActor,
  SupportTicket,
  TicketCategory,
  TicketStatus,
} from '@/lib/support-types'

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

export async function raiseSos(input: {
  rideId: string
  fromId: string
  fromRole: Exclude<SupportActor, 'admin'>
  lat: number
  lng: number
  accuracyM?: number | null
  note?: string
}) {
  const res = await apiFetch('/api/sos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await readJson<{ alert?: SosAlert; error?: string; duplicate?: boolean }>(res)
  if (!res.ok || !data.alert) throw new Error(data.error === 'not_in_trip' ? '운행 중에만 긴급 신고할 수 있어요.' : data.error || '긴급 신고에 실패했어요.')
  return data
}

export async function fetchSosInbox(actorId: string, role: SupportActor) {
  const res = await apiFetch(`/api/sos?actorId=${encodeURIComponent(actorId)}&role=${role}&open=1`, { cache: 'no-store' })
  const data = await readJson<{ alerts?: SosAlert[] }>(res)
  return data.alerts ?? []
}

export async function updateSos(id: string, status: SosStatus) {
  const res = await apiFetch(`/api/sos/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  const data = await readJson<{ alert?: SosAlert; error?: string }>(res)
  if (!res.ok || !data.alert) throw new Error(data.error || 'SOS 상태를 바꾸지 못했어요.')
  return data.alert
}

export async function fetchLostRides(userId: string, role: Exclude<SupportActor, 'admin'>) {
  const res = await apiFetch(`/api/lost-items/rides?userId=${encodeURIComponent(userId)}&role=${role}`, { cache: 'no-store' })
  const data = await readJson<{
    rides?: {
      id: string
      status: string
      route: string
      occurredHint: string
      driverId: string | null
      driverName: string
      plate: string
      vehicle: string
      passengerId: string
    }[]
  }>(res)
  return data.rides ?? []
}

export async function submitLostItem(input: {
  kind: LostKind
  itemType: LostItemType
  description: string
  occurredAt: string
  rideId?: string
  reporterId: string
  reporterRole: Exclude<SupportActor, 'admin'>
  route?: string
  driverName?: string
  plate?: string
  vehicle?: string
}) {
  const res = await apiFetch('/api/lost-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await readJson<{ item?: LostItem; error?: string }>(res)
  if (!res.ok || !data.item) throw new Error(data.error || '분실물 접수에 실패했어요.')
  return data.item
}

export async function fetchLostInbox(actorId: string, role: SupportActor) {
  const res = await apiFetch(`/api/lost-items?actorId=${encodeURIComponent(actorId)}&role=${role}`, { cache: 'no-store' })
  const data = await readJson<{ items?: LostItem[] }>(res)
  return data.items ?? []
}

export async function fetchLostItem(id: string) {
  const res = await apiFetch(`/api/lost-items/${encodeURIComponent(id)}`, { cache: 'no-store' })
  const data = await readJson<{ item?: LostItem; error?: string }>(res)
  if (!res.ok || !data.item) throw new Error(data.error || '분실물 접수를 찾지 못했어요.')
  return data.item
}

export async function sendLostMessage(itemId: string, actorId: string, role: SupportActor, text: string) {
  const res = await apiFetch(`/api/lost-items/${encodeURIComponent(itemId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId, role, text }),
  })
  const data = await readJson<{ item?: LostItem; error?: string }>(res)
  if (!res.ok || !data.item) throw new Error(data.error || '메시지를 보내지 못했어요.')
  return data.item
}

export async function setLostStatus(itemId: string, status: LostStatus, actorId: string, role: SupportActor) {
  const res = await apiFetch(`/api/lost-items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, actorId, role }),
  })
  const data = await readJson<{ item?: LostItem; error?: string }>(res)
  if (!res.ok || !data.item) throw new Error(data.error || '상태를 바꾸지 못했어요.')
  return data.item
}

export async function createTicket(input: {
  userId: string
  userRole: Exclude<SupportActor, 'admin'>
  category: TicketCategory
  subject?: string
  body: string
  rideId?: string
}) {
  const res = await apiFetch('/api/support/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await readJson<{ ticket?: SupportTicket; error?: string }>(res)
  if (!res.ok || !data.ticket) throw new Error(data.error || '문의 접수에 실패했어요.')
  return data.ticket
}

export async function fetchTickets(actorId: string, role: SupportActor) {
  const res = await apiFetch(`/api/support/tickets?actorId=${encodeURIComponent(actorId)}&role=${role}`, { cache: 'no-store' })
  const data = await readJson<{ tickets?: SupportTicket[] }>(res)
  return data.tickets ?? []
}

export async function sendTicketMessage(ticketId: string, actorId: string, role: SupportActor, text: string) {
  const res = await apiFetch(`/api/support/tickets/${encodeURIComponent(ticketId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId, role, text }),
  })
  const data = await readJson<{ ticket?: SupportTicket; error?: string }>(res)
  if (!res.ok || !data.ticket) throw new Error(data.error || '답변을 보내지 못했어요.')
  return data.ticket
}

export async function setTicketStatus(ticketId: string, status: TicketStatus) {
  const res = await apiFetch(`/api/support/tickets/${encodeURIComponent(ticketId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, role: 'admin' }),
  })
  const data = await readJson<{ ticket?: SupportTicket; error?: string }>(res)
  if (!res.ok || !data.ticket) throw new Error(data.error || '처리 상태를 바꾸지 못했어요.')
  return data.ticket
}
