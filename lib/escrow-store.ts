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
  if (!parsed) return
  for (const record of parsed.escrows ?? []) {
    const current = store.escrows.get(record.id) ?? (store.byRide.get(record.rideId) ? store.escrows.get(store.byRide.get(record.rideId) || '') : null)
    if (!current || !newer(current.updatedAt, record.updatedAt)) remember(store, record)
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

function persist() {
  const store = db()
  try {
    mkdirSync(path.dirname(persistFile), { recursive: true })
    const payload: PersistShape = {
      escrows: [...store.escrows.values()],
      receipts: [...store.receipts.values()],
      earnings: store.earnings,
    }
    writeFileSync(persistFile, JSON.stringify(payload), 'utf8')
  } catch {
    undefined
  }
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
  store.earnings = [entry, ...store.earnings.filter((item) => item.rideId !== entry.rideId)].slice(0, 400)
  persist()
  return entry
}

export function listEarnings(driverId: string) {
  return db().earnings.filter((item) => item.driverId === driverId)
}
