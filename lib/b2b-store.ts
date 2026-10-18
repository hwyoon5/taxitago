import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { kvCommand, netFilePath, netKey } from '@/lib/kv'
import { piRound } from '@/lib/pi-format'

/**
 * B2B 법인 계정·정기 청구 스토어.
 *
 * - 법인 조직·소속원·요금제는 계정 데이터 — 전역 키(공용 KV)에 저장한다.
 * - 이용 내역(usage)·인보이스는 결제 장부 — netKey 스코프로 네트워크를
 *   분리한다(메인넷 장부와 테스트넷 장부가 섞이지 않도록).
 * - KV 미설정 시 data/*.json 파일 + 프로세스 메모리로 폴백한다.
 */

export type B2bService = 'taxi' | 'daeri' | 'delivery'

export type B2bPlan = {
  id: string
  name: string
  /** 적용 서비스 — 비어 있으면 전 서비스 적용. */
  services: B2bService[]
  /** 건별 이용료 할인율(%) — 0~50. */
  discountPct: number
  /** 월 구독료(Pi) — 인보이스에 합산된다. 0이면 종량제. */
  monthlyFeePi: number
  note?: string
  active: boolean
  updatedAt: string
}

export type B2bOrg = {
  id: string
  name: string
  /** 사업자등록번호 */
  bizNo?: string
  contactName: string
  contactPhone: string
  /** 법인 결제·정산용 Pi 지갑 */
  wallet?: string
  /** 법인 포털을 관리하는 담당자 uid */
  managerUid?: string
  planId?: string
  status: 'active' | 'suspended'
  note?: string
  createdAt: string
  updatedAt: string
}

export type B2bMember = {
  uid: string
  orgId: string
  name?: string
  role: 'member' | 'manager'
  addedAt: string
}

export type B2bUsage = {
  id: string
  orgId: string
  memberUid: string
  service: B2bService
  /** ride:<id> | delivery:<id> — 멱등 키로 같은 건의 중복 집계를 막는다. */
  refId: string
  label: string
  grossPi: number
  discountPi: number
  netPi: number
  /** 청구 주기 — YYYY-MM */
  period: string
  /** 청구된 인보이스 id — 미청구분만 새 인보이스에 포함된다. */
  invoiceId?: string
  at: string
}

export type B2bInvoice = {
  id: string
  orgId: string
  orgName: string
  period: string
  count: number
  byService: Partial<Record<B2bService, { count: number; netPi: number }>>
  grossPi: number
  discountPi: number
  netPi: number
  monthlyFeePi: number
  totalPi: number
  status: 'issued' | 'paid' | 'void'
  issuedAt: string
  issuedBy: string
  paidAt?: string
  payPaymentId?: string
  payTxid?: string
  voidAt?: string
  voidReason?: string
  updatedAt: string
}

const PLANS_KEY = 'taxitago:b2b:plans'
const ORGS_KEY = 'taxitago:b2b:orgs'
const MEMBERS_KEY = 'taxitago:b2b:members'
const USAGE_KEY = 'taxitago:b2b:usage'
const INVOICES_KEY = 'taxitago:b2b:invoices'

const MAX_USAGE = 3000
const MAX_INVOICES = 500

// ── 전역 KV(계정 데이터) — broadcast/fds와 같은 공용 엔드포인트 ──────────

const globalKvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const globalKvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useGlobalKv = Boolean(globalKvUrl && globalKvToken)

