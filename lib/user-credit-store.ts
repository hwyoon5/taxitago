import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { piRound } from '@/lib/pi-format'
import { kvCommand, kvConfigured } from '@/lib/kv'

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
  /** 회원탈퇴 시각 — 찍히면 잔액 집계·재귀속 대상에서 빠지고 감사용으로만 남는다. */
  withdrawnAt?: string
}

const useKv = kvConfigured
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

/** KV 읽기 실패 시 로컬 캐시 폴백 — 장애가 조회/기록 경로를 죽이지 않게 한다. */
async function readEntries(): Promise<UserCreditEntry[]> {
  if (useKv) {
    try {
      const raw = await kvCommand<string | null>(['GET', ENTRIES_KEY])
      if (!raw) return []
      const parsed = JSON.parse(raw) as UserCreditEntry[]
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      console.error('[Deposit] user-credit kv read failed; using local fallback', error)
      if (!globalStore.__taxitagoUserCredits!.length) globalStore.__taxitagoUserCredits = readFileEntries()
      return globalStore.__taxitagoUserCredits!
    }
  }
  if (!globalStore.__taxitagoUserCredits!.length) globalStore.__taxitagoUserCredits = readFileEntries()
  return globalStore.__taxitagoUserCredits!
}

async function writeEntries(entries: UserCreditEntry[]) {
  const trimmed = entries.slice(-MAX_ENTRIES)
  if (useKv) {
    try {
      await kvCommand(['SET', ENTRIES_KEY, JSON.stringify(trimmed)])
      return
    } catch (error) {
      console.error('[Deposit] user-credit kv write failed; falling back to local', error)
    }
  }
  globalStore.__taxitagoUserCredits = trimmed
  writeFileEntries(trimmed)
}

async function readBalances(): Promise<Record<string, number>> {
  if (useKv) {
    try {
      const raw = await kvCommand<Record<string, number> | string | null>(['GET', BALANCES_KEY])
      if (!raw) return {}
      const parsed = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, number>) : raw
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      console.error('[Deposit] balances kv read failed; using local fallback', error)
      if (!Object.keys(globalStore.__taxitagoUserBalances!).length) globalStore.__taxitagoUserBalances = readFileBalances()
      return globalStore.__taxitagoUserBalances!
    }
  }
  if (!Object.keys(globalStore.__taxitagoUserBalances!).length) globalStore.__taxitagoUserBalances = readFileBalances()
  return globalStore.__taxitagoUserBalances!
}

async function writeBalances(balances: Record<string, number>) {
  if (useKv) {
    try {
      await kvCommand(['SET', BALANCES_KEY, JSON.stringify(balances)])
      return
    } catch (error) {
      console.error('[Deposit] balances kv write failed; falling back to local', error)
    }
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
    try {
      const raw = await kvCommand<Record<string, string> | string | null>(['GET', WALLETS_KEY])
      if (!raw) return {}
      const parsed = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, string>) : raw
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      console.error('[Deposit] wallets kv read failed; using local fallback', error)
      if (!Object.keys(globalStore.__taxitagoUserWallets!).length) globalStore.__taxitagoUserWallets = readFileWallets()
      return globalStore.__taxitagoUserWallets!
    }
  }
  if (!Object.keys(globalStore.__taxitagoUserWallets!).length) globalStore.__taxitagoUserWallets = readFileWallets()
  return globalStore.__taxitagoUserWallets!
}

