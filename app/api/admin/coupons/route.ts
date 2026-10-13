import { NextResponse } from 'next/server'
import { adminActor, hasAdminPrivilege } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import {
  createCoupon,
  deleteCoupon,
  listCoupons,
  normalizeCouponCode,
  setCouponActive,
  type CouponAudience,
  type CouponKind,
} from '@/lib/coupon-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const coupons = await listCoupons()
  return NextResponse.json({
    ok: true,
    coupons,
    stats: {
      total: coupons.length,
      active: coupons.filter((c) => c.active).length,
      redeemed: coupons.reduce((sum, c) => sum + c.redemptions.length, 0),
      discounted: coupons.reduce((sum, c) => sum + c.redemptions.reduce((s, r) => s + r.discount, 0), 0),
    },
  })
}

export async function POST(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  // 쿠폰 발행·삭제는 할인 비용이 발생하는 설정 변경 — 수수료/요금과 같은 권한 수준.
  if (!hasAdminPrivilege(actor)) {
    return NextResponse.json({ error: '쿠폰 관리 권한이 없습니다 (최고책임자 및 팀장만 가능합니다)' }, { status: 403 })
  }
  const body = (await request.json().catch(() => null)) as {
    action?: unknown
    id?: unknown
    code?: unknown
    title?: unknown
    kind?: unknown
    value?: unknown
    maxDiscount?: unknown
    minSpend?: unknown
    expiresAt?: unknown
    audience?: unknown
    newWithinDays?: unknown
    targetUids?: unknown
    maxUses?: unknown
    perUserLimit?: unknown
    active?: unknown
  } | null
  const action = body?.action

  if (action === 'toggle') {
    const id = typeof body?.id === 'string' ? body.id : ''
    const active = body?.active === true
    const coupon = await setCouponActive(id, active)
    if (!coupon) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await recordAudit({
      kind: 'coupon',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `coupon:${coupon.code}`,
      detail: active ? '쿠폰 활성화' : '쿠폰 비활성화',
      after: { active },
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, coupon })
  }

  if (action === 'delete') {
    const id = typeof body?.id === 'string' ? body.id : ''
    const removed = await deleteCoupon(id)
    if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await recordAudit({
      kind: 'coupon',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `coupon:${removed.code}`,
      detail: `쿠폰 삭제 · 사용 ${removed.redemptions.length}건`,
      before: { code: removed.code, kind: removed.kind, value: removed.value },
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, deleted: removed.code })
  }

  if (action !== 'create') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }

  const code = normalizeCouponCode(typeof body?.code === 'string' ? body.code : '')
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 60) : ''
  const kind: CouponKind = body?.kind === 'percent' ? 'percent' : 'amount'
  const value = Number(body?.value)
  if (!code) return NextResponse.json({ error: '쿠폰 코드를 입력해 주세요. (영문·숫자·-_ 24자 이내)' }, { status: 400 })
  if (!title) return NextResponse.json({ error: '쿠폰 이름을 입력해 주세요.' }, { status: 400 })
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: kind === 'percent' ? '할인율을 입력해 주세요.' : '할인 금액을 입력해 주세요.' }, { status: 400 })
  }
  if (kind === 'percent' && value > 100) {
    return NextResponse.json({ error: '할인율은 100%를 넘을 수 없습니다.' }, { status: 400 })
  }
  const audience: CouponAudience = body?.audience === 'new' || body?.audience === 'uids' ? body.audience : 'all'
  const expiresRaw = typeof body?.expiresAt === 'string' ? body.expiresAt.trim() : ''
  const expiresParsed = expiresRaw ? Date.parse(expiresRaw) : NaN
  if (expiresRaw && !Number.isFinite(expiresParsed)) {
    return NextResponse.json({ error: '사용 기한 형식이 올바르지 않습니다.' }, { status: 400 })
  }
  const expiresAt = Number.isFinite(expiresParsed) ? new Date(expiresParsed).toISOString() : undefined
  const targetUids = (Array.isArray(body?.targetUids) ? body.targetUids : [])
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .slice(0, 200)
  if (audience === 'uids' && !targetUids.length) {
    return NextResponse.json({ error: '대상 회원 UID를 1명 이상 입력해 주세요.' }, { status: 400 })
  }
  const coupon = await createCoupon({
    code,
    title,
    kind,
    value: kind === 'percent' ? Math.min(100, value) : value,
    maxDiscount: Math.max(0, Number(body?.maxDiscount) || 0),
    minSpend: Math.max(0, Number(body?.minSpend) || 0),
    expiresAt,
    audience,
    newWithinDays: Math.max(0, Math.floor(Number(body?.newWithinDays) || 0)),
    targetUids,
    maxUses: Math.max(0, Math.floor(Number(body?.maxUses) || 0)),
    perUserLimit: Math.max(1, Math.floor(Number(body?.perUserLimit) || 1)),
    createdBy: actor.staffId,
    createdByName: actor.staffName,
  })
  if (!coupon) {
    return NextResponse.json({ error: '이미 사용 중인 쿠폰 코드입니다.' }, { status: 409 })
  }
  await recordAudit({
    kind: 'coupon',
    actor: actor.staffId,
    actorName: actor.staffName,
    refId: `coupon:${coupon.code}`,
    detail: `쿠폰 발행 · ${title} · ${kind === 'percent' ? `${value}%` : `${value}Pi`} · 대상 ${audience}`,
    after: { code, kind, value, expiresAt, audience },
  }).catch(() => undefined)
  return NextResponse.json({ ok: true, coupon })
}
