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
 * 결제 실패 신고 → 미수금 기록 + 페널티 포인트 부여. 같은 이용자·이용 건
 * (dedupeKey)이 이미 open 상태면 금액·사유를 갱신하고 시도 횟수만 올린다 —
 * 새 결제 성공 전 재시도가 장부와 포인트를 중복으로 부풀리지 않는다.
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
}): Promise<{ record: ReceivableRecord; penalty: PenaltyRecord | null } | null> {
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
    return { record: open, penalty: await getPenalty(userId) }
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
  // 반복 미수 페널티 — 새 미수금 1건당 포인트가 누적되고 임계치를 넘으면
  // 셀프·무인 서비스 대여가 일정 기간 제한된다.
  const penalty = await applyPenaltyDelta(userId, PENALTY_PER_RECEIVABLE, {
    wallet: record.wallet,
    phone: record.phone,
    note: `미수 발생 · ${service}`,
  })
  console.log('[Receivable] recorded', { id: record.id, userId, service, amount, reason: record.reason, points: penalty?.points })
  return { record, penalty }
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
 * 운영자·제공자 수동 처리 — settled(수동 정산 완료) 또는 void(무효/면제).
 * 같은 상태 재설정은 no-op으로 멱등을 유지하고, 정산 완료는 페널티
 * 포인트를 건당 자동 감면해 정상 정산 회복과 1:1로 맞물린다.
 */
export async function resolveReceivable(
  id: string,
  input: { status: 'settled' | 'void'; actor: string; note?: string },
): Promise<{ record: ReceivableRecord; penalty: PenaltyRecord | null } | null> {
  const rows = await readRows()
  const row = rows.find((item) => item.id === id)
  if (!row) return null
  if (row.status === input.status) return { record: row, penalty: await getPenalty(row.userId) }
  row.status = input.status
  row.settledAt = new Date().toISOString()
  row.settledBy = clip(input.actor, 60)
  row.settleNote = clip(input.note, 160)
  row.updatedAt = row.settledAt
  await writeRows(rows)
  const penalty =
    input.status === 'settled'
      ? await applyPenaltyDelta(row.userId, -PENALTY_PER_RECEIVABLE, { note: `정산 감면 (${row.id})` })
      : await getPenalty(row.userId)
  return { record: row, penalty }
}

// ── 페널티 포인트 · 이용 제한 ──────────────────────────────────────────────
// 미수금 1건 = +10점. 누적 30점 이상이면 7일, 60점 이상이면 30일간 셀프·무인
// 서비스 대여가 제한된다. 미수금이 정산(settled)되면 건당 -10점 자동 감면되고,
// 30점 미만으로 내려가면 제한이 자동 해제된다. 운영자는 추가 감면·해제가 가능하다.

export type PenaltyRecord = {
  userId: string
  wallet: string
  phone: string
  /** 현재 유효 포인트 — 미수 +10, 정산/감면 -포인트 */
  points: number
  /** 누적 미수 건수(정산 포함) */
  receivableCount: number
  /** 정산·운영자 감면으로 상쇄된 누적 포인트 */
  waivedPoints: number
  /** 대여 제한 해제 시각 — null이면 제한 없음 */
  restrictedUntil: string | null
  note: string
  updatedAt: string
}

export const PENALTY_PER_RECEIVABLE = 10
export const RESTRICT_POINTS = 30
export const RESTRICT_DAYS = 7
export const SUSPEND_POINTS = 60
export const SUSPEND_DAYS = 30

const PENALTIES_KEY = 'taxitago:receivable-penalties'
const penaltiesPath = path.join(process.cwd(), 'data', 'receivable-penalties.json')

const penaltyStore = globalThis as typeof globalThis & { __taxitagoReceivablePenalties?: PenaltyRecord[] }
if (!penaltyStore.__taxitagoReceivablePenalties) penaltyStore.__taxitagoReceivablePenalties = []

function readFilePenalties(): PenaltyRecord[] {
  try {
    if (!existsSync(penaltiesPath)) return []
    const parsed = JSON.parse(readFileSync(penaltiesPath, 'utf8')) as { entries?: PenaltyRecord[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFilePenalties(rows: PenaltyRecord[]) {
  try {
    mkdirSync(path.dirname(penaltiesPath), { recursive: true })
    writeFileSync(penaltiesPath, JSON.stringify({ entries: rows }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readPenalties(): Promise<PenaltyRecord[]> {
  if (useKv) {
    try {
      const raw = await kvCommand<string | null>(['GET', PENALTIES_KEY])
      if (!raw) return []
      const parsed = JSON.parse(raw) as PenaltyRecord[]
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      console.error('[Receivable] penalties kv read failed; using local fallback', error)
      if (!penaltyStore.__taxitagoReceivablePenalties!.length) penaltyStore.__taxitagoReceivablePenalties = readFilePenalties()
      return penaltyStore.__taxitagoReceivablePenalties!
    }
  }
  if (!penaltyStore.__taxitagoReceivablePenalties!.length) penaltyStore.__taxitagoReceivablePenalties = readFilePenalties()
  return penaltyStore.__taxitagoReceivablePenalties!
}

async function writePenalties(rows: PenaltyRecord[]) {
  if (useKv) {
    try {
      await kvCommand(['SET', PENALTIES_KEY, JSON.stringify(rows)])
      return
    } catch (error) {
      console.error('[Receivable] penalties kv write failed; falling back to local store', error)
    }
  }
  penaltyStore.__taxitagoReceivablePenalties = rows
  writeFilePenalties(rows)
}

/** 포인트에 따른 제한 기간 — 30점 미만이면 해제, 구간별로 기존 만기와 max를 취한다. */
function restrictionFor(points: number, current: string | null): string | null {
  if (points < RESTRICT_POINTS) return null
  const days = points >= SUSPEND_POINTS ? SUSPEND_DAYS : RESTRICT_DAYS
  const next = new Date(Date.now() + days * 86_400_000).toISOString()
  return current && Date.parse(current) > Date.parse(next) ? current : next
}

async function applyPenaltyDelta(
  userId: string,
  delta: number,
  context: { wallet?: string; phone?: string; note?: string },
): Promise<PenaltyRecord | null> {
  const uid = clip(userId, 64)
  if (!uid || !delta) return null
  const rows = await readPenalties()
  let row = rows.find((item) => item.userId === uid)
  const now = new Date().toISOString()
  if (!row) {
    row = {
      userId: uid,
      wallet: '',
      phone: '',
      points: 0,
      receivableCount: 0,
      waivedPoints: 0,
      restrictedUntil: null,
      note: '',
      updatedAt: now,
    }
    rows.push(row)
  }
  row.points = Math.max(0, row.points + delta)
  if (delta < 0) row.waivedPoints += -delta
  if (delta > 0) row.receivableCount += 1
  row.wallet = clip(context.wallet, 80) || row.wallet
  row.phone = clip(context.phone, 30) || row.phone
  row.note = clip(context.note, 160) || row.note
  row.restrictedUntil = restrictionFor(row.points, row.restrictedUntil)
  row.updatedAt = now
  await writePenalties(rows)
  return row
}

/** 이용 제한 조회 — 대여 전이 등 서비스 게이트에서 호출한다. */
export async function receivableRestriction(userId: string): Promise<{ restricted: boolean; until: string | null; points: number }> {
  const uid = clip(userId, 64)
  if (!uid) return { restricted: false, until: null, points: 0 }
  const rows = await readPenalties()
  const row = rows.find((item) => item.userId === uid)
  if (!row) return { restricted: false, until: null, points: 0 }
  const until = row.restrictedUntil && Date.parse(row.restrictedUntil) > Date.now() ? row.restrictedUntil : null
  return { restricted: Boolean(until), until, points: row.points }
}

export async function getPenalty(userId: string): Promise<PenaltyRecord | null> {
  const uid = clip(userId, 64)
  if (!uid) return null
  const rows = await readPenalties()
  return rows.find((item) => item.userId === uid) ?? null
}

export async function listPenalties(): Promise<PenaltyRecord[]> {
  const rows = await readPenalties()
  return [...rows].sort((a, b) => b.points - a.points || b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * 운영자·제공자 감면 — points만큼 차감하거나 제한을 즉시 해제한다.
 * 포인트가 30점 미만으로 내려가면 제한은 자동으로 함께 풀린다.
 */
export async function relievePenalty(
  userId: string,
  input: { points?: number; clearRestriction?: boolean; actor: string; note?: string },
): Promise<PenaltyRecord | null> {
  const uid = clip(userId, 64)
  if (!uid) return null
  const delta = Math.max(0, Math.floor(Number(input.points) || 0))
  const row = delta ? await applyPenaltyDelta(uid, -delta, { note: input.note || `감면 (${input.actor})` }) : await getPenalty(uid)
  if (!row) return null
  if (input.clearRestriction && row.restrictedUntil) {
    const rows = await readPenalties()
    const target = rows.find((item) => item.userId === uid)
    if (target) {
      target.restrictedUntil = null
      target.note = clip(input.note, 160) || `제한 해제 (${input.actor})`
      target.updatedAt = new Date().toISOString()
      await writePenalties(rows)
    }
    return target ?? row
  }
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
  if (cleared) {
    await writeRows(rows)
    // 정산 회복 감면 — 자동 회수 건당 포인트를 돌려준다.
    await applyPenaltyDelta(uid, -PENALTY_PER_RECEIVABLE * cleared, { note: 'Pi 정산 완료 자동 감면' }).catch(() => null)
  }
  return cleared
}

/**
 * 제공자용 미수금 집계 — 자사 기기의 open 건을 주간(7일)·월간(30일) 창과
 * 이용자별로 묶어, 주/월 단위 Pi 송금 안내·정산 유도에 쓴다.
 */
export async function receivableSummary(partnerId: string) {
  const rows = (await listReceivables({ status: 'open', partnerId: clip(partnerId, 80) }))
  const now = Date.now()
  const WEEK = 7 * 86_400_000
  const MONTH = 30 * 86_400_000
  const inWindow = (iso: string, ms: number) => now - Date.parse(iso) <= ms
  const byUserMap = new Map<string, { userId: string; wallet: string; phone: string; count: number; amount: number; latestAt: string }>()
  for (const row of rows) {
    const key = row.userId || row.wallet || row.phone || 'unknown'
    const agg = byUserMap.get(key) ?? { userId: row.userId, wallet: row.wallet, phone: row.phone, count: 0, amount: 0, latestAt: row.createdAt }
    agg.count += 1
    agg.amount = piRound(agg.amount + row.amount)
    if (!agg.wallet && row.wallet) agg.wallet = row.wallet
    if (!agg.phone && row.phone) agg.phone = row.phone
    if (row.createdAt > agg.latestAt) agg.latestAt = row.createdAt
    byUserMap.set(key, agg)
  }
  const sum = (ms: number) => {
    const items = rows.filter((row) => inWindow(row.createdAt, ms))
    return { count: items.length, total: piRound(items.reduce((acc, row) => acc + row.amount, 0)) }
  }
  return {
    openCount: rows.length,
    openTotal: piRound(rows.reduce((acc, row) => acc + row.amount, 0)),
    week: sum(WEEK),
    month: sum(MONTH),
    byUser: [...byUserMap.values()].sort((a, b) => b.amount - a.amount),
  }
}