async function globalKv<T>(command: (string | number)[]): Promise<T | null> {
  const res = await fetch(globalKvUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${globalKvToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`kv request failed: ${res.status}`)
  const data = (await res.json()) as { result?: T | null }
  return data.result ?? null
}

const globalStore = globalThis as typeof globalThis & {
  __taxitagoB2bGlobal?: Record<string, unknown>
  __taxitagoB2bScoped?: Record<string, unknown>
}

function fileFor(key: string) {
  const name = key.replace(/^taxitago:(main:)?/, '').replace(/:/g, '-')
  return path.join(process.cwd(), 'data', `b2b-${name}.json`)
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

async function readGlobal<T>(key: string, fallback: T): Promise<T> {
  if (useGlobalKv) {
    const raw = await globalKv<string | null>(['GET', key])
    if (!raw) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }
  const cache = (globalStore.__taxitagoB2bGlobal ??= {})
  if (!(key in cache)) cache[key] = readFileJson(fileFor(key), fallback)
  return cache[key] as T
}

async function writeGlobal(key: string, value: unknown) {
  if (useGlobalKv) {
    await globalKv(['SET', key, JSON.stringify(value)])
    return
  }
  ;(globalStore.__taxitagoB2bGlobal ??= {})[key] = value
  writeFileJson(fileFor(key), value)
}

// ── 스코프 KV(결제 장부) — lib/kv의 네트워크 분기를 그대로 사용 ──────────

async function readScoped<T>(key: string, fallback: T): Promise<T> {
  const scoped = netKey(key)
  try {
    const raw = await kvCommand<string | null>(['GET', scoped])
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as T
    return parsed ?? fallback
  } catch {
    const cache = (globalStore.__taxitagoB2bScoped ??= {})
    if (!(scoped in cache)) cache[scoped] = readFileJson(netFilePath(fileFor(scoped)), fallback)
    return cache[scoped] as T
  }
}

async function writeScoped(key: string, value: unknown) {
  const scoped = netKey(key)
  try {
    await kvCommand(['SET', scoped, JSON.stringify(value)])
    return
  } catch {
    ;(globalStore.__taxitagoB2bScoped ??= {})[scoped] = value
    writeFileJson(netFilePath(fileFor(scoped)), value)
  }
}

// ── 요금제 ─────────────────────────────────────────────────────────────

export async function listB2bPlans(): Promise<B2bPlan[]> {
  const plans = await readGlobal<B2bPlan[]>(PLANS_KEY, [])
  return Array.isArray(plans) ? plans : []
}

export async function upsertB2bPlan(input: Partial<B2bPlan> & { name: string }): Promise<B2bPlan> {
  const plans = await listB2bPlans()
  const id = input.id?.trim() || `plan-${crypto.randomUUID().slice(0, 8)}`
  const prev = plans.find((plan) => plan.id === id)
  const plan: B2bPlan = {
    id,
    name: input.name.trim().slice(0, 40),
    services: Array.isArray(input.services) ? input.services.filter((s): s is B2bService => ['taxi', 'daeri', 'delivery'].includes(s)) : prev?.services ?? [],
    discountPct: Math.max(0, Math.min(50, Number(input.discountPct ?? prev?.discountPct ?? 0))),
    monthlyFeePi: Math.max(0, piRound(Number(input.monthlyFeePi ?? prev?.monthlyFeePi ?? 0))),
    note: typeof input.note === 'string' ? input.note.slice(0, 200) : prev?.note,
    active: input.active ?? prev?.active ?? true,
    updatedAt: new Date().toISOString(),
  }
  await writeGlobal(PLANS_KEY, [plan, ...plans.filter((item) => item.id !== id)])
  return plan
}

export async function deleteB2bPlan(id: string): Promise<boolean> {
  const plans = await listB2bPlans()
  if (!plans.some((plan) => plan.id === id)) return false
  await writeGlobal(PLANS_KEY, plans.filter((plan) => plan.id !== id))
  // 법인의 플랜 참조는 끊어서 종량제(할인 0)로 되돌린다.
  const orgs = await listB2bOrgs()
  let changed = false
  for (const org of orgs) {
    if (org.planId === id) {
      delete org.planId
      org.updatedAt = new Date().toISOString()
      changed = true
    }
  }
  if (changed) await writeGlobal(ORGS_KEY, orgs)
  return true
}

// ── 법인 조직 ───────────────────────────────────────────────────────────

export async function listB2bOrgs(): Promise<B2bOrg[]> {
  const orgs = await readGlobal<B2bOrg[]>(ORGS_KEY, [])
  return Array.isArray(orgs) ? orgs : []
}

export async function getB2bOrg(id: string): Promise<B2bOrg | null> {
  return (await listB2bOrgs()).find((org) => org.id === id) ?? null
}

export async function upsertB2bOrg(input: Partial<B2bOrg> & { name: string }): Promise<B2bOrg> {
  const orgs = await listB2bOrgs()
  const id = input.id?.trim() || `org-${crypto.randomUUID().slice(0, 8)}`
  const prev = orgs.find((org) => org.id === id)
  const now = new Date().toISOString()
  const org: B2bOrg = {
    id,
    name: input.name.trim().slice(0, 60),
    bizNo: typeof input.bizNo === 'string' ? input.bizNo.trim().slice(0, 20) : prev?.bizNo,
    contactName: (input.contactName ?? prev?.contactName ?? '').slice(0, 40),
    contactPhone: (input.contactPhone ?? prev?.contactPhone ?? '').slice(0, 20),
    wallet: typeof input.wallet === 'string' ? input.wallet.trim().slice(0, 80) : prev?.wallet,
    managerUid: typeof input.managerUid === 'string' ? input.managerUid.trim().slice(0, 80) : prev?.managerUid,
    planId: input.planId !== undefined ? input.planId || undefined : prev?.planId,
    status: input.status === 'suspended' || input.status === 'active' ? input.status : prev?.status ?? 'active',
    note: typeof input.note === 'string' ? input.note.slice(0, 200) : prev?.note,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  }
  await writeGlobal(ORGS_KEY, [org, ...orgs.filter((item) => item.id !== id)])
  return org
}

// ── 소속원 ──────────────────────────────────────────────────────────────

async function readMembers(): Promise<Record<string, B2bMember>> {
  const map = await readGlobal<Record<string, B2bMember>>(MEMBERS_KEY, {})
  return map && typeof map === 'object' ? map : {}
}

export async function listB2bMembers(orgId?: string): Promise<B2bMember[]> {
  const members = Object.values(await readMembers())
  return (orgId ? members.filter((member) => member.orgId === orgId) : members).sort((a, b) => b.addedAt.localeCompare(a.addedAt))
}

export async function addB2bMember(orgId: string, uid: string, input: { name?: string; role?: 'member' | 'manager' } = {}) {
  const org = await getB2bOrg(orgId)
  if (!org) return { ok: false as const, error: 'org_not_found' }
  const memberUid = uid.trim()
  if (!memberUid) return { ok: false as const, error: 'uid_required' }
  const map = await readMembers()
  map[memberUid] = { uid: memberUid, orgId, name: input.name?.slice(0, 40), role: input.role === 'manager' ? 'manager' : 'member', addedAt: new Date().toISOString() }
  await writeGlobal(MEMBERS_KEY, map)
  return { ok: true as const, member: map[memberUid] }
}

export async function removeB2bMember(uid: string) {
  const map = await readMembers()
  if (!map[uid.trim()]) return false
  delete map[uid.trim()]
  await writeGlobal(MEMBERS_KEY, map)
  return true
}

/**
 * 이용자의 소속 법인+요금제 — 활성 법인의 소속원일 때만 반환한다.
 * 정지된 법인은 과금 태깅을 하지 않는다(개인 결제 흐름으로 돌아간다).
 */
export async function b2bOrgForMember(uid: string): Promise<{ org: B2bOrg; member: B2bMember; plan: B2bPlan | null } | null> {
  const memberUid = uid.trim()
  if (!memberUid) return null
  const member = (await readMembers())[memberUid]
  if (!member) return null
  const org = await getB2bOrg(member.orgId)
  if (!org || org.status !== 'active') return null
  const plan = org.planId ? ((await listB2bPlans()).find((item) => item.id === org.planId && item.active) ?? null) : null
  return { org, member, plan }
}

/**
 * 소속원의 법인 내 권한 — 포털 쓰기 액션(소속원 관리·인보이스 발행)은
 * 'manager'만 허용한다. 법인 담당자(managerUid)는 소속원 목록에 없어도
 * 매니저 권한을 가진다.
 */
export async function b2bMemberRole(orgId: string, uid: string): Promise<'manager' | 'member' | null> {
  const org = await getB2bOrg(orgId)
  if (!org) return null
  const id = uid.trim()
  if (!id) return null
  if (org.managerUid === id) return 'manager'
  const member = (await readMembers())[id]
  if (member?.orgId !== orgId) return null
  return member.role
}

// ── 이용 내역(usage) ────────────────────────────────────────────────────

export function currentB2bPeriod(): string {
  return new Date().toISOString().slice(0, 7)
}

async function readUsage(): Promise<B2bUsage[]> {
  const list = await readScoped<B2bUsage[]>(USAGE_KEY, [])
  return Array.isArray(list) ? list : []
}

async function writeUsage(list: B2bUsage[]) {
  await writeScoped(USAGE_KEY, list.slice(0, MAX_USAGE))
}

/**
 * 법인 이용 내역 적재 — refId 멱등으로 같은 건을 두 번 집계하지 않는다.
 * 요금제 할인을 적용해 netPi(청구액)를 계산한다.
 */
export async function recordB2bUsage(input: {
  orgId: string
  memberUid: string
  service: B2bService
  refId: string
  label: string
  grossPi: number
}): Promise<B2bUsage | null> {
  const list = await readUsage()
  const existing = list.find((item) => item.orgId === input.orgId && item.refId === input.refId)
  if (existing) return existing
  const org = await getB2bOrg(input.orgId)
  const plan = org?.planId ? ((await listB2bPlans()).find((item) => item.id === org.planId && item.active) ?? null) : null
  const applies = !plan || !plan.services.length || plan.services.includes(input.service)
  const discountPct = applies ? plan?.discountPct ?? 0 : 0
  const gross = piRound(Math.max(0, input.grossPi))
  const discountPi = piRound((gross * discountPct) / 100)
  const usage: B2bUsage = {
    id: `u-${crypto.randomUUID().slice(0, 10)}`,
    orgId: input.orgId,
    memberUid: input.memberUid,
    service: input.service,
    refId: input.refId,
    label: input.label.slice(0, 160),
    grossPi: gross,
    discountPi,
    netPi: piRound(gross - discountPi),
    period: currentB2bPeriod(),
    at: new Date().toISOString(),
  }
  list.unshift(usage)
  await writeUsage(list)
  return usage
}

export async function listB2bUsage(orgId?: string, period?: string): Promise<B2bUsage[]> {
  const list = await readUsage()
  return list.filter((item) => (!orgId || item.orgId === orgId) && (!period || item.period === period))
}

// ── 인보이스 ────────────────────────────────────────────────────────────

async function readInvoices(): Promise<B2bInvoice[]> {
  const list = await readScoped<B2bInvoice[]>(INVOICES_KEY, [])
  return Array.isArray(list) ? list : []
}

async function writeInvoices(list: B2bInvoice[]) {
  await writeScoped(INVOICES_KEY, list.slice(0, MAX_INVOICES))
}

export async function listB2bInvoices(orgId?: string): Promise<B2bInvoice[]> {
  const list = await readInvoices()
  return orgId ? list.filter((invoice) => invoice.orgId === orgId) : list
}

export async function getB2bInvoice(id: string): Promise<B2bInvoice | null> {
  return (await readInvoices()).find((invoice) => invoice.id === id) ?? null
}

/**
 * 월말 합산 청구서 발행 — 해당 주기의 미청구 이용 건을 모아 한 장의
 * 인보이스로 묶고, 각 이용 건에 invoiceId를 태깅해 이중 청구를 막는다.
 * 같은 주기의 미결제(open/issued) 인보이스가 있으면 중복 발행하지 않는다.
 */
export async function issueB2bInvoice(orgId: string, period: string, issuedBy: string) {
  const org = await getB2bOrg(orgId)
  if (!org) return { ok: false as const, error: 'org_not_found' }
  const invoices = await readInvoices()
  const open = invoices.find((invoice) => invoice.orgId === orgId && invoice.period === period && invoice.status === 'issued')
  if (open) return { ok: false as const, error: 'already_issued', invoice: open }
  const usage = (await readUsage()).filter((item) => item.orgId === orgId && item.period === period && !item.invoiceId)
  const plan = org.planId ? ((await listB2bPlans()).find((item) => item.id === org.planId && item.active) ?? null) : null
  const monthlyFeePi = piRound(plan?.monthlyFeePi ?? 0)
  if (!usage.length && monthlyFeePi <= 0) return { ok: false as const, error: 'empty' }
  const grossPi = piRound(usage.reduce((sum, item) => sum + item.grossPi, 0))
  const discountPi = piRound(usage.reduce((sum, item) => sum + item.discountPi, 0))
  const netPi = piRound(grossPi - discountPi)
  const byService: B2bInvoice['byService'] = {}
  for (const item of usage) {
    const bucket = (byService[item.service] ??= { count: 0, netPi: 0 })
    bucket.count += 1
    bucket.netPi = piRound(bucket.netPi + item.netPi)
  }
  const now = new Date().toISOString()
  const invoice: B2bInvoice = {
    id: `inv-${period.replace('-', '')}-${crypto.randomUUID().slice(0, 8)}`,
    orgId,
    orgName: org.name,
    period,
    count: usage.length,
    byService,
    grossPi,
    discountPi,
    netPi,
    monthlyFeePi,
    totalPi: piRound(netPi + monthlyFeePi),
    status: 'issued',
    issuedAt: now,
    issuedBy: issuedBy.slice(0, 60),
    updatedAt: now,
  }
  // 이용 건에 인보이스 태깅 — 다음 발행에서 제외된다.
  const all = await readUsage()
  for (const item of all) {
    if (item.orgId === orgId && item.period === period && !item.invoiceId) item.invoiceId = invoice.id
  }
  await writeUsage(all)
  await writeInvoices([invoice, ...invoices])
  return { ok: true as const, invoice }
}

export async function markB2bInvoicePaid(id: string, input: { paymentId?: string; txid?: string; by?: string }) {
  const invoices = await readInvoices()
  const invoice = invoices.find((item) => item.id === id)
  if (!invoice) return { ok: false as const, error: 'not_found' }
  if (invoice.status === 'paid') return { ok: true as const, invoice }
  if (invoice.status === 'void') return { ok: false as const, error: 'void' }
  invoice.status = 'paid'
  invoice.paidAt = new Date().toISOString()
  invoice.payPaymentId = input.paymentId?.slice(0, 80)
  invoice.payTxid = input.txid?.slice(0, 80)
  invoice.updatedAt = new Date().toISOString()
  await writeInvoices(invoices)
  return { ok: true as const, invoice }
}

export async function voidB2bInvoice(id: string, reason: string) {
  const invoices = await readInvoices()
  const invoice = invoices.find((item) => item.id === id)
  if (!invoice) return { ok: false as const, error: 'not_found' }
  if (invoice.status !== 'issued') return { ok: false as const, error: invoice.status }
  invoice.status = 'void'
  invoice.voidAt = new Date().toISOString()
  invoice.voidReason = reason.slice(0, 160)
  invoice.updatedAt = new Date().toISOString()
  // 무효 처리된 인보이스의 이용 건은 태그를 풀어 재청구 가능하게 한다.
  const usage = await readUsage()
  for (const item of usage) {
    if (item.invoiceId === id) delete item.invoiceId
  }
  await writeUsage(usage)
  await writeInvoices(invoices)
  return { ok: true as const, invoice }
}

/**
 * 검증된 Pi 결제 완료(metadata.kind === 'b2b-invoice')로 인보이스를 마감한다.
 * 서버가 조회한 결제 금액이 청구 총액에 못 미치면 paid로 기록하지 않는다 —
 * 클라이언트 주장 txid만으로는 절대 마감하지 않는다(/api/pi/complete의
 * 체인 검증을 통과한 뒤에만 호출된다). 멱등 — 재호출은 기존 기록을 유지한다.
 */
export async function settleB2bInvoiceFromPayment(input: {
  paymentId: string
  txid: string
  amount: number | null
  metadata?: Record<string, unknown> | null
}) {
  const metadata = input.metadata
  if (!metadata || metadata.kind !== 'b2b-invoice') return null
  const invoiceId = typeof metadata.invoiceId === 'string' ? metadata.invoiceId.trim() : ''
  if (!invoiceId) return null
  const invoice = await getB2bInvoice(invoiceId)
  if (!invoice) {
    console.warn('[b2b] invoice payment for unknown invoice', { paymentId: input.paymentId, invoiceId })
    return null
  }
  if (invoice.status === 'paid') return invoice
  const paid = typeof input.amount === 'number' ? input.amount : 0
  if (paid + 1e-7 < invoice.totalPi) {
    console.warn('[b2b] invoice payment underpaid — not marking paid', {
      paymentId: input.paymentId,
      invoiceId,
      paid,
      required: invoice.totalPi,
    })
    return null
  }
  const result = await markB2bInvoicePaid(invoiceId, {
    paymentId: input.paymentId,
    txid: input.txid,
    by: 'pi-payment',
  })
  if (result.ok) {
    console.log('[b2b] invoice paid', { invoiceId, orgId: invoice.orgId, totalPi: invoice.totalPi })
    return result.invoice
  }
  return null
}

/** 법인 포털 조회 — 소속원 또는 담당자만 자사 데이터를 볼 수 있다. */
export async function b2bPortal(orgId: string, viewerUid: string) {
  const org = await getB2bOrg(orgId)
  if (!org) return null
  const uid = viewerUid.trim()
  const member = (await readMembers())[uid]
  const allowed = org.managerUid === uid || member?.orgId === orgId
  if (!allowed) return null
  const plan = org.planId ? ((await listB2bPlans()).find((item) => item.id === org.planId) ?? null) : null
  const [members, usage, invoices] = await Promise.all([listB2bMembers(orgId), listB2bUsage(orgId), listB2bInvoices(orgId)])
  return { org, plan, members, usage: usage.slice(0, 300), invoices: invoices.slice(0, 60) }
}
