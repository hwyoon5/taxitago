import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import type { DriverEarning, EscrowRecord, SettlementReceipt } from '@/lib/escrow-types'

type EscrowDb = {
  escrows: Map<string, EscrowRecord>
  byRide: Map<string, string>
  receipts: Map<string, SettlementReceipt>
  earnings: DriverEarning[]
  hydrated: boolean
}

type PersistShape = {
  escrows?: EscrowRecord[]
  receipts?: SettlementReceipt[]
  earnings?: DriverEarning[]
}

const persistFile = path.join(process.cwd(), 'data', 'escrow.json')

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)
const escrowKvKey = 'taxitago:escrow:state'

let warnedEphemeral = false
function warnEphemeral() {
  if (warnedEphemeral || !process.env.VERCEL || useKv) return
  warnedEphemeral = true
  console.error('[escrow-store] no KV configured on Vercel — escrow state is NOT shared across instances (set KV_REST_API_URL/KV_REST_API_TOKEN)')
}

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

async function fetchKvState(): Promise<PersistShape | null> {
  const raw = await kvCommand<string | null>(['GET', escrowKvKey])
  if (!raw) return null
  try {
    return JSON.parse(raw) as PersistShape
  } catch {
    return null
  }
}

let kvPullAt = 0
let kvPulling = false

const ESCROW_STATUS_RANK: Record<string, number> = {
  pending: 0,
  held: 1,
  released: 2,
  refunded: 2,
}

function escrowShouldReplace(current: EscrowRecord | undefined | null, incoming: EscrowRecord) {
  if (!current) return true
  const currentRank = ESCROW_STATUS_RANK[current.status] ?? 0
  const incomingRank = ESCROW_STATUS_RANK[incoming.status] ?? 0
  if (incomingRank < currentRank) return false
  if (incomingRank > currentRank) return true
  return !newer(current.updatedAt, incoming.updatedAt)
}

function mergePersisted(store: EscrowDb, parsed: PersistShape) {
  for (const record of parsed.escrows ?? []) {
    const current = store.escrows.get(record.id) ?? (store.byRide.get(record.rideId) ? store.escrows.get(store.byRide.get(record.rideId) || '') : null)
    if (escrowShouldReplace(current, record)) remember(store, record)
  }
  for (const receipt of parsed.receipts ?? []) {
    const current = store.receipts.get(receipt.rideId)
    if (!current || !newer(current.settledAt, receipt.settledAt)) store.receipts.set(receipt.rideId, receipt)
  }
  for (const entry of parsed.earnings ?? []) {
    if (!store.earnings.some((item) => item.rideId === entry.rideId && item.status === entry.status)) {
      store.earnings.unshift(entry)
    }
  }
  store.earnings = store.earnings.slice(0, 400)
}

function pullFromKv() {
  if (!useKv) {
    warnEphemeral()
    return
  }
  const now = Date.now()
  if (kvPulling || now - kvPullAt < 1500) return
  kvPullAt = now
  kvPulling = true
  void fetchKvState().then((parsed) => {
    if (parsed) mergePersisted(db(), parsed)
  }).catch(() => undefined).finally(() => {
    kvPulling = false
  })
}

export async function hydrateEscrowFromKv() {
  if (!useKv) {
    warnEphemeral()
    return
  }
  kvPullAt = Date.now()
  try {
    const parsed = await fetchKvState()
    if (parsed) mergePersisted(db(), parsed)
  } catch {
    undefined
  }
}

