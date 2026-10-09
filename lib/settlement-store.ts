import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { piRound } from '@/lib/pi-format'
import path from 'path'
import {
  DEFAULT_RATES,
  type CommissionRates,
  type SettlementEntry,
  type SettlementService,
} from '@/lib/settlement-types'
import { getAdminWallet } from '@/lib/admin-wallet'

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

/**
 * commission/rate/net 필드가 없는 옛 레코드(또는 손상 로우)를 읽는 시점에
 * 재계산해 복구한다 — NaN이 summarize 합계 전체를 0으로 오염시키는 것을 막는다.
 * rate가 없으면 서비스 기본 수수료율(DEFAULT_RATES)을 적용한다.
 */
function normalizeEntry(entry: SettlementEntry): SettlementEntry {
  const gross = Number.isFinite(entry.gross) ? entry.gross : 0
  const rate = Number.isFinite(entry.rate) ? entry.rate : (DEFAULT_RATES[entry.service] ?? 0)
  const commission = Number.isFinite(entry.commission) ? entry.commission : piRound(gross * rate / 100)
  const net = Number.isFinite(entry.net) ? entry.net : piRound(gross - commission)
  if (gross === entry.gross && rate === entry.rate && commission === entry.commission && net === entry.net) return entry
  return { ...entry, gross, rate, commission, net }
}

async function readEntries(): Promise<SettlementEntry[]> {
  if (useKv) {
    // KV 읽기 실패가 정산 기록 경로를 죽이지 않게 로컬 메모리/파일로 폴백한다.
    try {
      const rows = (await kvGet<SettlementEntry[]>(ENTRIES_KEY)) ?? []
      return rows.map(normalizeEntry)
    } catch (error) {
      console.error('[settlement-store] kv read failed; using local fallback', error)
      return db().entries.map(normalizeEntry)
    }
  }
  warnEphemeral()
  return db().entries.map(normalizeEntry)
}

async function writeEntries(entries: SettlementEntry[]) {
  const trimmed = entries.slice(-MAX_ENTRIES)
  db().entries = trimmed
  if (useKv) {
    try {
      await kvCommand(['SET', ENTRIES_KEY, JSON.stringify(trimmed)])
    } catch (error) {
      // 쓰기 실패를 삼키면 정산 건이 무소식 유실된다 — 로컬 파일에라도 남기고 경고한다.
      console.error('[settlement-store] kv write failed; kept in memory/file only', error)
      persistFile()
    }
    return
  }
  warnEphemeral()
  persistFile()
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
  passengerId?: string
  driverWallet?: string
  channel?: SettlementEntry['channel']
}): Promise<SettlementEntry | null> {
  if (!input.refId || !Number.isFinite(input.gross) || input.gross <= 0) return null
  const entries = await readEntries()
  const existing = entries.find((entry) => entry.refId === input.refId)
  if (existing) return existing
  const [rates, adminWallet] = await Promise.all([getCommissionRates(), getAdminWallet()])
  const rate = rates[input.service] ?? 0
  if (!(rate > 0)) {
    // 수수료율 0으로 쓰인 건은 총 수수료 수익이 0으로 보이는 직접 원인 — 경고를 남긴다.
    console.warn('[settlement-store] zero commission rate at record time', { refId: input.refId, service: input.service, gross: input.gross })
  }
  const commission = piRound(input.gross * rate / 100)
  const entry: SettlementEntry = {
    id: crypto.randomUUID(),
    refId: input.refId,
    service: input.service,
    driverId: input.driverId,
    driverName: input.driverName,
    passengerId: input.passengerId || '',
    memo: input.memo,
    adminWallet,
    driverWallet: input.driverWallet?.trim() || '',
    gross: input.gross,
    rate,
    commission,
    net: piRound(input.gross - commission),
    status: 'pending',
    channel: input.channel,
    settledAt: '',
    createdAt: new Date().toISOString(),
  }
  entries.push(entry)
  await writeEntries(entries)
  return entry
}

export async function markSettlementSettled(id: string, payoutTxid?: string): Promise<SettlementEntry | null> {
  const entries = await readEntries()
  const entry = entries.find((row) => row.id === id)
  if (!entry) return null
  entry.status = 'settled'
  entry.settledAt = new Date().toISOString()
  if (payoutTxid?.trim()) entry.payoutTxid = payoutTxid.trim()
  await writeEntries(entries)
  return entry
}

/** Admin manual adjustment — edits a ledger row and recomputes commission/net. */
export async function updateSettlementEntry(id: string, patch: {
  gross?: number
  memo?: string
  driverId?: string
  driverName?: string
  status?: 'pending' | 'settled'
}): Promise<SettlementEntry | null> {
  const entries = await readEntries()
  const entry = entries.find((row) => row.id === id)
  if (!entry) return null
  if (patch.gross !== undefined) {
    if (!Number.isFinite(patch.gross) || patch.gross <= 0) return null
    entry.gross = piRound(patch.gross)
    entry.commission = piRound(entry.gross * entry.rate / 100)
    entry.net = piRound(entry.gross - entry.commission)
  }
  if (typeof patch.memo === 'string' && patch.memo.trim()) entry.memo = patch.memo.trim()
  if (typeof patch.driverId === 'string' && patch.driverId.trim()) entry.driverId = patch.driverId.trim()
  if (typeof patch.driverName === 'string') entry.driverName = patch.driverName.trim()
  if (patch.status === 'pending' || patch.status === 'settled') {
    entry.status = patch.status
    entry.settledAt = patch.status === 'settled' ? entry.settledAt || new Date().toISOString() : ''
  }
  await writeEntries(entries)
  return entry
}

/**
 * 수수료율이 0으로 저장된 시점에 기록된 건(rate 0 → commission 0)을 현재
 * 수수료율로 재계산한다. settled 건은 이미 정산·송금이 끝났으므로 pending 건만
 * 손댄다. 수수료율 저장(PATCH 'rates') 이후 호출해 과거 누락분을 복구한다.
 */
export async function healZeroCommissionEntries(rates: CommissionRates): Promise<number> {
  const entries = await readEntries()
  let healed = 0
  for (const entry of entries) {
    const expected = rates[entry.service] ?? 0
    if (entry.status !== 'pending' || !(expected > 0) || !(Number.isFinite(entry.gross) && entry.gross > 0)) continue
    if (entry.commission > 0) continue
    entry.rate = expected
    entry.commission = piRound(entry.gross * expected / 100)
    entry.net = piRound(entry.gross - entry.commission)
    healed += 1
  }
  if (healed) await writeEntries(entries)
  return healed
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
