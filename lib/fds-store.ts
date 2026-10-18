import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { getRegistryUser, setUserLock } from '@/lib/user-registry'

/**
 * FDS(부정 거래·이상 탐지) 룰 엔진.
 *
 * - 서비스 이벤트를 '시그널'로 적재하고, 계정/쌍 단위의 단시간 패턴이
 *   룰 임계치를 넘으면 '경보(alert)'를 만들고 자동 차단(block)을 건다.
 * - 차단은 두 갈래: 레지스트리 등록 계정은 기존 제재 필드(lockedAt/
 *   lockedUntil, setUserLock — by='FDS')에 기간 정지를 쓰고, 미등록 로컬
 *   id(테스트 단말·비회원 승객)는 fds:blocks 맵에 별도 차단을 둔다.
 * - 전부 계정 보안 데이터이므로 네트워크 스코프 없이 전역 키를 쓴다.
 *   KV 미설정 환경은 data/*.json 파일 + 프로세스 메모리로 폴백.
 */

export type FdsSignalKind =
  | 'payment-fail' // 반복 결제 실패·중단
  | 'escrow-small' // 비정상 소액 다건 에스크로 예치
  | 'ride-flood' // 단시간 반복 호출
  | 'cancel-streak' // 연속 취소
  | 'match-churn' // 동일 기사-승객 수락·취소 반복

export type FdsSignal = {
  at: string
  kind: FdsSignalKind
  actorId: string
  /** match-churn의 기사|승객 쌍 식별자 등 그룹 키. */
  groupId?: string
  refId?: string
  amount?: number
  detail?: string
}

export type FdsAlert = {
  id: string
  at: string
  rule: FdsSignalKind
  ruleLabel: string
  severity: 'watch' | 'suspend'
  actorIds: string[]
  detail: string
  /** flagged=감시만 / suspended=자동 정지 적용 */
  action: 'flagged' | 'suspended'
  until?: string
  resolvedAt?: string
  resolvedBy?: string
}

export type FdsBlock = {
  at: string
  by: 'fds' | 'admin'
  reason: string
  /** 없으면 수동 영구 차단. */
  until?: string
  alertId?: string
}

type FdsRule = {
  label: string
  windowMs: number
  /** 이 횟수부터 경보(감시) 등록 */
  watch: number
  /** 이 횟수부터 자동 정지 */
  suspend: number
  suspendMin: number
}

const RULES: Record<FdsSignalKind, FdsRule> = {
  'payment-fail': { label: '단시간 반복 결제 실패·중단', windowMs: 15 * 60_000, watch: 3, suspend: 5, suspendMin: 60 },
  'escrow-small': { label: '비정상 소액 다건 에스크로 예치', windowMs: 30 * 60_000, watch: 3, suspend: 5, suspendMin: 60 },
  'ride-flood': { label: '단시간 반복 호출', windowMs: 10 * 60_000, watch: 5, suspend: 8, suspendMin: 30 },
  'cancel-streak': { label: '연속 취소 패턴', windowMs: 30 * 60_000, watch: 3, suspend: 4, suspendMin: 45 },
  'match-churn': { label: '동일 기사·승객 허위 매칭·취소 반복', windowMs: 120 * 60_000, watch: 2, suspend: 3, suspendMin: 120 },
}

/** 이 미만 금액의 에스크로 예치는 '소액 다건' 시그널로 집계한다. */
export const FDS_SMALL_ESCROW_PI = 1

const SIGNALS_KEY = 'taxitago:fds:signals'
const ALERTS_KEY = 'taxitago:fds:alerts'
const BLOCKS_KEY = 'taxitago:fds:blocks'
const MAX_SIGNALS = 600
const MAX_ALERTS = 300
const SIGNAL_TTL_MS = 24 * 60 * 60_000
/** 같은 룰·같은 대상의 경보 재발 최소 간격 — 차단 기간 내 재감지 폭주 방지. */
const ALERT_COOLDOWN_MS = 30 * 60_000

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const signalsFile = path.join(process.cwd(), 'data', 'fds-signals.json')
const alertsFile = path.join(process.cwd(), 'data', 'fds-alerts.json')
const blocksFile = path.join(process.cwd(), 'data', 'fds-blocks.json')

const globalStore = globalThis as typeof globalThis & {
  __taxitagoFdsSignals?: FdsSignal[]
  __taxitagoFdsAlerts?: FdsAlert[]
  __taxitagoFdsBlocks?: Record<string, FdsBlock>
}

async function kvCommand<T>(command: (string | number)[]): Promise<T | null> {
  const res = await fetch(kvUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`kv request failed: ${res.status}`)
  const data = (await res.json()) as { result?: T | null }
  return data.result ?? null
}

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

