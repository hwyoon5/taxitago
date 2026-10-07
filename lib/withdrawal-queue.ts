import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

/** 직원 계정이 이 금액을 초과해 출금/송금을 요청하면 최고 관리자 승인 대기로 전환된다. */
export const APPROVAL_THRESHOLD_PI = 10
/** 직원의 24시간 누적 직접 송금 한도 — 초과분은 승인 대기로 전환된다. */
export const STAFF_DAILY_LIMIT_PI = 30
/** 직원이 1시간 내 직접 송금할 수 있는 최대 횟수 — 초과 시 승인 대기로 전환된다. */
export const STAFF_HOURLY_MAX_COUNT = 3

export type WithdrawalRequest = {
  id: string
  recipient: string
  amount: number
  memo: string
  reason: string
  requestedBy: string
  requestedByName: string
  /** 승인 대기로 전환된 사유 (고액/일일 한도/연속 송금 감지) */
  flag?: string
  status: 'pending' | 'approved' | 'rejected' | 'sent' | 'failed'
  txid?: string
  decidedBy?: string
  decidedByName?: string
  decidedAt?: string
  error?: string
  createdAt: string
}

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const REQUESTS_KEY = 'taxitago:admin:withdrawal-requests'
const MAX_ENTRIES = 200
const filePath = path.join(process.cwd(), 'data', 'withdrawal-requests.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoWithdrawalQueue?: WithdrawalRequest[] }

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

function readFileEntries(): WithdrawalRequest[] {
  try {
    if (!existsSync(filePath)) return []
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { entries?: WithdrawalRequest[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFileEntries(entries: WithdrawalRequest[]) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ entries }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readEntries(): Promise<WithdrawalRequest[]> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', REQUESTS_KEY])
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as WithdrawalRequest[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  if (!globalStore.__taxitagoWithdrawalQueue) globalStore.__taxitagoWithdrawalQueue = readFileEntries()
  return globalStore.__taxitagoWithdrawalQueue
}

async function writeEntries(entries: WithdrawalRequest[]) {
  const trimmed = entries.slice(-MAX_ENTRIES)
  if (useKv) {
    await kvCommand(['SET', REQUESTS_KEY, JSON.stringify(trimmed)])
    return
  }
  globalStore.__taxitagoWithdrawalQueue = trimmed
  writeFileEntries(trimmed)
}

export async function queueWithdrawal(input: {
  recipient: string
  amount: number
  memo: string
  reason: string
  requestedBy: string
  requestedByName: string
  flag?: string
}): Promise<WithdrawalRequest> {
  const entry: WithdrawalRequest = {
    id: crypto.randomUUID(),
    recipient: input.recipient,
    amount: input.amount,
    memo: input.memo,
    reason: input.reason,
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    flag: input.flag,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  const entries = await readEntries()
  entries.push(entry)
  await writeEntries(entries)
  return entry
}

/** 승인 없이 즉시 전송된 출금도 집행 내역으로 남겨 속도 제한·모니터링에 사용한다. */
export async function recordSentWithdrawal(input: {
  recipient: string
  amount: number
  memo: string
  reason: string
  requestedBy: string
  requestedByName: string
  txid: string
}): Promise<WithdrawalRequest> {
  const entry: WithdrawalRequest = {
    id: crypto.randomUUID(),
    recipient: input.recipient,
    amount: input.amount,
    memo: input.memo,
    reason: input.reason,
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    status: 'sent',
    txid: input.txid,
    createdAt: new Date().toISOString(),
  }
  const entries = await readEntries()
  entries.push(entry)
  await writeEntries(entries)
  return entry
}

/** 해당 직원이 실제로 전송한(즉시 전송 + 승인 완료) 내역 중 최근 windowMs 이내 건. */
export async function staffRecentSends(staffId: string, windowMs: number): Promise<WithdrawalRequest[]> {
  const cutoff = Date.now() - windowMs
  const entries = await readEntries()
  return entries.filter(
    (entry) =>
      entry.requestedBy === staffId &&
      (entry.status === 'sent' || entry.status === 'approved') &&
      new Date(entry.createdAt).getTime() >= cutoff,
  )
}

export async function getWithdrawalRequest(id: string): Promise<WithdrawalRequest | null> {
  const entries = await readEntries()
  return entries.find((entry) => entry.id === id) ?? null
}

export async function listWithdrawalRequests(limit = 100): Promise<WithdrawalRequest[]> {
  const entries = await readEntries()
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
}

/** 승인 처리 — 대기 상태일 때만 approved로 바꾼다 (중복 승인 방지). */
export async function markWithdrawalApproved(
  id: string,
  decidedBy: { staffId: string; staffName: string },
  txid: string,
): Promise<WithdrawalRequest | null> {
  const entries = await readEntries()
  const entry = entries.find((item) => item.id === id)
  if (!entry || entry.status !== 'pending') return null
  entry.status = 'approved'
  entry.txid = txid
  entry.decidedBy = decidedBy.staffId
  entry.decidedByName = decidedBy.staffName
  entry.decidedAt = new Date().toISOString()
  delete entry.error
  await writeEntries(entries)
  return entry
}

export async function markWithdrawalRejected(
  id: string,
  decidedBy: { staffId: string; staffName: string },
): Promise<WithdrawalRequest | null> {
  const entries = await readEntries()
  const entry = entries.find((item) => item.id === id)
  if (!entry || entry.status !== 'pending') return null
  entry.status = 'rejected'
  entry.decidedBy = decidedBy.staffId
  entry.decidedByName = decidedBy.staffName
  entry.decidedAt = new Date().toISOString()
  await writeEntries(entries)
  return entry
}

/** 승인된 송금이 체인 전송에 실패했을 때 상태만 기록 (재시도 가능하도록 pending 복귀는 하지 않음). */
export async function markWithdrawalFailed(id: string, error: string): Promise<void> {
  const entries = await readEntries()
  const entry = entries.find((item) => item.id === id)
  if (!entry || entry.status !== 'pending') return
  entry.error = error
  await writeEntries(entries)
}