async function writeWallets(wallets: Record<string, string>) {
  if (useKv) {
    try {
      await kvCommand(['SET', WALLETS_KEY, JSON.stringify(wallets)])
      return
    } catch (error) {
      console.error('[Deposit] wallets kv write failed; falling back to local', error)
    }
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
        .filter((e) => !e.withdrawnAt && (e.wallet === existing.wallet || (existing.uid && e.uid === existing.uid)))
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

/** 해당 이용자에게 귀속된 크레딧 총액·건수 — 잔액 대사·관리자 확인용. 탈퇴 아카이브분은 제외. */
export async function userCreditTotals(wallet: string, uid: string) {
  const entries = await readEntries()
  const mine = entries.filter(
    (entry) =>
      !entry.withdrawnAt &&
      ((wallet && entry.wallet === wallet) || (uid && entry.uid && entry.uid === uid)),
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

// ── 이용자 지출 장부 ──────────────────────────────────────────────────────────
// 요금 계열 결제(service-pay·manual-settle·escrow-lock)가 완료되면 결제 금액만큼
// 이용자 크레딧에서 차감된다. txid 멱등이라 완료 콜백 재시도·폴러가 중복 차감하지
// 않으며, 입금(크레딧)과 지출을 분리해 둬서 누적 입금과 사용 가능 잔액을 각각
// 대사할 수 있다.

export type UserSpendEntry = {
  id: string
  /** 결제 txid — 글로벌 멱등키: 한 결제는 정확히 한 번 차감된다. */
  txid: string
  wallet: string
  uid: string
  amount: number
  label: string
  spentAt: string
  /** 회원탈퇴 시각 — 잔액 집계에서 빠지고 감사용으로만 남는다. */
  withdrawnAt?: string
}

const SPENDS_KEY = 'taxitago:user-spends'
const spendsPath = path.join(process.cwd(), 'data', 'user-spends.json')

const spendStore = globalThis as typeof globalThis & { __taxitagoUserSpends?: UserSpendEntry[] }

function readFileSpends(): UserSpendEntry[] {
  try {
    if (!existsSync(spendsPath)) return []
    const parsed = JSON.parse(readFileSync(spendsPath, 'utf8')) as { entries?: UserSpendEntry[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFileSpends(entries: UserSpendEntry[]) {
  try {
    mkdirSync(path.dirname(spendsPath), { recursive: true })
    writeFileSync(spendsPath, JSON.stringify({ entries }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readSpends(): Promise<UserSpendEntry[]> {
  if (useKv) {
    try {
      const raw = await kvCommand<string | null>(['GET', SPENDS_KEY])
      const parsed = raw ? (JSON.parse(raw) as UserSpendEntry[]) : []
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      console.error('[Spend] user-spend kv read failed; using local fallback', error)
      if (!spendStore.__taxitagoUserSpends!.length) spendStore.__taxitagoUserSpends = readFileSpends()
      return spendStore.__taxitagoUserSpends!
    }
  }
  if (!spendStore.__taxitagoUserSpends) spendStore.__taxitagoUserSpends = []
  if (!spendStore.__taxitagoUserSpends.length) spendStore.__taxitagoUserSpends = readFileSpends()
  return spendStore.__taxitagoUserSpends
}

async function writeSpends(entries: UserSpendEntry[]) {
  const trimmed = entries.slice(-MAX_ENTRIES)
  if (useKv) {
    try {
      await kvCommand(['SET', SPENDS_KEY, JSON.stringify(trimmed)])
      return
    } catch (error) {
      console.error('[Spend] user-spend kv write failed; falling back to local', error)
    }
  }
  spendStore.__taxitagoUserSpends = trimmed
  writeFileSpends(trimmed)
}

/** 요금 결제 완료 시 이용자 잔액 차감 — txid 멱등, 결제 금액은 서버 조회값이 권위. */
export async function recordUserSpend(input: {
  txid: string
  wallet?: string
  uid?: string
  amount: number
  label?: string
}): Promise<UserSpendEntry | null> {
  const txid = input.txid.trim()
  const wallet = (input.wallet || '').trim()
  const uid = (input.uid || '').trim()
  const amount = piRound(Number(input.amount))
  if (!txid || (!wallet && !uid) || !Number.isFinite(amount) || amount <= 0) return null
  const entries = await readSpends()
  const existing = entries.find((entry) => entry.txid === txid)
  if (existing) return existing
  const entry: UserSpendEntry = {
    id: crypto.randomUUID(),
    txid,
    wallet,
    uid,
    amount,
    label: (input.label || '').slice(0, 60),
    spentAt: new Date().toISOString(),
  }
  entries.push(entry)
  await writeSpends(entries)
  console.log('[Spend] recordUserSpend debited', { txid, uid: uid || '(none)', amount, label: entry.label })
  return entry
}

export async function listUserSpends(): Promise<UserSpendEntry[]> {
  const entries = await readSpends()
  return [...entries].sort((a, b) => b.spentAt.localeCompare(a.spentAt))
}

/** 해당 이용자의 지출 총액·건수. 탈퇴 아카이브분은 제외해 재가입 잔액이 오염되지 않게 한다. */
export async function userSpendTotals(wallet: string, uid: string) {
  const entries = await readSpends()
  const mine = entries.filter(
    (entry) =>
      !entry.withdrawnAt &&
      ((wallet && entry.wallet === wallet) || (uid && entry.uid && entry.uid === uid)),
  )
  return {
    count: mine.length,
    total: piRound(mine.reduce((sum, entry) => sum + entry.amount, 0)),
  }
}

/** 사용 가능 잔액 = 누적 입금 크레딧 − 누적 지출 — 탈퇴 잔액 검사·대사용. */
export async function userSpendableBalance(wallet: string, uid: string) {
  const [credits, spends] = await Promise.all([userCreditTotals(wallet, uid), userSpendTotals(wallet, uid)])
  return piRound(credits.total - spends.total)
}

/**
 * 회원탈퇴 — 해당 이용자의 크레딧·지출 엔트리에 withdrawnAt을 찍어
 * 개인 잔액을 0으로 초기화한다. 엔트리 자체는 삭제하지 않아 플랫폼 감사
 * 장부(입금/지출 이력)는 보존되고, 재가입 시 옛 txid가 다시 귀속·충전되지
 * 않게 지갑↔uid 매핑과 잔액 롤업을 함께 제거한다.
 */
export async function archiveUserCredits(input: { uid?: string; wallet?: string }) {
  const uid = (input.uid || '').trim()
  const wallet = (input.wallet || '').trim()
  if (!uid && !wallet) return { archived: 0 }
  const now = new Date().toISOString()
  const [entries, spends, balances, wallets] = await Promise.all([readEntries(), readSpends(), readBalances(), readWallets()])
  const mine = (row: { wallet?: string; uid?: string }) =>
    (wallet && row.wallet === wallet) || (uid && row.uid === uid)
  let archived = 0
  for (const entry of entries) {
    if (!entry.withdrawnAt && mine(entry)) {
      entry.withdrawnAt = now
      archived += 1
    }
  }
  for (const entry of spends) {
    if (!entry.withdrawnAt && mine(entry)) entry.withdrawnAt = now
  }
  // 잔액 롤업 — 지갑 키와 uid 네임스페이스 키 모두 0으로 초기화한다.
  for (const key of Object.keys(balances)) {
    if ((wallet && key === wallet) || (uid && key === `uid:${uid}`)) balances[key] = 0
  }
  // 온체인 지갑→uid 매핑을 끊는다 — 끊지 않으면 재가입자에게 과거 입금이 다시 귀속된다.
  const uidWallets = Object.keys(wallets).filter((w) => wallets[w] === uid || w === wallet)
  for (const w of uidWallets) delete wallets[w]
  await Promise.all([
    archived ? writeEntries(entries) : Promise.resolve(),
    writeSpends(spends),
    writeBalances(balances),
    uidWallets.length ? writeWallets(wallets) : Promise.resolve(),
  ])
  return { archived }
}

/** 탈퇴로 아카이브된 입금 txid — 재가입자의 입금 스캔/조회에서 제외할 툼스톤. */
export async function withdrawnDepositTxids(): Promise<Set<string>> {
  const entries = await readEntries()
  return new Set(entries.filter((entry) => entry.withdrawnAt).map((entry) => entry.txid))
}
