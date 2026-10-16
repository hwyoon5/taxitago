import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { kvCommand, kvConfigured } from '@/lib/kv'
import { piRound } from '@/lib/pi-format'

/**
 * 미수금(Receivable) 장부 — 자전거·킥보드·주차·EV 충전 같은 셀프/무인
 * 서비스의 종료 시점 Pi 결제가 실패(잔액 부족·취소·네트워크)하면 이용자
 * 식별 정보와 미수 금액을 기록해 운영자가 수동 정산을 추적하게 한다.
 * 'open' 상태는 이용자+건당 1건만 유지하고 재실패 시 금액·사유를 최신화한다 —
 * 사용자가 결제 버튼을 여러 번 눌러도 장부가 중복으로 늘어나지 않는다.
 */
export type ReceivableStatus = 'open' | 'settled' | 'void'

export type ReceivableRecord = {
  id: string
  /** open 상태 dedupe 키 — 같은 이용자의 같은 이용 건은 1건으로 합친다. */
  dedupeKey: string
  /** Pi uid 또는 로컬 passenger id */
  userId: string
  /** Pi 지갑 주소 — 세션에서 확인된 경우만 */
  wallet: string
  /** 가입 시 본인인증된 전화번호 */
  phone: string
  /** 서비스 표시명 (예: '자전거 이용') */
  service: string
  /** 서비스 키 (bicycle|kickboard|ev|parking 등) */
  serviceKey: string
  partnerId: string
  partnerName: string
  /** 기기 시리얼/ID — 무기기 서비스면 빈 문자열 */
  deviceId: string
  place: string
  /** 미수 금액 (Pi) */
  amount: number
  /** 실패 분류 — 'insufficient' | 'cancelled' | 'failed' */
  reason: string
  /** 원본 오류 메시지 (최대 160자) */
  detail: string
  status: ReceivableStatus
  /** 실패 누적 횟수 — 재시도할 때마다 증가 */
  attempts: number
  createdAt: string
  updatedAt: string
  settledAt: string | null
  /** 정산/무효 처리한 운영자 ID */
  settledBy: string
  settleNote: string
}

