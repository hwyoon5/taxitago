import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { kvCommand, kvConfigured } from '@/lib/kv'
import { piRound } from '@/lib/pi-format'
import { getRegistryUser } from '@/lib/user-registry'

/**
 * 승객 할인 쿠폰 장부 — 관리자가 코드·할인 조건·기한·대상을 등록하고,
 * 승객은 Pi SDK 직결제 시 코드를 적용해 결제액을 줄이고, 사용 기록은
 * /api/pi/complete의 couponCode 메타데이터 처리에서 확정된다.
 * 할인분은 플랫폼 부담(기사 정산액은 운행 요금 기준 그대로)이다.
 * KV 우선 + 파일/메모리 폴백 — 다른 장부 스토어와 같은 저장 계약.
 */

export type CouponKind = 'amount' | 'percent'
export type CouponAudience = 'all' | 'new' | 'uids'

export type CouponRedemption = {
  uid: string
  at: string
  /** 적용된 할인액(Pi) */
  discount: number
  /** 할인 적용 전 결제액(Pi) */
  gross: number
  /** 사용처 — 지출 txid 등 역추적용 */
  refId?: string
}

export type Coupon = {
  id: string
  /** 대문자 코드 (예: WELCOME20) */
  code: string
  title: string
  kind: CouponKind
  /** amount면 Pi 고정 할인액, percent면 할인율(%) */
  value: number
  /** percent 쿠폰의 할인 상한(Pi) — 0이면 무제한 */
  maxDiscount: number
  /** 최소 결제액(Pi) — 미만이면 적용 불가 */
  minSpend: number
  /** 사용 기한(ISO) — 없으면 무기한 */
  expiresAt?: string
  audience: CouponAudience
  /** audience 'new'일 때 가입 후 허용 일수 */
  newWithinDays: number
  /** audience 'uids'일 때 허용 uid 목록 */
  targetUids: string[]
  /** 전체 사용 한도 — 0이면 무제한 */
  maxUses: number
  /** 1인당 사용 한도 */
  perUserLimit: number
  active: boolean
  createdBy: string
  createdByName?: string
  createdAt: string
  updatedAt?: string
  redemptions: CouponRedemption[]
}

/** 쿠폰 검증 실패 코드 — 클라이언트가 로케일별 문구로 매핑한다. */
export type CouponReject =
  | 'not_found'
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'min_spend'
  | 'audience'
  | 'limit_total'
  | 'limit_user'

