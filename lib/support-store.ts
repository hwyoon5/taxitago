import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import type { LostItem, SosAlert, SupportTicket } from '@/lib/support-types'

type SupportDb = {
  sos: Map<string, SosAlert>
  lost: Map<string, LostItem>
  tickets: Map<string, SupportTicket>
  hydrated: boolean
}

type PersistShape = {
  sos?: SosAlert[]
  lost?: LostItem[]
  tickets?: SupportTicket[]
}

const persistFile = path.join(process.cwd(), 'data', 'support.json')

function db(): SupportDb {
  const globalStore = globalThis as typeof globalThis & { __taxitagoSupport?: SupportDb }
  if (!globalStore.__taxitagoSupport) {
    globalStore.__taxitagoSupport = {
      sos: new Map(),
      lost: new Map(),
      tickets: new Map(),
      hydrated: false,
    }
  }
  const store = globalStore.__taxitagoSupport
  if (!store.hydrated) hydrate(store)
  return store
}

function readPersisted(): PersistShape | null {
  try {
    if (!existsSync(persistFile)) return null
    return JSON.parse(readFileSync(persistFile, 'utf8')) as PersistShape
  } catch {
    return null
  }
}

function hydrate(store: SupportDb) {
  store.hydrated = true
  const parsed = readPersisted()
  if (!parsed) return
  for (const alert of parsed.sos ?? []) store.sos.set(alert.id, alert)
  for (const item of parsed.lost ?? []) store.lost.set(item.id, item)
  for (const ticket of parsed.tickets ?? []) store.tickets.set(ticket.id, ticket)
}

function newer(left?: string, right?: string) {
  return Date.parse(left || '') > Date.parse(right || '')
}

export function syncSupportFromDisk() {
  const store = db()
  const parsed = readPersisted()
  if (!parsed) return
  for (const alert of parsed.sos ?? []) {
    const current = store.sos.get(alert.id)
    if (!current || !newer(current.updatedAt, alert.updatedAt)) store.sos.set(alert.id, alert)
  }
  for (const item of parsed.lost ?? []) {
    const current = store.lost.get(item.id)
    if (!current || !newer(current.updatedAt, item.updatedAt)) store.lost.set(item.id, item)
  }
  for (const ticket of parsed.tickets ?? []) {
    const current = store.tickets.get(ticket.id)
    if (!current || !newer(current.updatedAt, ticket.updatedAt)) store.tickets.set(ticket.id, ticket)
  }
}

function persist() {
  const store = db()
  try {
    mkdirSync(path.dirname(persistFile), { recursive: true })
    const payload: PersistShape = {
      sos: [...store.sos.values()],
      lost: [...store.lost.values()],
      tickets: [...store.tickets.values()],
    }
    writeFileSync(persistFile, JSON.stringify(payload), 'utf8')
  } catch {
    undefined
  }
}

export function saveSos(alert: SosAlert) {
  db().sos.set(alert.id, alert)
  persist()
  return alert
}

export function getSos(id: string) {
  syncSupportFromDisk()
  return db().sos.get(id) ?? null
}

export function listSos() {
  syncSupportFromDisk()
  return [...db().sos.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function saveLostItem(item: LostItem) {
  db().lost.set(item.id, item)
  persist()
  return item
}

export function getLostItem(id: string) {
  syncSupportFromDisk()
  return db().lost.get(id) ?? null
}

export function listLostItems() {
  syncSupportFromDisk()
  return [...db().lost.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function saveTicket(ticket: SupportTicket) {
  db().tickets.set(ticket.id, ticket)
  persist()
  return ticket
}

export function getTicket(id: string) {
  syncSupportFromDisk()
  return db().tickets.get(id) ?? null
}

export function listTickets() {
  syncSupportFromDisk()
  return [...db().tickets.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
