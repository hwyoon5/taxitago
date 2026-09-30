import { getDriver, getRide, listRides, nowIso } from '@/lib/dispatch-store'
import { getPartnerLink } from '@/lib/partner-ledger-server'
import { autoReplyFor } from '@/lib/support-auto'
import { getLostItem, getSos, getTicket, listLostItems, listSos, listTickets, saveLostItem, saveSos, saveTicket } from '@/lib/support-store'
import type {
  LostItem,
  LostItemType,
  LostKind,
  LostMessage,
  LostStatus,
  SosAlert,
  SosStatus,
  SupportActor,
  SupportTicket,
  TicketCategory,
  TicketMessage,
  TicketStatus,
} from '@/lib/support-types'

function routeLabel(ride: NonNullable<ReturnType<typeof getRide>>) {
  const origin = ride.pickup.address || ride.pickup.label || '출발지'
  const dest = ride.dest.label || ride.dest.address || '목적지'
  return `${origin} → ${dest}`
}

function actorOnRide(ride: NonNullable<ReturnType<typeof getRide>>, actorId: string, role: Exclude<SupportActor, 'admin'>) {
  if (role === 'passenger') return ride.passengerId === actorId
  return ride.assignedDriverId === actorId
}

function serviceRoleLabel(role: string | undefined, serviceType: string | undefined) {
  if (role === '파트너') return serviceType ? `파트너 · ${serviceType}` : '파트너'
  if (serviceType === '대리운전') return '대리 기사'
  if (serviceType === '택배') return '택배 기사'
  return '택시 기사'
}

function reporterOf(userId: string, userRole: SupportActor) {
  const link = getPartnerLink(userId)
  const driver = userRole === 'driver' ? getDriver(userId) : null
  const label = link ? serviceRoleLabel(link.role, link.serviceType) : userRole === 'driver' ? '택시 기사' : '이용자(승객)'
  return { label, name: link?.name || driver?.name || '', phone: link?.phone || '' }
}

export async function raiseSosAlert(input: {
  rideId: string
  fromId: string
  fromRole: Exclude<SupportActor, 'admin'>
  lat: number
  lng: number
  accuracyM?: number | null
  note?: string
}) {
  const ride = getRide(input.rideId)
  if (!ride) return { ok: false as const, error: 'not_found', alert: null as SosAlert | null }
  if (!['assigned', 'completed', 'offered'].includes(ride.status)) {
    return { ok: false as const, error: 'not_in_trip', alert: null }
  }
  if (!actorOnRide(ride, input.fromId, input.fromRole)) {
    return { ok: false as const, error: 'forbidden', alert: null }
  }
  const existing = (await listSos()).find((item) => item.rideId === input.rideId && item.fromId === input.fromId && item.status !== 'resolved')
  if (existing) return { ok: true as const, alert: existing, duplicate: true }
  const driver = ride.assignedDriverId ? getDriver(ride.assignedDriverId) : null
  const alert = await saveSos({
    id: crypto.randomUUID(),
    rideId: ride.id,
    fromId: input.fromId,
    fromRole: input.fromRole,
    lat: input.lat,
    lng: input.lng,
    accuracyM: input.accuracyM ?? null,
    vehicle: driver?.vehicle || '택시',
    plate: driver?.plate || '',
    driverName: driver?.name || '',
    driverId: ride.assignedDriverId,
    passengerId: ride.passengerId,
    route: routeLabel(ride),
    note: (input.note ?? '').trim().slice(0, 200),
    status: 'open',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  })
  return { ok: true as const, alert, duplicate: false }
}

export async function updateSosStatus(id: string, status: SosStatus) {
  const alert = await getSos(id)
  if (!alert) return null
  return saveSos({ ...alert, status, updatedAt: nowIso() })
}

export async function sosInbox(filter: { actorId?: string; role?: SupportActor; openOnly?: boolean }) {
  return (await listSos()).filter((item) => {
    if (filter.openOnly && item.status === 'resolved') return false
    if (filter.role === 'driver' && filter.actorId) return item.driverId === filter.actorId
    if (filter.role === 'passenger' && filter.actorId) return item.passengerId === filter.actorId || item.fromId === filter.actorId
    return true
  })
}

