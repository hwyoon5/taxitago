import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { piRound } from '@/lib/pi-format'

export type WalletTxKind = 'deposit' | 'withdraw' | 'reward'

/**
 * 출금 목적 구분 — 'fee'는 플랫폼 수수료 수익의 실제 인출(수익에서 차감),
 * 'user'는 이용자 잔액 반환(수익과 무관). purpose가 없는 옛 기록은 메모로 추정한다.
 */
export type WalletTxPurpose = 'fee' | 'user'

/** 리뷰 감사 포인트 1회 지급액 — 서버 라우트들이 공유한다. */
export const REVIEW_REWARD_PI = 0.1
export type WalletTxStatus = 'confirmed' | 'pending' | 'failed'

export type WalletTxEntry = {
  id: string
  kind: WalletTxKind
  /** 온체인 txid — 전송 전 단계에서 실패한 건은 빈 문자열일 수 있다. */
  txid: string
  fromWallet: string
  toWallet: string
  amount: number
  memo: string
  status: WalletTxStatus
  /** 전송 실패 사유 (status === 'failed' 일 때). */
  error: string
  /** 네트워크 수수료(Pi) — 확정된 출금 건에만 부과된다. */
  fee: number
  /** 출금 건의 목적 — 없으면 옛 기록(메모로 추정). */
  purpose?: WalletTxPurpose
  network: 'testnet' | 'mainnet'
  createdAt: string
}

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const ENTRIES_KEY = 'taxitago:wallet:history'
const MAX_ENTRIES = 2000
const filePath = path.join(process.cwd(), 'data', 'wallet-history.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoWalletHistory?: WalletTxEntry[] }
if (!globalStore.__taxitagoWalletHistory) globalStore.__taxitagoWalletHistory = []

function readFileEntries(): WalletTxEntry[] {
  try {
    if (!existsSync(filePath)) return []
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { entries?: WalletTxEntry[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFileEntries(entries: WalletTxEntry[]) {
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

async function readEntries(): Promise<WalletTxEntry[]> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', ENTRIES_KEY])
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as WalletTxEntry[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  if (!globalStore.__taxitagoWalletHistory!.length) globalStore.__taxitagoWalletHistory = readFileEntries()
  return globalStore.__taxitagoWalletHistory!
}

async function writeEntries(entries: WalletTxEntry[]) {
  const trimmed = entries.slice(-MAX_ENTRIES)
  if (useKv) {
    await kvCommand(['SET', ENTRIES_KEY, JSON.stringify(trimmed)])
    return
  }
  globalStore.__taxitagoWalletHistory = trimmed
  writeFileEntries(trimmed)
}

/**
 * 관리자 지갑 입·출금을 영구 장부에 기록한다. txid가 있는 건은
 * (kind, txid) 기준 멱등 — 동일 건 재기록 시 기존 행을 돌려준다.
 */
export async function recordWalletTx(input: {
  kind: WalletTxKind
  txid?: string
  fromWallet: string
  toWallet: string
  amount: number
  memo?: string
  status?: WalletTxStatus
  error?: string
  fee?: number
  purpose?: WalletTxPurpose
  network?: 'testnet' | 'mainnet'
}): Promise<WalletTxEntry | null> {
  const amount = piRound(Number(input.amount))
  if (!Number.isFinite(amount) || amount <= 0) return null
  const txid = (input.txid ?? '').trim()
  const entries = await readEntries()
  if (txid) {
    const existing = entries.find((entry) => entry.kind === input.kind && entry.txid === txid)
    if (existing) {
      if (existing.status === 'pending' && input.status === 'confirmed') {
        existing.status = 'confirmed'
        await writeEntries(entries)
      }
      return existing
    }
  }
  const entry: WalletTxEntry = {
    id: crypto.randomUUID(),
    kind: input.kind,
    txid,
    fromWallet: (input.fromWallet ?? '').trim(),
    toWallet: (input.toWallet ?? '').trim(),
    amount,
    memo: (input.memo ?? '').trim(),
    status: input.status ?? 'confirmed',
    error: (input.error ?? '').trim(),
    fee: input.status === 'confirmed' || input.status === undefined ? piRound(Number(input.fee ?? 0) || 0) : 0,
    purpose: input.purpose,
    network: input.network ?? 'testnet',
    createdAt: new Date().toISOString(),
  }
  entries.push(entry)
  await writeEntries(entries)
  return entry
}

export async function listWalletTxs(limit = 500): Promise<WalletTxEntry[]> {
  const entries = await readEntries()
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
}

/**
 * 이용자 잔액 반환 출금인지 판별 — purpose 필드가 없는 옛 기록은
 * 이용자 출금 경로가 쓰는 메모('사용자 잔액 출금'/'TaxiTago withdraw')로 추정한다.
 * 이용자 출금은 플랫폼 수익의 인출이 아니라 고객 돈의 반환이라 순수익 계산에서 빼야 한다.
 */
export function isUserWithdrawTx(entry: Pick<WalletTxEntry, 'purpose' | 'memo'>) {
  if (entry.purpose) return entry.purpose === 'user'
  const memo = entry.memo || ''
  return memo.includes('사용자 잔액') || memo.includes('user-withdraw') || memo === 'TaxiTago withdraw'
}

export async function walletTxTotals() {
  const entries = await readEntries()
  const confirmed = entries.filter((entry) => entry.status === 'confirmed')
  const sum = (kind: WalletTxKind) => piRound(confirmed.filter((entry) => entry.kind === kind).reduce((total, entry) => total + entry.amount, 0))
  const withdraws = confirmed.filter((entry) => entry.kind === 'withdraw')
  const feeWithdraws = withdraws.filter((entry) => !isUserWithdrawTx(entry))
  const userWithdraws = withdraws.filter(isUserWithdrawTx)
  return {
    deposit: { count: confirmed.filter((entry) => entry.kind === 'deposit').length, total: sum('deposit') },
    withdraw: {
      count: withdraws.length,
      total: sum('withdraw'),
      fee: piRound(withdraws.reduce((total, entry) => total + (entry.fee || 0), 0)),
    },
    /** 플랫폼 수수료 수익에서 실제로 인출된 금액 — 순수익 계산에는 이것만 뺀다. */
    feeWithdraw: {
      count: feeWithdraws.length,
      total: piRound(feeWithdraws.reduce((total, entry) => total + entry.amount, 0)),
      fee: piRound(feeWithdraws.reduce((total, entry) => total + (entry.fee || 0), 0)),
    },
    /** 이용자 잔액 반환 — 플랫폼 지출이 아니므로 수익 통계에서 제외한다. */
    userWithdraw: {
      count: userWithdraws.length,
      total: piRound(userWithdraws.reduce((total, entry) => total + entry.amount, 0)),
      fee: piRound(userWithdraws.reduce((total, entry) => total + (entry.fee || 0), 0)),
    },
    reward: { count: confirmed.filter((entry) => entry.kind === 'reward').length, total: sum('reward') },
  }
}