async function readList<T>(key: string, file: string, cacheKey: 'signals' | 'alerts'): Promise<T[]> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', key])
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as T[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  if (cacheKey === 'signals') {
    if (!globalStore.__taxitagoFdsSignals) globalStore.__taxitagoFdsSignals = readFileJson(file, [])
    return globalStore.__taxitagoFdsSignals as T[]
  }
  if (!globalStore.__taxitagoFdsAlerts) globalStore.__taxitagoFdsAlerts = readFileJson(file, [])
  return globalStore.__taxitagoFdsAlerts as T[]
}

async function writeList<T>(key: string, file: string, cacheKey: 'signals' | 'alerts', list: T[]) {
  if (useKv) {
    await kvCommand(['SET', key, JSON.stringify(list)])
    return
  }
  if (cacheKey === 'signals') globalStore.__taxitagoFdsSignals = list as FdsSignal[]
  else globalStore.__taxitagoFdsAlerts = list as FdsAlert[]
  writeFileJson(file, list)
}

const readSignals = () => readList<FdsSignal>(SIGNALS_KEY, signalsFile, 'signals')
const writeSignals = (list: FdsSignal[]) => writeList(SIGNALS_KEY, signalsFile, 'signals', list)
const readAlerts = () => readList<FdsAlert>(ALERTS_KEY, alertsFile, 'alerts')
const writeAlerts = (list: FdsAlert[]) => writeList(ALERTS_KEY, alertsFile, 'alerts', list)

async function readBlocks(): Promise<Record<string, FdsBlock>> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', BLOCKS_KEY])
    if (!raw) return {}
    try {
      const parsed = JSON.parse(raw) as Record<string, FdsBlock>
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  if (!globalStore.__taxitagoFdsBlocks) globalStore.__taxitagoFdsBlocks = readFileJson(blocksFile, {})
  return globalStore.__taxitagoFdsBlocks
}

async function writeBlocks(map: Record<string, FdsBlock>) {
  if (useKv) {
    await kvCommand(['SET', BLOCKS_KEY, JSON.stringify(map)])
    return
  }
  globalStore.__taxitagoFdsBlocks = map
  writeFileJson(blocksFile, map)
}

function blockActive(block: FdsBlock): boolean {
  if (!block.until) return true
  return Date.parse(block.until) > Date.now()
}

/** FDS 자동/수동 차단 상태 — 기존 isUserLocked(레지스트리 제재)와 별개로
 *  미등록 로컬 id도 차단한다. 게이트는 둘 다 검사해야 한다. */
export async function fdsBlockStatus(actorId: string): Promise<{ blocked: boolean; reason?: string; until?: string }> {
  const id = actorId.trim()
  if (!id) return { blocked: false }
  const blocks = await readBlocks()
  const block = blocks[id]
  if (block && blockActive(block)) return { blocked: true, reason: block.reason, until: block.until }
  return { blocked: false }
}

/** 자동·수동 차단 적용 — 미등록 id는 FDS 블록 맵에, 등록 계정은 레지스트리
 *  정지(기존 제재 게이트가 그대로 집행)에 기록한다. */
async function applyBlock(actorId: string, minutes: number | null, reason: string, alertId: string) {
  const id = actorId.trim()
  if (!id) return
  const until = minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : undefined
  const registryUser = await getRegistryUser(id).catch(() => null)
  if (registryUser && !registryUser.withdrawnAt) {
    await setUserLock(id, true, { by: 'FDS', reason, until }).catch(() => undefined)
  }
  // 등록·미등록 모두 FDS 블록에도 기록 — 로컬 id 차단 + 관리자 화면 표시.
  const blocks = await readBlocks()
  blocks[id] = { at: new Date().toISOString(), by: 'fds', reason, until, alertId }
  await writeBlocks(blocks)
}

