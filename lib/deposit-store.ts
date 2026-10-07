import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { piRound } from '@/lib/pi-format'
import { kvCommand, kvConfigured } from '@/lib/kv'

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

const useKv = kvConfigured
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

/**
 * KV 읽기 실패는 인스턴스 로컬 캐시로 폴백한다 — 일시적 KV 장애가
 * 장부 조회/기록 경로를 통째로 500으로 죽이는 것을 막는다.
 */
async function readEntries(): Promise<DepositEntry[]> {
  if (useKv) {
    try {
      const raw = await kvCommand<string | null>(['GET', ENTRIES_KEY])
      if (!raw) return []
      const parsed = JSON.parse(raw) as DepositEntry[]
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      console.error('[Deposit] kv read failed; using local fallback', error)
      if (!globalStore.__taxitagoDeposits!.length) globalStore.__taxitagoDeposits = readFileEntries()
      return globalStore.__taxitagoDeposits!
    }
  }
  if (!globalStore.__taxitagoDeposits!.length) globalStore.__taxitagoDeposits = readFileEntries()
  return globalStore.__taxitagoDeposits!
}

/**
 * KV 쓰기 실패 시에도 로컬에 기록하고 계속 진행한다 — 스캐너가 같은 txid를
 * 다시 보면 멱등 재기록으로 KV 회복 후 자동 복구된다. 에러는 반드시 로그.
 */
async function writeEntries(entries: DepositEntry[]) {
  const trimmed = entries.slice(-MAX_ENTRIES)
  if (useKv) {
    try {
      await kvCommand(['SET', ENTRIES_KEY, JSON.stringify(trimmed)])
      return
    } catch (error) {
      console.error('[Deposit] kv write failed; falling back to local store', error)
    }
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
