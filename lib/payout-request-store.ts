import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

/**
 * 기사·파트너 수익 출금 신청 장부.
 * 신청자가 POST /api/payout-requests로 접수하면 'pending'으로 쌓이고,
 * 관리자가 /api/admin/payouts에서 승인(체인 송금) 또는 반려하면 상태가 바뀐다.
 * 대기+승인 건은 신청자의 '출금 가능 수익'에서 홀드로 차감한다.
 */

export type PayoutStatus = 'pending' | 'approved' | 'rejected' | 'failed'

export type PayoutRequest = {
  id: string
  role: 'driver' | 'partner'
  /** 기사 driverId 또는 파트너 uid */
  applicantId: string
  /** 수익 병합용 별칭 id (로그인 전 기기 id 등) */
  aliasIds: string[]
  applicantName: string
  amount: number
  wallet: string
  memo: string
  status: PayoutStatus
  txid?: string
  rejectReason?: string
  error?: string
  decidedBy?: string
  decidedByName?: string
  decidedAt?: string
  createdAt: string
}

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const REQUESTS_KEY = 'taxitago:payout-requests'
const MAX_ENTRIES = 300
const filePath = path.join(process.cwd(), 'data', 'payout-requests.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoPayoutRequests?: PayoutRequest[] }

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

function readFileEntries(): PayoutRequest[] {
  try {
    if (!existsSync(filePath)) return []
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { entries?: PayoutRequest[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFileEntries(entries: PayoutRequest[]) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ entries }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readEntries(): Promise<PayoutRequest[]> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', REQUESTS_KEY])
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as PayoutRequest[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  if (!globalStore.__taxitagoPayoutRequests) globalStore.__taxitagoPayoutRequests = readFileEntries()
  return globalStore.__taxitagoPayoutRequests
}

async function writeEntries(entries: PayoutRequest[]) {
  const trimmed = entries.slice(-MAX_ENTRIES)
  if (useKv) {
    await kvCommand(['SET', REQUESTS_KEY, JSON.stringify(trimmed)])
    return
  }
  globalStore.__taxitagoPayoutRequests = trimmed
  writeFileEntries(trimmed)
}

export async function queuePayoutRequest(input: {
  role: 'driver' | 'partner'
  applicantId: string
  aliasIds: string[]
  applicantName: string
  amount: number
  wallet: string
  memo: string
}): Promise<PayoutRequest> {
  const entry: PayoutRequest = {
    id: crypto.randomUUID(),
    ...input,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  const entries = await readEntries()
  entries.push(entry)
  await writeEntries(entries)
  return entry
}

export async function listPayoutRequests(limit = 200): Promise<PayoutRequest[]> {
  const entries = await readEntries()
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
}

/** 신청자 본인(별칭 포함)의 신청 내역. */
export async function listPayoutRequestsFor(ids: string[], limit = 100): Promise<PayoutRequest[]> {
  const wanted = new Set(ids.filter(Boolean))
  const entries = await listPayoutRequests(500)
  return entries
    .filter((entry) => wanted.has(entry.applicantId) || entry.aliasIds.some((id) => wanted.has(id)))
    .slice(0, limit)
}

export async function getPayoutRequest(id: string): Promise<PayoutRequest | null> {
  const entries = await readEntries()
  return entries.find((entry) => entry.id === id) ?? null
}

/** 출금 가능 수익 계산 시 차감할 홀드 합계 — 대기 중 + 승인 완료 건. */
export async function heldPayoutTotal(ids: string[]): Promise<number> {
  const wanted = new Set(ids.filter(Boolean))
  const entries = await readEntries()
  return entries
    .filter(
      (entry) =>
        (entry.status === 'pending' || entry.status === 'approved') &&
        (wanted.has(entry.applicantId) || entry.aliasIds.some((id) => wanted.has(id))),
    )
    .reduce((sum, entry) => sum + entry.amount, 0)
}

/** 승인 처리 — 대기 상태일 때만 approved로 바꾼다 (중복 승인 방지). */
export async function markPayoutApproved(
  id: string,
  decidedBy: { staffId: string; staffName: string },
  txid: string,
): Promise<PayoutRequest | null> {
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

export async function markPayoutRejected(
  id: string,
  decidedBy: { staffId: string; staffName: string },
  reason: string,
): Promise<PayoutRequest | null> {
  const entries = await readEntries()
  const entry = entries.find((item) => item.id === id)
  if (!entry || entry.status !== 'pending') return null
  entry.status = 'rejected'
  entry.rejectReason = reason
  entry.decidedBy = decidedBy.staffId
  entry.decidedByName = decidedBy.staffName
  entry.decidedAt = new Date().toISOString()
  await writeEntries(entries)
  return entry
}

/** 승인된 송금이 체인 전송에 실패했을 때 상태만 기록한다. */
export async function markPayoutFailed(id: string, error: string): Promise<void> {
  const entries = await readEntries()
  const entry = entries.find((item) => item.id === id)
  if (!entry || entry.status !== 'pending') return
  entry.status = 'failed'
  entry.error = error
  await writeEntries(entries)
}