export function ridesForLostAndFound(userId: string, role: Exclude<SupportActor, 'admin'>) {
  return listRides()
    .filter((ride) => {
      if (role === 'passenger') return ride.passengerId === userId
      return ride.assignedDriverId === userId
    })
    .filter((ride) => ride.status === 'completed' || ride.status === 'assigned')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 20)
    .map((ride) => {
      const driver = ride.assignedDriverId ? getDriver(ride.assignedDriverId) : null
      return {
        id: ride.id,
        status: ride.status,
        route: routeLabel(ride),
        occurredHint: ride.updatedAt,
        driverId: ride.assignedDriverId,
        driverName: driver?.name || '',
        plate: driver?.plate || '',
        vehicle: driver?.vehicle || '택시',
        passengerId: ride.passengerId,
      }
    })
}

export async function fileLostItem(input: {
  kind: LostKind
  itemType: LostItemType
  description?: string
  occurredAt?: string
  rideId?: string
  reporterId: string
  reporterRole: Exclude<SupportActor, 'admin'>
  route?: string
  driverName?: string
  plate?: string
  vehicle?: string
}) {
  const ride = input.rideId ? getRide(input.rideId) : null
  if (input.rideId && ride && !actorOnRide(ride, input.reporterId, input.reporterRole)) {
    return { ok: false as const, error: 'forbidden', item: null as LostItem | null }
  }
  const driver = ride?.assignedDriverId ? getDriver(ride.assignedDriverId) : null
  const matched = Boolean(ride?.assignedDriverId)
  const item = await saveLostItem({
    id: crypto.randomUUID(),
    kind: input.kind,
    itemType: input.itemType,
    description: (input.description ?? '').trim().slice(0, 400),
    occurredAt: input.occurredAt || nowIso(),
    rideId: ride?.id ?? input.rideId ?? null,
    route: ride ? routeLabel(ride) : (input.route ?? '').trim() || '운행 미지정',
    reporterId: input.reporterId,
    reporterRole: input.reporterRole,
    driverId: ride?.assignedDriverId ?? null,
    driverName: driver?.name || input.driverName || '',
    passengerId: ride?.passengerId ?? (input.reporterRole === 'passenger' ? input.reporterId : null),
    plate: driver?.plate || input.plate || '',
    vehicle: driver?.vehicle || input.vehicle || '택시',
    status: matched ? 'matched' : 'open',
    messages: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  })
  return { ok: true as const, item }
}

export async function lostInbox(filter: { actorId: string; role: SupportActor }) {
  return (await listLostItems())
    .filter((item) => {
      if (filter.role === 'admin') return true
      if (item.reporterId === filter.actorId) return true
      if (filter.role === 'driver' && item.driverId === filter.actorId) return true
      if (filter.role === 'passenger' && item.passengerId === filter.actorId) return true
      return false
    })
    .map((item) => ({ ...item, reporter: reporterOf(item.reporterId, item.reporterRole) }))
}

function canTalkLost(item: LostItem, actorId: string, role: SupportActor) {
  if (role === 'admin') return true
  if (item.reporterId === actorId) return true
  if (role === 'driver' && item.driverId === actorId) return true
  if (role === 'passenger' && item.passengerId === actorId) return true
  return false
}

export async function postLostMessage(input: { itemId: string; actorId: string; role: SupportActor; text: string }) {
  const item = await getLostItem(input.itemId)
  if (!item) return { ok: false as const, error: 'not_found', item: null as LostItem | null }
  if (!canTalkLost(item, input.actorId, input.role)) return { ok: false as const, error: 'forbidden', item: null }
  const text = input.text.trim().slice(0, 400)
  if (!text) return { ok: false as const, error: 'empty', item: null }
  const message: LostMessage = {
    id: crypto.randomUUID(),
    itemId: item.id,
    fromId: input.actorId,
    fromRole: input.role,
    text,
    at: nowIso(),
  }
  const next = await saveLostItem({
    ...item,
    messages: [...item.messages, message],
    status: item.status === 'open' || item.status === 'matched' ? 'talking' : item.status,
    updatedAt: nowIso(),
  })
  return { ok: true as const, item: next, message }
}

const LOST_TRANSITIONS: Record<LostStatus, { from: LostStatus[]; roles: SupportActor[] }> = {
  open: { from: ['matched', 'talking'], roles: ['admin'] },
  matched: { from: ['open'], roles: ['admin'] },
  talking: { from: ['open', 'matched'], roles: ['passenger', 'driver', 'admin'] },
  returned: { from: ['matched', 'talking'], roles: ['passenger', 'driver', 'admin'] },
  closed: { from: ['open', 'matched', 'talking', 'returned'], roles: ['passenger', 'driver', 'admin'] },
}

