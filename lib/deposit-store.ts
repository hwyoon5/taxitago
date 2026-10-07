import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { piRound } from '@/lib/pi-format'

export type DepositEntry = {
  id: string
  /** Unique transaction id — the idempotency key so a tx is never double-counted. */
  txid: string
  fromWallet: string
  fromUid?: string
  /** Platform deposit wallet the funds were sent to (admin wallet at record time). */
  toWallet: string
  amount: number
  memo: string
  status: 'pending' | 'confirmed'
  seenAt: string
  createdAt: string
}

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const ENTRIES_KEY = 'taxitago:deposits'
const MAX_ENTRIES = 2000
const filePath = path.join(process.cwd(), 'data', 'deposits.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoDeposits?: DepositEntry[] }
if (!globalStore.__taxitagoDeposits) globalStore.__taxitagoDeposits = []

function readFileEntries(): DepositEntry[] {
  try {
    if (!existsSync(filePath)) return []
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { entries?: DepositEntry[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFileEntries(entries: DepositEntry[]) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ entries }, null, 2), 'utf8')
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

async function readEntries(): Promise<DepositEntry[]> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', ENTRIES_KEY])
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as DepositEntry[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  if (!globalStore.__taxitagoDeposits!.length) globalStore.__taxitagoDeposits = readFileEntries()
  return globalStore.__taxitagoDeposits!
}

async function writeEntries(entries: DepositEntry[]) {
  const trimmed = entries.slice(-MAX_ENTRIES)
  if (useKv) {
    await kvCommand(['SET', ENTRIES_KEY, JSON.stringify(trimmed)])
    return
  }
  globalStore.__taxitagoDeposits = trimmed
  writeFileEntries(trimmed)
}

/**
 * Records an inbound deposit to the platform wallet. Idempotent by txid —
 * a repeated webhook/sync call returns the existing row.
 */
export async function recordDeposit(input: {
  txid: string
  fromWallet: string
  toWallet: string
  amount: number
  fromUid?: string
  memo?: string
  status?: 'pending' | 'confirmed'
  seenAt?: string
}): Promise<DepositEntry | null> {
  const txid = input.txid.trim()
  const amount = piRound(Number(input.amount))
  if (!txid || !Number.isFinite(amount) || amount <= 0) return null
  const entries = await readEntries()
  const existing = entries.find((entry) => entry.txid === txid)
  if (existing) {
    let dirty = false
    if (existing.status === 'pending' && input.status === 'confirmed') {
      existing.status = 'confirmed'
      dirty = true
    }
    // 뒤늦게 확인된 귀속 uid 보강 — 이용자별 조회가 uid 매칭으로 찾을 수 있게 한다.
    if (!existing.fromUid && input.fromUid?.trim()) {
      existing.fromUid = input.fromUid.trim()
      dirty = true
    }
    if (dirty) await writeEntries(entries)
    return existing
  }
  const now = new Date().toISOString()
  const entry: DepositEntry = {
    id: crypto.randomUUID(),
    txid,
    fromWallet: input.fromWallet.trim(),
    fromUid: input.fromUid?.trim() || '',
    toWallet: input.toWallet.trim(),
    amount,
    memo: (input.memo ?? '').trim(),
    status: input.status ?? 'confirmed',
    seenAt: input.seenAt || now,
    createdAt: now,
  }
  entries.push(entry)
  await writeEntries(entries)
  return entry
}

export async function listDeposits(): Promise<DepositEntry[]> {
  const entries = await readEntries()
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function depositTotals() {
  const entries = await readEntries()
  const confirmed = entries.filter((entry) => entry.status === 'confirmed')
  return {
    count: confirmed.length,
    total: piRound(confirmed.reduce((sum, entry) => sum + entry.amount, 0)),
  }
}