const useKv = kvConfigured
const RECEIVABLES_KEY = 'taxitago:receivables'
const MAX_ROWS = 2000
const filePath = path.join(process.cwd(), 'data', 'receivables.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoReceivables?: ReceivableRecord[] }
if (!globalStore.__taxitagoReceivables) globalStore.__taxitagoReceivables = []

function readFileRows(): ReceivableRecord[] {
  try {
    if (!existsSync(filePath)) return []
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { entries?: ReceivableRecord[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFileRows(rows: ReceivableRecord[]) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ entries: rows }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readRows(): Promise<ReceivableRecord[]> {
  if (useKv) {
    try {
      const raw = await kvCommand<string | null>(['GET', RECEIVABLES_KEY])
      if (!raw) return []
      const parsed = JSON.parse(raw) as ReceivableRecord[]
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      console.error('[Receivable] kv read failed; using local fallback', error)
      if (!globalStore.__taxitagoReceivables!.length) globalStore.__taxitagoReceivables = readFileRows()
      return globalStore.__taxitagoReceivables!
    }
  }
  if (!globalStore.__taxitagoReceivables!.length) globalStore.__taxitagoReceivables = readFileRows()
  return globalStore.__taxitagoReceivables!
}

async function writeRows(rows: ReceivableRecord[]) {
  const trimmed = rows.slice(-MAX_ROWS)
  if (useKv) {
    try {
      await kvCommand(['SET', RECEIVABLES_KEY, JSON.stringify(trimmed)])
      return
    } catch (error) {
      console.error('[Receivable] kv write failed; falling back to local store', error)
    }
  }
  globalStore.__taxitagoReceivables = trimmed
  writeFileRows(trimmed)
}

const clip = (value: unknown, max = 120) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

/**
 * 결제 실패 신고 → 미수금 기록. 같은 이용자·이용 건(dedupeKey)이 이미
 * open 상태면 금액·사유를 갱신하고 시도 횟수만 올린다 — 새 결제 성공 전
 * 재시도가 장부를 중복으로 부풀리지 않는다.
 */
export async function recordReceivable(input: {
  userId: string
  wallet?: string
  phone?: string
  service: string
  serviceKey?: string
  partnerId?: string
  partnerName?: string
  deviceId?: string
  place?: string
  amount: number
  reason?: string
  detail?: string
}): Promise<ReceivableRecord | null> {
  const userId = clip(input.userId, 64)
  const service = clip(input.service, 60)
  const amount = piRound(Number(input.amount))
  if (!userId || !service || !Number.isFinite(amount) || amount <= 0) {
    console.warn('[Receivable] record skipped: invalid input', { userId, service, amount })
    return null
  }
  const deviceId = clip(input.deviceId, 64)
  const dedupeKey = [userId, deviceId || `${clip(input.serviceKey, 30)}|${clip(input.place, 80)}`].join('|')
  const rows = await readRows()
  const now = new Date().toISOString()
  const open = rows.find((row) => row.status === 'open' && row.dedupeKey === dedupeKey)
  if (open) {
    open.amount = amount
    open.wallet = clip(input.wallet, 80) || open.wallet
    open.phone = clip(input.phone, 30) || open.phone
    open.reason = clip(input.reason, 20) || open.reason
    open.detail = clip(input.detail, 160) || open.detail
    open.attempts += 1
    open.updatedAt = now
    await writeRows(rows)
    return open
  }
  const record: ReceivableRecord = {
    id: randomUUID().replace(/-/g, '').slice(0, 16),
    dedupeKey,
    userId,
    wallet: clip(input.wallet, 80),
    phone: clip(input.phone, 30),
    service,
    serviceKey: clip(input.serviceKey, 30),
    partnerId: clip(input.partnerId, 80),
    partnerName: clip(input.partnerName, 60),
    deviceId,
    place: clip(input.place, 120),
    amount,
    reason: clip(input.reason, 20) || 'failed',
    detail: clip(input.detail, 160),
    status: 'open',
    attempts: 1,
    createdAt: now,
    updatedAt: now,
    settledAt: null,
    settledBy: '',
    settleNote: '',
  }
  rows.push(record)
  await writeRows(rows)
  console.log('[Receivable] recorded', { id: record.id, userId, service, amount, reason: record.reason })
  return record
}

export async function listReceivables(filter?: {
  status?: ReceivableStatus | ''
  partnerId?: string
  userId?: string
}): Promise<ReceivableRecord[]> {
  const rows = await readRows()
  return rows
    .filter((row) => {
      if (filter?.status && row.status !== filter.status) return false
      if (filter?.partnerId && row.partnerId !== filter.partnerId) return false
      if (filter?.userId && row.userId !== filter.userId) return false
      return true
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * 운영자 수동 처리 — settled(수동 정산 완료) 또는 void(무효/면제).
 * 같은 상태 재설정은 no-op으로 멱등을 유지한다.
 */
export async function resolveReceivable(
  id: string,
  input: { status: 'settled' | 'void'; actor: string; note?: string },
): Promise<ReceivableRecord | null> {
  const rows = await readRows()
  const row = rows.find((item) => item.id === id)
  if (!row) return null
  if (row.status === input.status) return row
  row.status = input.status
  row.settledAt = new Date().toISOString()
  row.settledBy = clip(input.actor, 60)
  row.settleNote = clip(input.note, 160)
  row.updatedAt = row.settledAt
  await writeRows(rows)
  return row
}

/** 결제가 뒤늦게 성공했을 때 열린 미수금을 자동 회수 — service-pay 완료 경로에서 호출. */
export async function clearOpenReceivable(userId: string, deviceId: string, amount: number) {
  const uid = clip(userId, 64)
  const dev = clip(deviceId, 64)
  if (!uid) return 0
  const rows = await readRows()
  const now = new Date().toISOString()
  let cleared = 0
  for (const row of rows) {
    if (row.status !== 'open' || row.userId !== uid) continue
    // 기기 건은 기기 ID가 같을 때만, 무기기 건은 금액이 같을 때만 자동 회수한다.
    if (dev ? row.deviceId !== dev : Math.abs(row.amount - piRound(amount)) > 0.0000001) continue
    row.status = 'settled'
    row.settledAt = now
    row.settledBy = 'auto'
    row.settleNote = 'Pi 결제 성공으로 자동 회수'
    row.updatedAt = now
    cleared += 1
  }
  if (cleared) await writeRows(rows)
  return cleared
}
