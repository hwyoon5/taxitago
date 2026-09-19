import type { DriverEarning, EscrowRecord, SettlementReceipt } from '@/lib/escrow-types'

type EscrowDb = {
  escrows: Map<string, EscrowRecord>
  byRide: Map<string, string>
  receipts: Map<string, SettlementReceipt>
  earnings: DriverEarning[]
}

function db(): EscrowDb {
  const globalStore = globalThis as typeof globalThis & { __taxitagoEscrow?: EscrowDb }
  if (!globalStore.__taxitagoEscrow) {
    globalStore.__taxitagoEscrow = {
      escrows: new Map(),
      byRide: new Map(),
      receipts: new Map(),
      earnings: [],
    }
  }
  return globalStore.__taxitagoEscrow
}

export function saveEscrow(record: EscrowRecord) {
  const store = db()
  store.escrows.set(record.id, record)
  store.byRide.set(record.rideId, record.id)
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
  return receipt
}

export function getReceipt(rideId: string) {
  return db().receipts.get(rideId) ?? null
}

export function addEarning(entry: DriverEarning) {
  const store = db()
  store.earnings = [entry, ...store.earnings.filter((item) => item.rideId !== entry.rideId)].slice(0, 400)
  return entry
}

export function listEarnings(driverId: string) {
  return db().earnings.filter((item) => item.driverId === driverId)
}