async function raiseAlert(input: Omit<FdsAlert, 'id' | 'at'>) {
  const alerts = await readAlerts()
  const alert: FdsAlert = { id: `fds-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), ...input }
  alerts.unshift(alert)
  await writeAlerts(alerts.slice(0, MAX_ALERTS))
  return alert
}

/**
 * 시그널 적재 + 룰 평가. 임계치 도달 시 경보를 만들고 suspend 임계면 자동
 * 차단까지 건다. 베스트 에포트 — 호출부는 void로 발사해도 된다.
 */
export async function recordFdsSignal(
  kind: FdsSignalKind,
  input: { actorId: string; groupId?: string; refId?: string; amount?: number; detail?: string },
): Promise<{ alert?: 'watch' | 'suspend' }> {
  const actorId = input.actorId.trim()
  if (!actorId) return {}
  const now = new Date().toISOString()
  const signals = await readSignals()
  const cutoff = Date.now() - SIGNAL_TTL_MS
  const kept = signals.filter((item) => Date.parse(item.at) > cutoff)
  kept.unshift({ at: now, kind, actorId, groupId: input.groupId, refId: input.refId, amount: input.amount, detail: input.detail })
  await writeSignals(kept.slice(0, MAX_SIGNALS))

  const rule = RULES[kind]
  const windowStart = Date.now() - rule.windowMs
  // match-churn은 쌍(groupId) 단위로, 나머지는 행위자 단위로 집계한다.
  const count = kept.filter((item) => {
    if (item.kind !== kind || Date.parse(item.at) < windowStart) return false
    return kind === 'match-churn' ? item.groupId === input.groupId : item.actorId === actorId
  }).length
  if (count < rule.watch) return {}

  // 쿨다운 내 동일 룰 경보 재발 방지.
  const alerts = await readAlerts()
  const recent = alerts.find(
    (alert) => alert.rule === kind && alert.actorIds.includes(actorId) && Date.parse(alert.at) > Date.now() - ALERT_COOLDOWN_MS,
  )
  if (recent) return { alert: recent.severity }

  const suspend = count >= rule.suspend
  const until = suspend ? new Date(Date.now() + rule.suspendMin * 60_000).toISOString() : undefined
  const detail = `${rule.label} · ${rule.windowMs / 60_000}분 내 ${count}회${input.groupId ? ` · 쌍 ${input.groupId}` : ''}${input.detail ? ` — ${input.detail.slice(0, 120)}` : ''}`
  const alert = await raiseAlert({
    rule: kind,
    ruleLabel: rule.label,
    severity: suspend ? 'suspend' : 'watch',
    actorIds: [actorId],
    detail,
    action: suspend ? 'suspended' : 'flagged',
    until,
  })
  if (suspend) {
    await applyBlock(actorId, rule.suspendMin, `FDS 자동 차단 — ${detail}`, alert.id)
    // 쌍 패턴(match-churn)은 상대방도 감시 대상으로 남긴다 — 차단은
    // 취소를 반복한 행위자에게만 건다.
  }
  return { alert: suspend ? 'suspend' : 'watch' }
}

/** 관리자 수동 차단 — until 생략 시 영구. */
export async function fdsBlockManually(actorId: string, input: { reason: string; until?: string; by?: string }) {
  const id = actorId.trim()
  if (!id) return { ok: false as const, error: 'actor_required' }
  const blocks = await readBlocks()
  blocks[id] = { at: new Date().toISOString(), by: 'admin', reason: input.reason.slice(0, 200), until: input.until }
  await writeBlocks(blocks)
  const registryUser = await getRegistryUser(id).catch(() => null)
  if (registryUser && !registryUser.withdrawnAt) {
    await setUserLock(id, true, { by: input.by || 'FDS', reason: input.reason, until: input.until }).catch(() => undefined)
  }
  return { ok: true as const }
}

/** 차단 해제 — FDS 블록과 'FDS'가 건 레지스트리 정지를 함께 푼다.
 *  관리자가 별도로 건 정지(lockedBy ≠ FDS)는 건드리지 않는다. */
export async function fdsRelease(actorId: string) {
  const id = actorId.trim()
  const blocks = await readBlocks()
  if (blocks[id]) {
    delete blocks[id]
    await writeBlocks(blocks)
  }
  const registryUser = await getRegistryUser(id).catch(() => null)
  if (registryUser?.lockedAt && registryUser.lockedBy === 'FDS') {
    await setUserLock(id, false).catch(() => undefined)
  }
  // 해제 직후 남은 시그널로 즉시 재차단되는 것을 막는다 — 대상의 시그널을 정리.
  const signals = await readSignals()
  const kept = signals.filter((item) => item.actorId !== id)
  if (kept.length !== signals.length) await writeSignals(kept)
  return { ok: true as const }
}

export async function resolveFdsAlert(alertId: string, resolvedBy: string) {
  const alerts = await readAlerts()
  const alert = alerts.find((item) => item.id === alertId)
  if (!alert) return { ok: false as const, error: 'not_found' }
  alert.resolvedAt = new Date().toISOString()
  alert.resolvedBy = resolvedBy.slice(0, 60)
  await writeAlerts(alerts)
  return { ok: true as const, alert }
}

export async function listFdsState() {
  const [alerts, blocks, signals] = await Promise.all([readAlerts(), readBlocks(), readSignals()])
  const activeBlocks = Object.entries(blocks)
    .filter(([, block]) => blockActive(block))
    .map(([actorId, block]) => ({ actorId, ...block }))
    .sort((a, b) => b.at.localeCompare(a.at))
  return {
    alerts: alerts.slice(0, 150),
    blocks: activeBlocks,
    signals: signals.slice(0, 150),
    stats: {
      signals24h: signals.length,
      openAlerts: alerts.filter((item) => !item.resolvedAt).length,
      activeBlocks: activeBlocks.length,
    },
  }
}
