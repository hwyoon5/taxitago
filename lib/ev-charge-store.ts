import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import type { EvChargeSession } from '@/lib/ev-charge-types'
import { kvCommand, kvConfigured, netFilePath, netKey } from '@/lib/kv'

type PersistShape = { sessions?: EvChargeSession[] }

const persistFile = netFilePath(path.join(process.cwd(), 'data', 'ev-charge.json'))
const useKv = kvConfigured
const kvKey = netKey('taxitago:ev-charge:sessions')

type Store = { sessions: Map<string, EvChargeSession>; hydrated: boolean }

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  charging: 1,
  cancelled: 2,
  settled: 2,
  refunded: 2,
}

function shouldReplace(current: EvChargeSession | undefined, incoming: EvChargeSession) {
  if (!current) return true
  const a = STATUS_RANK[current.status] ?? 0
  const b = STATUS_RANK[incoming.status] ?? 0
  if (b < a) return false
  if (b > a) return true
  return !newer(current.updatedAt, incoming.updatedAt)
}

function newer(left: string | null | undefined, right: string | null | undefined) {
  return Date.parse(left || '') > Date.parse(right || '')
}

function db(): Store {
  const g = globalThis as typeof globalThis & { __taxitagoEvCharge?: Store }
  if (!g.__taxitagoEvCharge) g.__taxitagoEvCharge = { sessions: new Map(), hydrated: false }
  if (!g.__taxitagoEvCharge.hydrated) hydrate(g.__taxitagoEvCharge)
  return g.__taxitagoEvCharge
}

function mergePersisted(store: Store, parsed: PersistShape) {
  for (const record of parsed.sessions ?? []) {
    const current = store.sessions.get(record.id)
    if (shouldReplace(current, record)) store.sessions.set(record.id, record)
  }
}

function readPersisted(): PersistShape | null {
  try {
    if (!existsSync(persistFile)) return null
    return JSON.parse(readFileSync(persistFile, 'utf8')) as PersistShape
  } catch {
    return null
  }
}

function hydrate(store: Store) {
  store.hydrated = true
  const parsed = readPersisted()
  if (!parsed) return
  for (const record of parsed.sessions ?? []) store.sessions.set(record.id, record)
}

async function fetchKvState(): Promise<PersistShape | null> {
  const raw = await kvCommand<string | null>(['GET', kvKey])
  if (!raw) return null
  try {
    return JSON.parse(raw) as PersistShape
  } catch {
    return null
  }
}

export async function hydrateEvChargeFromKv() {
  if (!useKv) return
  try {
    const parsed = await fetchKvState()
    if (parsed) mergePersisted(db(), parsed)
  } catch {
    undefined
  }
}

let kvPullAt = 0
let kvPulling = false
function pullFromKv() {
  if (!useKv) return
  const now = Date.now()
  if (kvPulling || now - kvPullAt < 1500) return
  kvPullAt = now
  kvPulling = true
  void fetchKvState()
    .then((parsed) => {
      if (parsed) mergePersisted(db(), parsed)
    })
    .catch(() => undefined)
    .finally(() => {
      kvPulling = false
    })
}

export function syncEvChargeFromDisk() {
  const store = db()
  const parsed = readPersisted()
  if (parsed) mergePersisted(store, parsed)
  pullFromKv()
}

function persist() {
  const store = db()
  const payload: PersistShape = { sessions: [...store.sessions.values()].slice(-500) }
  try {
    mkdirSync(path.dirname(persistFile), { recursive: true })
    writeFileSync(persistFile, JSON.stringify(payload), 'utf8')
  } catch {
    undefined
  }
  if (useKv) {
    void kvCommand(['SET', kvKey, JSON.stringify(payload)]).catch((error) => {
      console.error('[ev-charge] kv persist failed', error instanceof Error ? error.message : 'write error')
    })
  }
}

export function saveEvSession(record: EvChargeSession) {
  db().sessions.set(record.id, record)
  persist()
  return record
}

export function getEvSession(id: string) {
  return db().sessions.get(id) ?? null
}

export function listEvSessions(userId?: string) {
  const all = [...db().sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return userId ? all.filter((item) => item.userId === userId) : all
}
