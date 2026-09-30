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

type EntityKind = 'sos' | 'lost' | 'ticket'

const persistFile = path.join(process.cwd(), 'data', 'support.json')

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const entityKey = (kind: EntityKind, id: string) => `taxitago:support:${kind}:${id}`
const indexKey = (kind: EntityKind) => `taxitago:support:index:${kind}`

async function kvCommand<T>(command: (string | number)[]): Promise<T | null> {
  const res = await fetch(kvUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`kv request failed: ${res.status}`)
  const data = (await res.json()) as { result?: T | null }
  return data.result ?? null
}

async function kvSave<T extends { id: string }>(kind: EntityKind, value: T) {
  await kvCommand(['SET', entityKey(kind, value.id), JSON.stringify(value)])
  await kvCommand(['SADD', indexKey(kind), value.id])
}

async function kvGet<T>(kind: EntityKind, id: string): Promise<T | null> {
  const raw = await kvCommand<string | null>(['GET', entityKey(kind, id)])
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function kvList<T>(kind: EntityKind): Promise<T[]> {
  const ids = (await kvCommand<string[]>(['SMEMBERS', indexKey(kind)])) ?? []
  if (!ids.length) return []
  const raw = (await kvCommand<(string | null)[]>(['MGET', ...ids.map((id) => entityKey(kind, id))])) ?? []
  const items: T[] = []
  for (const value of raw) {
    if (!value) continue
    try {
      items.push(JSON.parse(value) as T)
    } catch {
      undefined
    }
  }
  return items
}

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

export async function saveSos(alert: SosAlert) {
  if (useKv) await kvSave('sos', alert)
  else {
    db().sos.set(alert.id, alert)
    persist()
  }
  return alert
}

export async function getSos(id: string) {
  if (useKv) return kvGet<SosAlert>('sos', id)
  syncSupportFromDisk()
  return db().sos.get(id) ?? null
}

export async function listSos() {
  if (useKv) return (await kvList<SosAlert>('sos')).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  syncSupportFromDisk()
  return [...db().sos.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function saveLostItem(item: LostItem) {
  if (useKv) await kvSave('lost', item)
  else {
    db().lost.set(item.id, item)
    persist()
  }
  return item
}

export async function getLostItem(id: string) {
  if (useKv) return kvGet<LostItem>('lost', id)
  syncSupportFromDisk()
  return db().lost.get(id) ?? null
}

export async function listLostItems() {
  if (useKv) return (await kvList<LostItem>('lost')).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  syncSupportFromDisk()
  return [...db().lost.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function saveTicket(ticket: SupportTicket) {
  if (useKv) await kvSave('ticket', ticket)
  else {
    db().tickets.set(ticket.id, ticket)
    persist()
  }
  return ticket
}

export async function getTicket(id: string) {
  if (useKv) return kvGet<SupportTicket>('ticket', id)
  syncSupportFromDisk()
  return db().tickets.get(id) ?? null
}

export async function listTickets() {
  if (useKv) return (await kvList<SupportTicket>('ticket')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  syncSupportFromDisk()
  return [...db().tickets.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