const useKv = kvConfigured
const COUPONS_KEY = 'taxitago:coupons'
const MAX_ENTRIES = 200
const filePath = path.join(process.cwd(), 'data', 'coupons.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoCoupons?: Coupon[] }

function readFileEntries(): Coupon[] {
  try {
    if (!existsSync(filePath)) return []
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { entries?: Coupon[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFileEntries(entries: Coupon[]) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ entries }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readEntries(): Promise<Coupon[]> {
  if (useKv) {
    try {
      const raw = await kvCommand<string | null>(['GET', COUPONS_KEY])
      if (!raw) return []
      const parsed = JSON.parse(raw) as Coupon[]
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      console.error('[coupons] kv read failed; using local fallback', error)
      if (!globalStore.__taxitagoCoupons) globalStore.__taxitagoCoupons = readFileEntries()
      return globalStore.__taxitagoCoupons
    }
  }
  if (!globalStore.__taxitagoCoupons) globalStore.__taxitagoCoupons = readFileEntries()
  return globalStore.__taxitagoCoupons
}

async function writeEntries(entries: Coupon[]) {
  const trimmed = entries.slice(-MAX_ENTRIES)
  if (useKv) {
    try {
      await kvCommand(['SET', COUPONS_KEY, JSON.stringify(trimmed)])
      return
    } catch (error) {
      console.error('[coupons] kv write failed; falling back to local', error)
    }
  }
  globalStore.__taxitagoCoupons = trimmed
  writeFileEntries(trimmed)
}

export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24)
}

/** 결제액에 적용되는 할인액 — 결제액을 넘지 않는다. */
export function couponDiscountFor(coupon: Coupon, gross: number): number {
  const g = Math.max(0, Number(gross) || 0)
  if (!g) return 0
  const raw = coupon.kind === 'percent' ? (g * coupon.value) / 100 : coupon.value
  const capped = coupon.kind === 'percent' && coupon.maxDiscount > 0 ? Math.min(raw, coupon.maxDiscount) : raw
  return piRound(Math.min(g, Math.max(0, capped)))
}

/** 코드·상태·기한·대상·한도 검증 — 통과 시 null, 실패 시 사유 코드. */
export function checkCouponUsable(
  coupon: Coupon | null,
  input: { uid: string; gross: number; linkedAt?: string; now?: Date },
): CouponReject | null {
  if (!coupon) return 'not_found'
  const now = input.now ?? new Date()
  if (!coupon.active) return 'inactive'
  const nowIso = now.toISOString()
  if (coupon.expiresAt && coupon.expiresAt < nowIso) return 'expired'
  if (input.gross < coupon.minSpend) return 'min_spend'
  if (coupon.audience === 'uids' && !coupon.targetUids.includes(input.uid)) return 'audience'
  if (coupon.audience === 'new' && coupon.newWithinDays > 0) {
    const linked = input.linkedAt ? Date.parse(input.linkedAt) : NaN
    if (!Number.isFinite(linked) || now.getTime() - linked > coupon.newWithinDays * 86_400_000) return 'audience'
  }
  if (coupon.maxUses > 0 && coupon.redemptions.length >= coupon.maxUses) return 'limit_total'
  const perUser = coupon.redemptions.filter((r) => r.uid === input.uid).length
  if (coupon.perUserLimit > 0 && perUser >= coupon.perUserLimit) return 'limit_user'
  return null
}

export async function listCoupons(): Promise<Coupon[]> {
  const entries = await readEntries()
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function findCouponByCode(code: string): Promise<Coupon | null> {
  const normalized = normalizeCouponCode(code)
  if (!normalized) return null
  const entries = await readEntries()
  return entries.find((entry) => entry.code === normalized) ?? null
}

/** 중복 코드면 null. */
export async function createCoupon(input: Omit<Coupon, 'id' | 'createdAt' | 'redemptions' | 'active'> & { active?: boolean }): Promise<Coupon | null> {
  const entries = await readEntries()
  if (entries.some((entry) => entry.code === input.code)) return null
  const entry: Coupon = {
    ...input,
    id: crypto.randomUUID(),
    active: input.active !== false,
    redemptions: [],
    createdAt: new Date().toISOString(),
  }
  entries.push(entry)
  await writeEntries(entries)
  return entry
}

export async function setCouponActive(id: string, active: boolean): Promise<Coupon | null> {
  const entries = await readEntries()
  const entry = entries.find((item) => item.id === id)
  if (!entry) return null
  entry.active = active
  entry.updatedAt = new Date().toISOString()
  await writeEntries(entries)
  return entry
}

export async function deleteCoupon(id: string): Promise<Coupon | null> {
  const entries = await readEntries()
  const index = entries.findIndex((item) => item.id === id)
  if (index < 0) return null
  const [removed] = entries.splice(index, 1)
  await writeEntries(entries)
  return removed
}

/** 결제 미리보기 — uid 기준 검증 + 할인액을 계산한다(기록은 하지 않음). */
export async function previewCoupon(
  code: string,
  uid: string,
  gross: number,
): Promise<{ ok: true; coupon: Coupon; discount: number; payable: number } | { ok: false; error: CouponReject }> {
  const coupon = await findCouponByCode(code)
  const linkedAt = coupon?.audience === 'new' ? (await getRegistryUser(uid).catch(() => null))?.linkedAt : undefined
  const reject = checkCouponUsable(coupon, { uid, gross, linkedAt })
  if (reject || !coupon) return { ok: false, error: reject ?? 'not_found' }
  const discount = couponDiscountFor(coupon, gross)
  return { ok: true, coupon, discount, payable: piRound(gross - discount) }
}

/**
 * 검증 + 사용 기록을 한 번에 — 결제 차감 전에 호출해 쿠폰을 소비 상태로 잠근다.
 * 차감이 실패하면 voidCouponRedemption으로 되돌린다.
 */
export async function redeemCoupon(
  code: string,
  uid: string,
  gross: number,
  refId: string,
): Promise<{ ok: true; coupon: Coupon; discount: number; payable: number } | { ok: false; error: CouponReject }> {
  const entries = await readEntries()
  const normalized = normalizeCouponCode(code)
  const coupon = entries.find((entry) => entry.code === normalized) ?? null
  const linkedAt = coupon?.audience === 'new' ? (await getRegistryUser(uid).catch(() => null))?.linkedAt : undefined
  const reject = checkCouponUsable(coupon, { uid, gross, linkedAt })
  if (reject || !coupon) return { ok: false, error: reject ?? 'not_found' }
  const discount = couponDiscountFor(coupon, gross)
  coupon.redemptions.push({ uid, at: new Date().toISOString(), discount, gross: piRound(gross), refId })
  coupon.updatedAt = new Date().toISOString()
  await writeEntries(entries)
  return { ok: true, coupon, discount, payable: piRound(gross - discount) }
}

/** 결제 실패로 되돌린 사용 기록 — (코드, uid, refId)가 일치하는 최근 건만 제거한다. */
export async function voidCouponRedemption(code: string, uid: string, refId: string): Promise<void> {
  const entries = await readEntries()
  const coupon = entries.find((entry) => entry.code === normalizeCouponCode(code))
  if (!coupon) return
  const index = coupon.redemptions.findIndex((r) => r.uid === uid && r.refId === refId)
  if (index < 0) return
  coupon.redemptions.splice(index, 1)
  coupon.updatedAt = new Date().toISOString()
  await writeEntries(entries)
}
