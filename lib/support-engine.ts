import { getDriver, getRide, listRides, nowIso } from '@/lib/dispatch-store'
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

export function raiseSosAlert(input: {
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
  const existing = listSos().find((item) => item.rideId === input.rideId && item.fromId === input.fromId && item.status !== 'resolved')
  if (existing) return { ok: true as const, alert: existing, duplicate: true }
  const driver = ride.assignedDriverId ? getDriver(ride.assignedDriverId) : null
  const alert = saveSos({
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

export function updateSosStatus(id: string, status: SosStatus) {
  const alert = getSos(id)
  if (!alert) return null
  return saveSos({ ...alert, status, updatedAt: nowIso() })
}

export function sosInbox(filter: { actorId?: string; role?: SupportActor; openOnly?: boolean }) {
  return listSos().filter((item) => {
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

export function fileLostItem(input: {
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
  const item = saveLostItem({
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

export function lostInbox(filter: { actorId: string; role: SupportActor }) {
  return listLostItems().filter((item) => {
    if (filter.role === 'admin') return true
    if (item.reporterId === filter.actorId) return true
    if (filter.role === 'driver' && item.driverId === filter.actorId) return true
    if (filter.role === 'passenger' && item.passengerId === filter.actorId) return true
    return false
  })
}

function canTalkLost(item: LostItem, actorId: string, role: SupportActor) {
  if (role === 'admin') return true
  if (item.reporterId === actorId) return true
  if (role === 'driver' && item.driverId === actorId) return true
  if (role === 'passenger' && item.passengerId === actorId) return true
  return false
}

export function postLostMessage(input: { itemId: string; actorId: string; role: SupportActor; text: string }) {
  const item = getLostItem(input.itemId)
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
  const next = saveLostItem({
    ...item,
    messages: [...item.messages, message],
    status: item.status === 'open' || item.status === 'matched' ? 'talking' : item.status,
    updatedAt: nowIso(),
  })
  return { ok: true as const, item: next, message }
}

export function updateLostStatus(id: string, status: LostStatus, actorId: string, role: SupportActor) {
  const item = getLostItem(id)
  if (!item) return null
  if (!canTalkLost(item, actorId, role)) return null
  return saveLostItem({ ...item, status, updatedAt: nowIso() })
}

export function createSupportTicket(input: {
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
  const first: TicketMessage = {
    id: crypto.randomUUID(),
    ticketId: '',
    fromId: input.userId,
    fromRole: input.userRole,
    text: body,
    at: nowIso(),
  }
  const ticket = saveTicket({
    id: crypto.randomUUID(),
    userId: input.userId,
    userRole: input.userRole,
    category: input.category,
    subject,
    body,
    rideId: input.rideId || null,
    status: 'received',
    messages: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  })
  first.ticketId = ticket.id
  const saved = saveTicket({ ...ticket, messages: [first] })
  return { ok: true as const, ticket: saved }
}

export function ticketInbox(filter: { actorId?: string; role?: SupportActor }) {
  if (filter.role === 'admin' || !filter.actorId) return listTickets()
  return listTickets().filter((item) => item.userId === filter.actorId)
}

export function postTicketMessage(input: { ticketId: string; actorId: string; role: SupportActor; text: string }) {
  const ticket = getTicket(input.ticketId)
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
  const status: TicketStatus = input.role === 'admin' ? 'in_progress' : ticket.status === 'in_progress' ? 'waiting' : ticket.status
  const next = saveTicket({
    ...ticket,
    messages: [...ticket.messages, message],
    status,
    updatedAt: nowIso(),
  })
  return { ok: true as const, ticket: next, message }
}

export function setTicketStatus(id: string, status: TicketStatus) {
  const ticket = getTicket(id)
  if (!ticket) return null
  return saveTicket({ ...ticket, status, updatedAt: nowIso() })
}