function pushToKv(payload: PersistShape) {
  void fetchKvState().then((remote) => {
    let merged = payload
    if (remote) {
      const escrowMap = new Map((payload.escrows ?? []).map((record) => [record.id, record]))
      for (const record of remote.escrows ?? []) {
        const local = escrowMap.get(record.id)
        if (escrowShouldReplace(local, record)) escrowMap.set(record.id, record)
      }
      const receiptMap = new Map((payload.receipts ?? []).map((receipt) => [receipt.rideId, receipt]))
      for (const receipt of remote.receipts ?? []) {
        const local = receiptMap.get(receipt.rideId)
        if (!local || newer(receipt.settledAt, local.settledAt)) receiptMap.set(receipt.rideId, receipt)
      }
      const earningKeys = new Set((payload.earnings ?? []).map((entry) => `${entry.rideId}:${entry.status}`))
      const earnings = [...(payload.earnings ?? [])]
      for (const entry of remote.earnings ?? []) {
        if (!earningKeys.has(`${entry.rideId}:${entry.status}`)) earnings.push(entry)
      }
      merged = {
        escrows: [...escrowMap.values()],
        receipts: [...receiptMap.values()],
        earnings: earnings.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 400),
      }
    }
    return kvCommand(['SET', escrowKvKey, JSON.stringify(merged)])
  }).catch((error) => {
    console.error('[escrow-store] kv persist failed', error instanceof Error ? error.message : 'write error')
  })
}

function db(): EscrowDb {
  const globalStore = globalThis as typeof globalThis & { __taxitagoEscrow?: EscrowDb }
  if (!globalStore.__taxitagoEscrow) {
    globalStore.__taxitagoEscrow = {
      escrows: new Map(),
      byRide: new Map(),
      receipts: new Map(),
      earnings: [],
      hydrated: false,
    }
  }
  if (!globalStore.__taxitagoEscrow.hydrated) hydrate(globalStore.__taxitagoEscrow)
  return globalStore.__taxitagoEscrow
}

function remember(store: EscrowDb, record: EscrowRecord) {
  store.escrows.set(record.id, record)
  store.byRide.set(record.rideId, record.id)
}

function readPersisted(): PersistShape | null {
  try {
    if (!existsSync(persistFile)) return null
    return JSON.parse(readFileSync(persistFile, 'utf8')) as PersistShape
  } catch {
    return null
  }
}

function hydrate(store: EscrowDb) {
  store.hydrated = true
  const parsed = readPersisted()
  if (!parsed) return
  for (const record of parsed.escrows ?? []) remember(store, record)
  for (const receipt of parsed.receipts ?? []) store.receipts.set(receipt.rideId, receipt)
  store.earnings = parsed.earnings ?? []
}

function newer(left: string | null | undefined, right: string | null | undefined) {
  return Date.parse(left || '') > Date.parse(right || '')
}

export function syncEscrowFromDisk() {
  const store = db()
  const parsed = readPersisted()
  if (parsed) mergePersisted(store, parsed)
  pullFromKv()
}

function persist() {
  const store = db()
  const payload: PersistShape = {
    escrows: [...store.escrows.values()],
    receipts: [...store.receipts.values()],
    earnings: store.earnings,
  }
  try {
    mkdirSync(path.dirname(persistFile), { recursive: true })
    writeFileSync(persistFile, JSON.stringify(payload), 'utf8')
  } catch {
    undefined
  }
  if (useKv) pushToKv(payload)
}

export function saveEscrow(record: EscrowRecord) {
  remember(db(), record)
  persist()
  return record
}

export function getEscrow(id: string) {
  return db().escrows.get(id) ?? null
}

export function getEscrowByRide(rideId: string) {
  const id = db().byRide.get(rideId)
  return id ? db().escrows.get(id) ?? null : null
}

export function saveReceipt(receipt: SettlementReceipt) {
  db().receipts.set(receipt.rideId, receipt)
  persist()
  return receipt
}

export function getReceipt(rideId: string) {
  return db().receipts.get(rideId) ?? null
}

export function addEarning(entry: DriverEarning) {
  const store = db()
  store.earnings = [entry, ...store.earnings.filter((item) => !(item.rideId === entry.rideId && item.status === entry.status))].slice(0, 400)
  persist()
  return entry
}

export function listEarnings(driverId: string) {
  return db().earnings.filter((item) => item.driverId === driverId)
}
