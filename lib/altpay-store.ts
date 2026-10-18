import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { kvCommand, kvConfigured, netFilePath, netKey } from '@/lib/kv'
import { piRound } from '@/lib/pi-format'
import { getCommissionRates } from '@/lib/settlement-store'
import type { SettlementService } from '@/lib/settlement-types'
import { getRegistryUser, setUserLock } from '@/lib/user-registry'
import { fdsBlockApply, fdsBlockClearBy } from '@/lib/fds-store'

/**
 * 타 결제 수단(Alt-Pay) 완료·미입금 수수료 이월 장부.
 *
 * Pi 결제 실패가 지정 조건(잔액 부족 1회 또는 통신/기타 에러 2회)을 채우면
 * 이용자가 카드·현금·계좌이체 등 다른 수단으로 이용을 완료할 수 있다. 이 때
 * 플랫폼 수수료는 입금되지 않으므로 **서비스 제공자(기사/파트너)의 미입금
 * 수수료 장부**에 적립되고, 이후 정상 서비스 정산(recordSettlement)에서 net을
 * 만들 때 누적 잔액만큼 먼저 차감돼 합산 정산된다.
 *
 * 제공자의 타 결제 완료가 누적 3회 이상이면 파트너 서비스를 자동 차단한다 —
 * 레지스트리 제재(by='ALTPAY') + FDS 블록 맵(by='altpay')이라 기존 게이트
 * (isUserLocked/fdsBlockStatus)가 그대로 집행한다. 미입금 잔액이 0이 되는
 * 순간(정산 차감 또는 관리자 입금 처리) 자동 해제된다.
 *
 * 장부 성격상 네트워크 스코프(netKey) — 테스트넷/메인넷이 섞이지 않는다.
 */

export type AltPayFailKind = 'balance' | 'error' | 'cancel'
export type AltPayMethod = 'card' | 'cash' | 'bank' | 'other'

export type AltPayFail = {
  id: string
  at: string
  userId: string
  service: string
  refId: string
  amount: number | null
  kind: AltPayFailKind
  detail: string
}

export type AltPayRecord = {
  id: string
  at: string
  userId: string
  service: SettlementService
  /** 연결된 이용 건 — 라이드면 ride:<id> 형태 */
  refId: string
  providerId: string
  providerName: string
  /** 이용자가 제공자에게 지급한 금액(Pi 환산액) */
  amount: number
  /** 이 건으로 발생한 플랫폼 미입금 수수료 */
  fee: number
  feeRate: number
  method: AltPayMethod
  /** 라이드 건의 현장 수동 정산 id — 완료 경로(onsitePayId) 재호출의 멱등 키. */
  onsitePayId?: string
  /** 허용 사유 요약 (예: '잔액 부족 1회' / '통신·기타 오류 2회') */
  reason: string
  /** 이 건의 수수료 중 회수된 금액 — fee와 같아지면 완납 */
  recovered: number
  status: 'open' | 'recovered' | 'waived'
  settledAt: string | null
  settledBy: string
}

export type AltPayFeeLedger = {
  providerId: string
  providerName: string
  /** 미입금 잔액 — 정산 시 차감될 누적 수수료 */
  balance: number
  /** 누적 발생액 */
  accrued: number
  /** 누적 회수액(정산 차감 + 관리자 입금 처리) */
  recovered: number
  /** 누적 면제액 */
  waived: number
  /** 타 결제 완료 누적 횟수 — 3회부터 자동 차단 */
  count: number
  lockedAt: string | null
  lastAt: string
}

export type AltPayEligibility = {
  allowed: boolean
  balanceFails: number
  errorFails: number
  reason: string
}

