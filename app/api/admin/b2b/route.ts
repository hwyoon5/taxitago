import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import {
  addB2bMember,
  currentB2bPeriod,
  deleteB2bPlan,
  getB2bOrg,
  issueB2bInvoice,
  listB2bInvoices,
  listB2bMembers,
  listB2bOrgs,
  listB2bPlans,
  listB2bUsage,
  removeB2bMember,
  upsertB2bOrg,
  upsertB2bPlan,
  voidB2bInvoice,
  type B2bService,
} from '@/lib/b2b-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * B2B 법인 계정·정기 청구 관리 — GET: 법인/소속원/요금제/이용 내역/인보이스.
 * POST: action 기반 변경 — org-upsert, member-add, member-remove,
 *       plan-upsert, plan-delete, invoice-issue, invoice-void.
 * 모든 변경은 감사 로그(kind 'b2b')에 남는다.
 */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const [orgs, members, plans, invoices, usage] = await Promise.all([
    listB2bOrgs(),
    listB2bMembers(),
    listB2bPlans(),
    listB2bInvoices(),
    listB2bUsage(),
  ])
  return NextResponse.json({
    ok: true,
    period: currentB2bPeriod(),
    orgs,
    members,
    plans,
    invoices: invoices.slice(0, 200),
    usage: usage.slice(0, 500),
  })
}

export async function POST(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const action = typeof body?.action === 'string' ? body.action.trim() : ''
  const audit = (refId: string, detail: string, before?: unknown, after?: unknown) =>
    recordAudit({
      kind: 'b2b',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId,
      detail,
      before,
      after,
    }).catch(() => undefined)

  if (action === 'org-upsert') {
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const before = typeof body?.id === 'string' ? await getB2bOrg(body.id.trim()) : null
    const org = await upsertB2bOrg({
      id: typeof body?.id === 'string' ? body.id : undefined,
      name,
      bizNo: typeof body?.bizNo === 'string' ? body.bizNo : undefined,
      contactName: typeof body?.contactName === 'string' ? body.contactName : '',
      contactPhone: typeof body?.contactPhone === 'string' ? body.contactPhone : '',
      wallet: typeof body?.wallet === 'string' ? body.wallet : undefined,
      managerUid: typeof body?.managerUid === 'string' ? body.managerUid : undefined,
      planId: typeof body?.planId === 'string' ? body.planId : undefined,
      status: body?.status === 'suspended' ? 'suspended' : 'active',
      note: typeof body?.note === 'string' ? body.note : undefined,
    })
    await audit(`b2b:org:${org.id}`, `법인 ${before ? '수정' : '등록'} · ${org.name}`, before ?? undefined, org)
    return NextResponse.json({ ok: true, org })
  }

  if (action === 'member-add' || action === 'member-remove') {
    const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
    if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 })
    if (action === 'member-remove') {
      const removed = await removeB2bMember(uid)
      if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 })
      await audit(`b2b:member:${uid}`, `법인 소속원 제외 · ${uid}`)
      return NextResponse.json({ ok: true })
    }
    const orgId = typeof body?.orgId === 'string' ? body.orgId.trim() : ''
    const result = await addB2bMember(orgId, uid, {
      name: typeof body?.memberName === 'string' ? body.memberName : undefined,
      role: body?.role === 'manager' ? 'manager' : 'member',
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 })
    await audit(`b2b:member:${uid}`, `법인 소속원 등록 · ${uid} → ${orgId} · ${result.member.role}`)
    return NextResponse.json({ ok: true, member: result.member })
  }

  if (action === 'plan-upsert' || action === 'plan-delete') {
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    if (action === 'plan-delete') {
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
      const removed = await deleteB2bPlan(id)
      if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 })
      await audit(`b2b:plan:${id}`, `B2B 요금제 삭제 · ${id}`)
      return NextResponse.json({ ok: true })
    }
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const services = Array.isArray(body?.services)
      ? (body.services.filter((item): item is B2bService => item === 'taxi' || item === 'daeri' || item === 'delivery') as B2bService[])
      : []
    const plan = await upsertB2bPlan({
      id: id || undefined,
      name,
      services,
      discountPct: typeof body?.discountPct === 'number' ? body.discountPct : Number(body?.discountPct) || 0,
      monthlyFeePi: typeof body?.monthlyFeePi === 'number' ? body.monthlyFeePi : Number(body?.monthlyFeePi) || 0,
      note: typeof body?.note === 'string' ? body.note : undefined,
      active: body?.active !== false,
    })
    await audit(`b2b:plan:${plan.id}`, `B2B 요금제 저장 · ${plan.name} · 할인 ${plan.discountPct}% · 월 ${plan.monthlyFeePi} Pi`, undefined, plan)
    return NextResponse.json({ ok: true, plan })
  }

  if (action === 'invoice-issue') {
    const orgId = typeof body?.orgId === 'string' ? body.orgId.trim() : ''
    const period = typeof body?.period === 'string' && /^\d{4}-\d{2}$/.test(body.period.trim()) ? body.period.trim() : currentB2bPeriod()
    if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 })
    const result = await issueB2bInvoice(orgId, period, `admin:${actor.staffId}`)
    if (!result.ok) {
      const status = result.error === 'already_issued' ? 409 : 400
      return NextResponse.json({ error: result.error, invoice: 'invoice' in result ? result.invoice : undefined }, { status })
    }
    await audit(`b2b:inv:${result.invoice.id}`, `인보이스 발행 · ${result.invoice.orgName} · ${period} · ${result.invoice.totalPi} Pi`)
    return NextResponse.json({ ok: true, invoice: result.invoice })
  }

  if (action === 'invoice-void') {
    const id = typeof body?.invoiceId === 'string' ? body.invoiceId.trim() : ''
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
    if (!id || !reason) return NextResponse.json({ error: 'invoiceId and reason required' }, { status: 400 })
    const result = await voidB2bInvoice(id, reason)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    await audit(`b2b:inv:${id}`, `인보이스 무효 · ${id} · ${reason}`)
    return NextResponse.json({ ok: true, invoice: result.invoice })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
