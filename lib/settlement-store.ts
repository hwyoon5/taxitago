import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import {
  DEFAULT_RATES,
  type CommissionRates,
  type SettlementEntry,
  type SettlementService,
} from '@/lib/settlement-types'

export { DEFAULT_RATES }
export type { CommissionRates, SettlementEntry, SettlementService }

type Db = { rates: CommissionRates; entries: SettlementEntry[] }

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const RATES_KEY = 'taxitago:settlement:rates'
const ENTRIES_KEY = 'taxitago:settlement:entries'
const MAX_ENTRIES = 2000
const filePath = path.join(process.cwd(), 'data', 'settlements.json')

let warnedEphemeral = false
function warnEphemeral() {
  if (warnedEphemeral || !process.env.VERCEL) return
  warnedEphemeral = true
  console.error('[settlement-store] no KV configured on Vercel — settlement records are NOT durable')
}

function db(): Db {
  const globalStore = globalThis as typeof globalThis & { __taxitagoSettlements?: Db }
  if (!globalStore.__taxitagoSettlements) {
    const next: Db = { rates: { ...DEFAULT_RATES }, entries: [] }
    try {
      if (existsSync(filePath)) {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<Db>
        next.rates = { ...DEFAULT_RATES, ...(parsed.rates ?? {}) }
        next.entries = Array.isArray(parsed.entries) ? parsed.entries : []
      }
    } catch {
      undefined
    }
    globalStore.__taxitagoSettlements = next
  }
  return globalStore.__taxitagoSettlements
}

function persistFile() {
  const store = db()
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ rates: store.rates, entries: store.entries }), 'utf8')
  } catch {
    undefined
  }
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

async function kvGet<T>(key: string): Promise<T | null> {
  const raw = await kvCommand<string | null>(['GET', key])
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function settlementStorageBackend() {
  return useKv ? ('kv' as const) : ('file' as const)
}

export async function getCommissionRates(): Promise<CommissionRates> {
  if (useKv) {
    const remote = await kvGet<Partial<CommissionRates>>(RATES_KEY)
    return { ...DEFAULT_RATES, ...(remote ?? {}) }
  }
  warnEphemeral()
  return { ...db().rates }
}

export async function saveCommissionRates(rates: CommissionRates): Promise<CommissionRates> {
  const next = { ...DEFAULT_RATES, ...rates }
  db().rates = next
  if (useKv) await kvCommand(['SET', RATES_KEY, JSON.stringify(next)])
  else {
    warnEphemeral()
    persistFile()
  }
  return next
}

async function readEntries(): Promise<SettlementEntry[]> {
  if (useKv) return (await kvGet<SettlementEntry[]>(ENTRIES_KEY)) ?? []
  warnEphemeral()
  return db().entries
}

async function writeEntries(entries: SettlementEntry[]) {
  const trimmed = entries.slice(-MAX_ENTRIES)
  db().entries = trimmed
  if (useKv) await kvCommand(['SET', ENTRIES_KEY, JSON.stringify(trimmed)])
  else {
    warnEphemeral()
    persistFile()
  }
}

export async function listSettlements(): Promise<SettlementEntry[]> {
  const entries = await readEntries()
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Idempotent by refId — re-running a completion never double-books a commission. */
export async function recordSettlement(input: {
  refId: string
  service: SettlementService
  driverId: string
  driverName: string
  memo: string
  gross: number
}): Promise<SettlementEntry | null> {
  if (!input.refId || !Number.isFinite(input.gross) || input.gross <= 0) return null
  const entries = await readEntries()
  const existing = entries.find((entry) => entry.refId === input.refId)
  if (existing) return existing
  const rates = await getCommissionRates()
  const rate = rates[input.service] ?? 0
  const commission = Math.round(input.gross * rate) / 100
  const entry: SettlementEntry = {
    id: crypto.randomUUID(),
    refId: input.refId,
    service: input.service,
    driverId: input.driverId,
    driverName: input.driverName,
    memo: input.memo,
    gross: input.gross,
    rate,
    commission,
    net: Math.round((input.gross - commission) * 100) / 100,
    status: 'pending',
    settledAt: '',
    createdAt: new Date().toISOString(),
  }
  entries.push(entry)
  await writeEntries(entries)
  return entry
}

export async function markSettlementSettled(id: string): Promise<SettlementEntry | null> {
  const entries = await readEntries()
  const entry = entries.find((row) => row.id === id)
  if (!entry) return null
  entry.status = 'settled'
  entry.settledAt = new Date().toISOString()
  await writeEntries(entries)
  return entry
}

export async function markAllSettlementsSettled(): Promise<number> {
  const entries = await readEntries()
  const at = new Date().toISOString()
  let count = 0
  for (const entry of entries) {
    if (entry.status === 'pending') {
      entry.status = 'settled'
      entry.settledAt = at
      count += 1
    }
  }
  if (count) await writeEntries(entries)
  return count
}