const useKv = kvConfigured
const FAILS_KEY = netKey('taxitago:altpay:fails')
const RECORDS_KEY = netKey('taxitago:altpay:records')
const FEES_KEY = netKey('taxitago:altpay:fees')
const MAX_FAILS = 800
const MAX_RECORDS = 400
const FAIL_TTL_MS = 24 * 60 * 60_000
const FAIL_WINDOW_MS = 24 * 60 * 60_000
/** 자동 차단 발동 횟수 — 타 결제 완료 누적 3회 이상 */
export const ALTPAY_LOCK_COUNT = 3

const failsFile = netFilePath(path.join(process.cwd(), 'data', 'altpay-fails.json'))
const recordsFile = netFilePath(path.join(process.cwd(), 'data', 'altpay-records.json'))
const feesFile = netFilePath(path.join(process.cwd(), 'data', 'altpay-fees.json'))

const globalStore = globalThis as typeof globalThis & {
  __taxitagoAltPayFails?: AltPayFail[]
  __taxitagoAltPayRecords?: AltPayRecord[]
  __taxitagoAltPayFees?: Record<string, AltPayFeeLedger>
}
if (!globalStore.__taxitagoAltPayFails) globalStore.__taxitagoAltPayFails = []
if (!globalStore.__taxitagoAltPayRecords) globalStore.__taxitagoAltPayRecords = []
if (!globalStore.__taxitagoAltPayFees) globalStore.__taxitagoAltPayFees = {}

function readFileJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeFileJson(file: string, value: unknown) {
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readFails(): Promise<AltPayFail[]> {
  if (useKv) {
    try {
      const raw = await kvCommand<string | null>(['GET', FAILS_KEY])
      const parsed = raw ? (JSON.parse(raw) as AltPayFail[]) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      if (!globalStore.__taxitagoAltPayFails!.length) globalStore.__taxitagoAltPayFails = readFileJson(failsFile, [])
      return globalStore.__taxitagoAltPayFails!
    }
  }
  if (!globalStore.__taxitagoAltPayFails!.length) globalStore.__taxitagoAltPayFails = readFileJson(failsFile, [])
  return globalStore.__taxitagoAltPayFails!
}

async function writeFails(list: AltPayFail[]) {
  const trimmed = list.slice(-MAX_FAILS)
  if (useKv) {
    try {
      await kvCommand(['SET', FAILS_KEY, JSON.stringify(trimmed)])
      return
    } catch {
      undefined
    }
  }
  globalStore.__taxitagoAltPayFails = trimmed
  writeFileJson(failsFile, trimmed)
}

async function readRecords(): Promise<AltPayRecord[]> {
  if (useKv) {
    try {
      const raw = await kvCommand<string | null>(['GET', RECORDS_KEY])
      const parsed = raw ? (JSON.parse(raw) as AltPayRecord[]) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      if (!globalStore.__taxitagoAltPayRecords!.length) globalStore.__taxitagoAltPayRecords = readFileJson(recordsFile, [])
      return globalStore.__taxitagoAltPayRecords!
    }
  }
  if (!globalStore.__taxitagoAltPayRecords!.length) globalStore.__taxitagoAltPayRecords = readFileJson(recordsFile, [])
  return globalStore.__taxitagoAltPayRecords!
}

async function writeRecords(list: AltPayRecord[]) {
  const trimmed = list.slice(-MAX_RECORDS)
  if (useKv) {
    try {
      await kvCommand(['SET', RECORDS_KEY, JSON.stringify(trimmed)])
      return
    } catch {
      undefined
    }
  }
  globalStore.__taxitagoAltPayRecords = trimmed
  writeFileJson(recordsFile, trimmed)
}

async function readFees(): Promise<Record<string, AltPayFeeLedger>> {
  if (useKv) {
    try {
      const raw = await kvCommand<string | null>(['GET', FEES_KEY])
      const parsed = raw ? (JSON.parse(raw) as Record<string, AltPayFeeLedger>) : {}
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      if (!Object.keys(globalStore.__taxitagoAltPayFees!).length) globalStore.__taxitagoAltPayFees = readFileJson(feesFile, {})
      return globalStore.__taxitagoAltPayFees!
    }
  }
  if (!Object.keys(globalStore.__taxitagoAltPayFees!).length) globalStore.__taxitagoAltPayFees = readFileJson(feesFile, {})
  return globalStore.__taxitagoAltPayFees!
}

async function writeFees(map: Record<string, AltPayFeeLedger>) {
  if (useKv) {
    try {
      await kvCommand(['SET', FEES_KEY, JSON.stringify(map)])
      return
    } catch {
      undefined
    }
  }
  globalStore.__taxitagoAltPayFees = map
  writeFileJson(feesFile, map)
}

const clip = (value: unknown, max = 120) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/** Pi 결제 실패 사유 분류 — '잔액 부족'과 '통신·기타 에러'만 자격 집계에 쓰인다.
 *  이용자 취소(cancel)는 실패로 세지 않는다. */
export function classifyPayFail(text: string): AltPayFailKind {
  const t = text.toLowerCase()
  if (/cancel|취소|abort|dismiss/.test(t)) return 'cancel'
  if (/insufficient|balance|잔액|부족|not enough|insufficient_funds/.test(t)) return 'balance'
  return 'error'
}

export async function altPayEligibility(userId: string): Promise<AltPayEligibility> {
  const uid = userId.trim()
  if (!uid) return { allowed: false, balanceFails: 0, errorFails: 0, reason: '' }
  const cutoff = Date.now() - FAIL_WINDOW_MS
  const fails = (await readFails()).filter((item) => item.userId === uid && Date.parse(item.at) > cutoff)
  const balanceFails = fails.filter((item) => item.kind === 'balance').length
  const errorFails = fails.filter((item) => item.kind === 'error').length
  const allowed = balanceFails >= 1 || errorFails >= 2
  const reason = balanceFails >= 1 ? `잔액 부족 ${balanceFails}회` : errorFails >= 2 ? `통신·기타 오류 ${errorFails}회` : ''
  return { allowed, balanceFails, errorFails, reason }
}

/** 결제 실패 기록 — 자격 집계의 원천. reason 문자열은 재분류된다. */
export async function recordAltPayFail(input: {
  userId: string
  service?: string
  refId?: string
  amount?: number | null
  reason?: string
  detail?: string
}): Promise<AltPayEligibility> {
  const uid = clip(input.userId, 120)
  if (!uid) return { allowed: false, balanceFails: 0, errorFails: 0, reason: '' }
  const kind = classifyPayFail(`${input.reason || ''} ${input.detail || ''}`)
  if (kind === 'cancel') return altPayEligibility(uid)
  const fails = await readFails()
  fails.push({
    id: randomUUID(),
    at: new Date().toISOString(),
    userId: uid,
    service: clip(input.service, 60),
    refId: clip(input.refId, 120),
    amount: Number.isFinite(input.amount) ? Number(input.amount) : null,
    kind,
    detail: clip(input.detail, 160),
  })
  const cutoff = Date.now() - FAIL_TTL_MS
  await writeFails(fails.filter((item) => Date.parse(item.at) > cutoff))
  return altPayEligibility(uid)
}

async function lockProvider(providerId: string, ledger: AltPayFeeLedger) {
  const reason = `타 결제 수단 반복 사용 ${ledger.count}회 · 미입금 수수료 ${ledger.balance.toFixed(2)} Pi`
  ledger.lockedAt = new Date().toISOString()
  await fdsBlockApply(providerId, { by: 'altpay', reason }).catch(() => undefined)
}

async function unlockProvider(providerId: string, ledger: AltPayFeeLedger) {
  ledger.lockedAt = null
  ledger.count = 0
  // FDS 블록 맵의 altpay 항목 + 레지스트리의 ALTPAY 정지만 해제한다.
  await fdsBlockClearBy(providerId, ['altpay']).catch(() => undefined)
  const registryUser = await getRegistryUser(providerId).catch(() => null)
  if (registryUser?.lockedAt && registryUser.lockedBy === 'ALTPAY') {
    await setUserLock(providerId, false).catch(() => undefined)
  }
}

/**
 * 타 결제 수단 완료 처리 — 자격 검증 → 기록 → 제공자 수수료 장부 적립 →
 * 누적 3회 이상이면 자동 차단. 같은 이용 건(userId+refId+service)은 멱등이다.
 */
export async function completeViaAltPay(input: {
  userId: string
  service: SettlementService
  refId?: string
  providerId: string
  providerName?: string
  amount: number
  method?: AltPayMethod
  onsitePayId?: string
}): Promise<{ ok: boolean; error?: string; record?: AltPayRecord; ledger?: AltPayFeeLedger; locked?: boolean; eligibility?: AltPayEligibility }> {
  const uid = clip(input.userId, 120)
  const providerId = clip(input.providerId, 120)
  const amount = Number(input.amount)
  if (!uid || !providerId || !Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'invalid_fields' }
  const refId = clip(input.refId, 120)
  const method: AltPayMethod = input.method === 'card' || input.method === 'cash' || input.method === 'bank' ? input.method : 'other'

  // 멱등 조회가 자격 검사보다 먼저 — 완료 성공 시 실패 기록을 소비하므로
  // 재시도는 자격이 이미 소진된 상태로 온다.
  const records = await readRecords()
  const dedupeKey = `${uid}|${input.service}|${refId}`
  const existing = records.find((row) => `${row.userId}|${row.service}|${row.refId}` === dedupeKey && row.status !== 'waived')
  const fees = await readFees()
  if (existing) {
    const ledger0 = fees[providerId] ?? null
    return { ok: true, record: existing, ledger: ledger0 ?? undefined, locked: Boolean(ledger0?.lockedAt) }
  }
  const eligibility = await altPayEligibility(uid)
  if (!eligibility.allowed) return { ok: false, error: 'not_eligible', eligibility }
  const ledger: AltPayFeeLedger = fees[providerId] ?? {
    providerId,
    providerName: clip(input.providerName, 80) || providerId,
    balance: 0,
    accrued: 0,
    recovered: 0,
    waived: 0,
    count: 0,
    lockedAt: null,
    lastAt: new Date().toISOString(),
  }

  const rates = await getCommissionRates().catch(() => null)
  const feeRate = rates?.[input.service] ?? 0
  const fee = piRound(amount * feeRate / 100)
  const record: AltPayRecord = {
    id: randomUUID(),
    at: new Date().toISOString(),
    userId: uid,
    service: input.service,
    refId,
    providerId,
    providerName: clip(input.providerName, 80),
    amount: piRound(amount),
    fee,
    feeRate,
    method,
    onsitePayId: clip(input.onsitePayId, 60) || undefined,
    reason: eligibility.reason,
    recovered: 0,
    status: 'open',
    settledAt: null,
    settledBy: '',
  }
  records.push(record)
  await writeRecords(records)

  ledger.providerName = clip(input.providerName, 80) || ledger.providerName
  ledger.balance = piRound(ledger.balance + fee)
  ledger.accrued = piRound(ledger.accrued + fee)
  ledger.count += 1
  ledger.lastAt = record.at
  let locked = Boolean(ledger.lockedAt)
  if (!locked && ledger.count >= ALTPAY_LOCK_COUNT) {
    await lockProvider(providerId, ledger)
    locked = true
  }
  fees[providerId] = ledger
  await writeFees(fees)
  // 자격 소비 — 한 번의 타 결제 완료가 자격을 사용한 것으로 처리해,
  // 같은 실패 누적으로 무한 반복 호출해 제공자 카운트를 부풀리는 악용을 막는다.
  const fails = await readFails()
  const kept = fails.filter((item) => item.userId !== uid)
  if (kept.length !== fails.length) await writeFails(kept)
  return { ok: true, record, ledger, locked, eligibility }
}

/** 레코드 FIFO 회수 배분 — 잔액 감소분을 제공자의 open 레코드 순서대로 반영한다. */
async function distributeRecovery(providerId: string, amount: number, by: string) {
  if (amount <= 0) return
  let remain = amount
  const records = await readRecords()
  const mine = records.filter((row) => row.providerId === providerId && row.status === 'open')
  for (const record of mine) {
    if (remain <= 0) break
    const owed = piRound(record.fee - record.recovered)
    const take = Math.min(owed, remain)
    record.recovered = piRound(record.recovered + take)
    remain = piRound(remain - take)
    if (record.recovered >= record.fee) {
      record.status = 'recovered'
      record.settledAt = new Date().toISOString()
      record.settledBy = by
    }
  }
  await writeRecords(records)
}

/**
 * 수수료 이월·합산 차감 — 정상 정산(recordSettlement)에서 제공자 net을
 * 만들 때 호출한다. 회수분은 net에서 차감돼 플랫폼 몫이 되며, 잔액이 0이
 * 되면 자동 해제된다. 반환된 carryFee는 장부 net에 반드시 반영해야 한다.
 */
export async function applyAltPayCarryover(providerId: string, maxNet: number): Promise<{ recovered: number; balanceAfter: number; unlocked: boolean }> {
  const id = providerId.trim()
  if (!id || !(maxNet > 0)) return { recovered: 0, balanceAfter: 0, unlocked: false }
  const fees = await readFees()
  const ledger = fees[id]
  if (!ledger || ledger.balance <= 0) return { recovered: 0, balanceAfter: ledger?.balance ?? 0, unlocked: false }
  const wasLocked = Boolean(ledger.lockedAt)
  const recovered = piRound(Math.min(ledger.balance, maxNet))
  ledger.balance = piRound(ledger.balance - recovered)
  ledger.recovered = piRound(ledger.recovered + recovered)
  ledger.lastAt = new Date().toISOString()
  if (ledger.balance <= 0) {
    ledger.balance = 0
    await unlockProvider(id, ledger)
  }
  fees[id] = ledger
  await writeFees(fees)
  await distributeRecovery(id, recovered, 'settlement-carryover')
  return { recovered, balanceAfter: ledger.balance, unlocked: wasLocked && !ledger.lockedAt }
}

/**
 * 이월 회수 롤백 — 정산 직전 회수 후 실제 net 송금이 실패해 장부
 * (recordSettlement)가 남지 않은 경우 잔액과 레코드 배분을 되돌린다.
 * 이 회수로 차단이 풀렸다면 relock으로 자동 차단을 복원한다.
 */
export async function revertAltPayCarryover(providerId: string, recovered: number, relock: boolean) {
  const id = providerId.trim()
  if (!id || !(recovered > 0)) return
  const fees = await readFees()
  const ledger = fees[id]
  if (ledger) {
    ledger.balance = piRound(ledger.balance + recovered)
    ledger.recovered = Math.max(0, piRound(ledger.recovered - recovered))
    ledger.lastAt = new Date().toISOString()
    if (relock && !ledger.lockedAt) {
      ledger.lockedAt = new Date().toISOString()
      await fdsBlockApply(id, { by: 'altpay', reason: `타 결제 미입금 수수료 ${ledger.balance.toFixed(2)} Pi — 회수 실패 재차단` }).catch(() => undefined)
    }
    fees[id] = ledger
    await writeFees(fees)
  }
  // 레코드 배분 되돌리기 — 가장 최근 회수분부터 거슬러 open으로 복원한다.
  let remain = recovered
  const records = await readRecords()
  const mine = records
    .filter((row) => row.providerId === id && row.recovered > 0 && row.status !== 'waived')
    .sort((a, b) => (b.settledAt || b.at).localeCompare(a.settledAt || a.at))
  for (const record of mine) {
    if (remain <= 0) break
    const give = Math.min(record.recovered, remain)
    record.recovered = piRound(record.recovered - give)
    remain = piRound(remain - give)
    if (record.recovered < record.fee) {
      record.status = 'open'
      record.settledAt = null
      record.settledBy = ''
    }
  }
  await writeRecords(records)
}

/** 관리자 수수료 입금 처리 — 오프체인 회수분을 잔액에서 차감한다(0이면 자동 해제). */
export async function settleAltPayFee(providerId: string, amount: number | null, by: string) {
  const id = providerId.trim()
  const fees = await readFees()
  const ledger = fees[id]
  if (!ledger) return { ok: false as const, error: 'not_found' }
  const pay = amount && amount > 0 ? Math.min(piRound(amount), ledger.balance) : ledger.balance
  if (pay <= 0) return { ok: true as const, ledger, paid: 0 }
  ledger.balance = piRound(ledger.balance - pay)
  ledger.recovered = piRound(ledger.recovered + pay)
  ledger.lastAt = new Date().toISOString()
  if (ledger.balance <= 0) {
    ledger.balance = 0
    await unlockProvider(id, ledger)
  }
  fees[id] = ledger
  await writeFees(fees)
  await distributeRecovery(id, pay, by || 'admin')
  return { ok: true as const, ledger, paid: pay }
}

/** 관리자 수수료 면제 — 잔액을 줄이되 recovered에는 올리지 않는다. */
export async function waiveAltPayFee(providerId: string, amount: number | null, by: string) {
  const id = providerId.trim()
  const fees = await readFees()
  const ledger = fees[id]
  if (!ledger) return { ok: false as const, error: 'not_found' }
  const waive = amount && amount > 0 ? Math.min(piRound(amount), ledger.balance) : ledger.balance
  if (waive <= 0) return { ok: true as const, ledger, waived: 0 }
  ledger.balance = piRound(ledger.balance - waive)
  ledger.waived = piRound(ledger.waived + waive)
  ledger.lastAt = new Date().toISOString()
  if (ledger.balance <= 0) {
    ledger.balance = 0
    await unlockProvider(id, ledger)
  }
  fees[id] = ledger
  await writeFees(fees)
  // 면제분도 레코드 회수 배분으로 반영해 open 잔량을 없앤다.
  await distributeRecovery(id, waive, `${by || 'admin'}(면제)`)
  return { ok: true as const, ledger, waived: waive }
}

/** 관리자 수동 차단 해제 — 미입금 잔액이 남아 있어도 풀 수 있다(다음 타 결제
 *  사용 시 count가 다시 누적되며 차단 조건이 재평가된다). */
export async function releaseAltPayLock(providerId: string) {
  const id = providerId.trim()
  const fees = await readFees()
  const ledger = fees[id]
  if (!ledger) return { ok: false as const, error: 'not_found' }
  await unlockProvider(id, ledger)
  fees[id] = ledger
  await writeFees(fees)
  return { ok: true as const, ledger }
}

export async function altPayLedger(providerId: string) {
  const fees = await readFees()
  return fees[providerId.trim()] ?? null
}

export async function listAltPayRecords(filter?: { userId?: string; providerId?: string; status?: AltPayRecord['status'] }) {
  const records = await readRecords()
  return records
    .filter((row) => (!filter?.userId || row.userId === filter.userId) && (!filter?.providerId || row.providerId === filter.providerId) && (!filter?.status || row.status === filter.status))
    .sort((a, b) => b.at.localeCompare(a.at))
}

export async function altPayAdminState() {
  const [records, fees] = await Promise.all([readRecords(), readFees()])
  const ledgers = Object.values(fees).sort((a, b) => b.balance - a.balance)
  return {
    records: [...records].sort((a, b) => b.at.localeCompare(a.at)),
    ledgers,
    summary: {
      total: records.length,
      open: records.filter((row) => row.status === 'open').length,
      lockedProviders: ledgers.filter((row) => row.lockedAt).length,
      outstanding: piRound(ledgers.reduce((sum, row) => sum + row.balance, 0)),
    },
  }
}
