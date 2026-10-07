import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { piRound } from '@/lib/pi-format'

export type UserCreditEntry = {
  id: string
  /** On-chain txid — global idempotency key: one deposit credits exactly one user once. */
  txid: string
  /** Sender wallet — primary user match key. */
  wallet: string
  /** Pi uid when known — fallback user match key. */
  uid: string
  amount: number
  source: 'scan' | 'manual'
  creditedAt: string
}

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const ENTRIES_KEY = 'taxitago:user-credits'
const MAX_ENTRIES = 4000
const filePath = path.join(process.cwd(), 'data', 'user-credits.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoUserCredits?: UserCreditEntry[] }
if (!globalStore.__taxitagoUserCredits) globalStore.__taxitagoUserCredits = []

function readFileEntries(): UserCreditEntry[] {
  try {
    if (!existsSync(filePath)) return []
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { entries?: UserCreditEntry[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFileEntries(entries: UserCreditEntry[]) {
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

async function readEntries(): Promise<UserCreditEntry[]> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', ENTRIES_KEY])
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as UserCreditEntry[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  if (!globalStore.__taxitagoUserCredits!.length) globalStore.__taxitagoUserCredits = readFileEntries()
  return globalStore.__taxitagoUserCredits!
}

async function writeEntries(entries: UserCreditEntry[]) {
  const trimmed = entries.slice(-MAX_ENTRIES)
  if (useKv) {
    await kvCommand(['SET', ENTRIES_KEY, JSON.stringify(trimmed)])
    return
  }
  globalStore.__taxitagoUserCredits = trimmed
  writeFileEntries(trimmed)
}

/**
 * 입금이 장부에 기록되는 순간 호출 — 해당 이용자에게 잔액 크레딧이 귀속됐음을
 * 서버 저장소에 원자적으로 남긴다. txid 멱등이라 스캔/수동 동기화가 겹쳐도
 * 한 번만 기록되고, 기존 행에는 없던 uid가 뒤늦게 확인되면 보강한다.
 */
export async function creditUserDeposit(input: {
  txid: string
  wallet?: string
  uid?: string
  amount: number
  source?: 'scan' | 'manual'
}): Promise<UserCreditEntry | null> {
  const txid = input.txid.trim()
  const wallet = (input.wallet || '').trim()
  const uid = (input.uid || '').trim()
  const amount = piRound(Number(input.amount))
  if (!txid || (!wallet && !uid) || !Number.isFinite(amount) || amount <= 0) return null
  const entries = await readEntries()
  const existing = entries.find((entry) => entry.txid === txid)
  if (existing) {
    if (!existing.uid && uid) {
      existing.uid = uid
      await writeEntries(entries)
    }
    return existing
  }
  const entry: UserCreditEntry = {
    id: crypto.randomUUID(),
    txid,
    wallet,
    uid,
    amount,
    source: input.source ?? 'scan',
    creditedAt: new Date().toISOString(),
  }
  entries.push(entry)
  await writeEntries(entries)
  return entry
}

export async function listUserCredits(): Promise<UserCreditEntry[]> {
  const entries = await readEntries()
  return [...entries].sort((a, b) => b.creditedAt.localeCompare(a.creditedAt))
}

/** 해당 이용자에게 귀속된 크레딧 총액·건수 — 잔액 대사·관리자 확인용. */
export async function userCreditTotals(wallet: string, uid: string) {
  const entries = await readEntries()
  const mine = entries.filter(
    (entry) => (wallet && entry.wallet === wallet) || (uid && entry.uid && entry.uid === uid),
  )
  return {
    count: mine.length,
    total: piRound(mine.reduce((sum, entry) => sum + entry.amount, 0)),
  }
}
