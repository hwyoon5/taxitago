import type { LostItem, SosAlert, SupportTicket } from '@/lib/support-types'

type SupportDb = {
  sos: Map<string, SosAlert>
  lost: Map<string, LostItem>
  tickets: Map<string, SupportTicket>
}

function db(): SupportDb {
  const globalStore = globalThis as typeof globalThis & { __taxitagoSupport?: SupportDb }
  if (!globalStore.__taxitagoSupport) {
    globalStore.__taxitagoSupport = {
      sos: new Map(),
      lost: new Map(),
      tickets: new Map(),
    }
  }
  return globalStore.__taxitagoSupport
}

export function saveSos(alert: SosAlert) {
  db().sos.set(alert.id, alert)
  return alert
}

export function getSos(id: string) {
  return db().sos.get(id) ?? null
}

export function listSos() {
  return [...db().sos.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function saveLostItem(item: LostItem) {
  db().lost.set(item.id, item)
  return item
}

export function getLostItem(id: string) {
  return db().lost.get(id) ?? null
}

export function listLostItems() {
  return [...db().lost.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function saveTicket(ticket: SupportTicket) {
  db().tickets.set(ticket.id, ticket)
  return ticket
}

export function getTicket(id: string) {
  return db().tickets.get(id) ?? null
}

export function listTickets() {
  return [...db().tickets.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