export async function updateLostStatus(id: string, status: LostStatus, actorId: string, role: SupportActor) {
  const item = await getLostItem(id)
  if (!item) return { ok: false as const, error: 'not_found', item: null as LostItem | null }
  if (!canTalkLost(item, actorId, role)) return { ok: false as const, error: 'forbidden', item: null }
  const rule = LOST_TRANSITIONS[status]
  if (!rule?.from.includes(item.status)) return { ok: false as const, error: 'invalid_transition', item }
  if (!rule.roles.includes(role)) return { ok: false as const, error: 'forbidden', item: null }
  return { ok: true as const, item: await saveLostItem({ ...item, status, updatedAt: nowIso() }) }
}

export async function createSupportTicket(input: {
  userId: string
  userRole: Exclude<SupportActor, 'admin'>
  category: TicketCategory
  subject?: string
  body: string
  rideId?: string
}) {
  const body = input.body.trim().slice(0, 800)
  if (!body) return { ok: false as const, error: 'empty', ticket: null as SupportTicket | null }
  const subject = (input.subject ?? '').trim().slice(0, 80) || body.slice(0, 24)
  const auto = autoReplyFor({ category: input.category, subject, body })
  const first: TicketMessage = {
    id: crypto.randomUUID(),
    ticketId: '',
    fromId: input.userId,
    fromRole: input.userRole,
    text: body,
    at: nowIso(),
  }
  const ticketId = crypto.randomUUID()
  first.ticketId = ticketId
  const messages: TicketMessage[] = [first]
  if (auto) {
    messages.push({
      id: crypto.randomUUID(),
      ticketId,
      fromId: 'auto-support',
      fromRole: 'admin',
      text: auto,
      at: nowIso(),
      auto: true,
    })
  }
  const saved = await saveTicket({
    id: ticketId,
    userId: input.userId,
    userRole: input.userRole,
    category: input.category,
    subject,
    body,
    rideId: input.rideId || null,
    status: auto ? 'resolved' : 'received',
    messages,
    autoResolved: Boolean(auto),
    needsReview: !auto,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  })
  return { ok: true as const, ticket: saved }
}

export async function ticketInbox(filter: { actorId?: string; role?: SupportActor }) {
  const tickets =
    filter.role === 'admin' || !filter.actorId
      ? await listTickets()
      : (await listTickets()).filter((item) => item.userId === filter.actorId)
  return tickets.map((item) => ({ ...item, reporter: reporterOf(item.userId, item.userRole) }))
}

export async function postTicketMessage(input: { ticketId: string; actorId: string; role: SupportActor; text: string }) {
  const ticket = await getTicket(input.ticketId)
  if (!ticket) return { ok: false as const, error: 'not_found', ticket: null as SupportTicket | null }
  if (input.role !== 'admin' && ticket.userId !== input.actorId) {
    return { ok: false as const, error: 'forbidden', ticket: null }
  }
  const text = input.text.trim().slice(0, 800)
  if (!text) return { ok: false as const, error: 'empty', ticket: null }
  const message: TicketMessage = {
    id: crypto.randomUUID(),
    ticketId: ticket.id,
    fromId: input.actorId,
    fromRole: input.role,
    text,
    at: nowIso(),
  }
  const status: TicketStatus =
    input.role === 'admin'
      ? 'resolved'
      : ticket.status === 'in_progress' || ticket.status === 'resolved'
        ? 'waiting'
        : ticket.status
  const needsReview =
    input.role === 'admin' ? false : ticket.autoResolved || ticket.needsReview === true ? true : ticket.needsReview
  const next = await saveTicket({
    ...ticket,
    messages: [...ticket.messages, message],
    status,
    needsReview,
    updatedAt: nowIso(),
  })
  return { ok: true as const, ticket: next, message }
}

export async function editTicketMessage(input: { ticketId: string; messageId: string; role: SupportActor; text: string }) {
  if (input.role !== 'admin') return { ok: false as const, error: 'forbidden', ticket: null as SupportTicket | null }
  const ticket = await getTicket(input.ticketId)
  if (!ticket) return { ok: false as const, error: 'not_found', ticket: null }
  const text = input.text.trim().slice(0, 800)
  if (!text) return { ok: false as const, error: 'empty', ticket: null }
  const message = ticket.messages.find((item) => item.id === input.messageId && item.fromRole === 'admin')
  if (!message) return { ok: false as const, error: 'not_found', ticket: null }
  message.text = text
  message.editedAt = nowIso()
  const next = await saveTicket({ ...ticket, updatedAt: message.editedAt })
  return { ok: true as const, ticket: next }
}

export async function setTicketStatus(id: string, status: TicketStatus) {
  const ticket = await getTicket(id)
  if (!ticket) return null
  return saveTicket({ ...ticket, status, updatedAt: nowIso() })
}
