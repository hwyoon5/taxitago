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
const BALANCES_KEY = 'taxitago:user-balances'
/** 실제 온체인 지갑주소 → Pi uid — 스캐너가 후속 입금의 귀속을 판별할 때 쓴다. */
const WALLETS_KEY = 'taxitago:user-wallets'
const MAX_ENTRIES = 4000
const filePath = path.join(process.cwd(), 'data', 'user-credits.json')
const balancesPath = path.join(process.cwd(), 'data', 'user-balances.json')
const walletsPath = path.join(process.cwd(), 'data', 'user-wallets.json')

const globalStore = globalThis as typeof globalThis & {
  __taxitagoUserCredits?: UserCreditEntry[]
  __taxitagoUserBalances?: Record<string, number>
  __taxitagoUserWallets?: Record<string, string>
}
if (!globalStore.__taxitagoUserCredits) globalStore.__taxitagoUserCredits = []
if (!globalStore.__taxitagoUserBalances) globalStore.__taxitagoUserBalances = {}
if (!globalStore.__taxitagoUserWallets) globalStore.__taxitagoUserWallets = {}

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

function readFileBalances(): Record<string, number> {
  try {
    if (!existsSync(balancesPath)) return {}
    const parsed = JSON.parse(readFileSync(balancesPath, 'utf8')) as { balances?: Record<string, number> }
    return parsed.balances && typeof parsed.balances === 'object' ? parsed.balances : {}
  } catch {
    return {}
  }
}

function writeFileBalances(balances: Record<string, number>) {
  try {
    mkdirSync(path.dirname(balancesPath), { recursive: true })
    writeFileSync(balancesPath, JSON.stringify({ balances }, null, 2), 'utf8')
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

async function readBalances(): Promise<Record<string, number>> {
  if (useKv) {
    const raw = await kvCommand<Record<string, number> | string | null>(['GET', BALANCES_KEY])
    if (!raw) return {}
    const parsed = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, number>) : raw
    return parsed && typeof parsed === 'object' ? parsed : {}
  }
  if (!Object.keys(globalStore.__taxitagoUserBalances!).length) globalStore.__taxitagoUserBalances = readFileBalances()
  return globalStore.__taxitagoUserBalances!
}

async function writeBalances(balances: Record<string, number>) {
  if (useKv) {
    await kvCommand(['SET', BALANCES_KEY, JSON.stringify(balances)])
    return
  }
  globalStore.__taxitagoUserBalances = balances
  writeFileBalances(balances)
}

function readFileWallets(): Record<string, string> {
  try {
    if (!existsSync(walletsPath)) return {}
    const parsed = JSON.parse(readFileSync(walletsPath, 'utf8')) as { wallets?: Record<string, string> }
    return parsed.wallets && typeof parsed.wallets === 'object' ? parsed.wallets : {}
  } catch {
    return {}
  }
}

function writeFileWallets(wallets: Record<string, string>) {
  try {
    mkdirSync(path.dirname(walletsPath), { recursive: true })
    writeFileSync(walletsPath, JSON.stringify({ wallets }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readWallets(): Promise<Record<string, string>> {
  if (useKv) {
    const raw = await kvCommand<Record<string, string> | string | null>(['GET', WALLETS_KEY])
    if (!raw) return {}
    const parsed = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, string>) : raw
    return parsed && typeof parsed === 'object' ? parsed : {}
  }
  if (!Object.keys(globalStore.__taxitagoUserWallets!).length) globalStore.__taxitagoUserWallets = readFileWallets()
  return globalStore.__taxitagoUserWallets!
}

async function writeWallets(wallets: Record<string, string>) {
  if (useKv) {
    await kvCommand(['SET', WALLETS_KEY, JSON.stringify(wallets)])
    return
  }
  globalStore.__taxitagoUserWallets = wallets
  writeFileWallets(wallets)
}

/** 온체인 지갑주소로 귀속 uid 조회 — 한 번이라도 결제가 귀속된 지갑만 맞는다. */
export async function uidForWallet(wallet: string): Promise<string> {
  const w = wallet.trim()
  if (!w) return ''
  const map = await readWallets().catch(() => ({} as Record<string, string>))
  return typeof map[w] === 'string' ? map[w] : ''
}

/** uid에 연결된 온체인 지갑주소들 — 이용자별 입금 조회가 진짜 주소로도 맞게 한다. */
export async function walletsForUid(uid: string): Promise<Set<string>> {
  const u = uid.trim()
  if (!u) return new Set()
  const map = await readWallets().catch(() => ({} as Record<string, string>))
  return new Set(Object.entries(map).filter(([, v]) => v === u).map(([k]) => k))
}

/** 이용자 잔액 맵의 키 — 지갑 주소 우선, 없으면 uid 네임스페이스. */
function balanceKey(wallet: string, uid: string) {
  return wallet || `uid:${uid}`
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
  if (!txid || (!wallet && !uid) || !Number.isFinite(amount) || amount <= 0) {
    console.warn('[Deposit] creditUserDeposit skipped: invalid input', {
      txid: txid || '(empty)',
      wallet: wallet || '(empty)',
      uid: uid || '(empty)',
      amount,
    })
    return null
  }
  const [entries, balances, wallets] = await Promise.all([readEntries(), readBalances(), readWallets()])
  // 실제 지갑주소↔uid 연결이 확인되면 매핑에 남긴다 — 이후 스캐너가 같은 지갑의
  // 입금을 uid로 귀속할 수 있게 된다.
  const link = async (w: string, u: string) => {
    if (w && u && wallets[w] !== u) {
      wallets[w] = u
      await writeWallets(wallets).catch(() => undefined)
    }
  }
  const existing = entries.find((entry) => entry.txid === txid)
  if (existing) {
    // 중복 txid는 무시(no-op) — 폴러/재시도가 에러를 내면 안 된다.
    // 다만 뒤늦게 알게 된 uid는 보강하고, balance 롤업이 엔트리 합계와
    // 어긋나 있으면 원천 데이터로 복구한다.
    let dirty = false
    if (!existing.uid && uid) {
      existing.uid = uid
      dirty = true
    }
    const key = balanceKey(existing.wallet || wallet, existing.uid || uid)
    const expected = piRound(
      entries
        .filter((e) => e.wallet === existing.wallet || (existing.uid && e.uid === existing.uid))
        .reduce((sum, e) => sum + e.amount, 0),
    )
    if (balances[key] !== expected) {
      balances[key] = expected
      dirty = true
    }
    if (dirty) await Promise.all([writeEntries(entries), writeBalances(balances)])
    await link(existing.wallet || wallet, existing.uid || uid)
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
  // 이용자 잔액 롤업 — 장부 기록과 같은 호출 안에서 원자적으로 반영된다.
  const key = balanceKey(wallet, uid)
  balances[key] = piRound((balances[key] || 0) + amount)
  await Promise.all([writeEntries(entries), writeBalances(balances)])
  await link(wallet, uid)
  console.log('[Deposit] creditUserDeposit credited', { txid, wallet, uid: uid || '(none)', amount, source: entry.source })
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

/** 서버에 기록된 해당 이용자의 누적 입금 잔액(크레딧 롤업) — 지출 전 크레딧 기준. */
export async function userCreditBalance(wallet: string, uid: string) {
  // entries를 원천으로 계산 — balances 맵은 조회 가속용 롤업이며 드리프트 방지를 위해 여기서 재계산한다.
  const totals = await userCreditTotals(wallet, uid)
  return totals.total
}
