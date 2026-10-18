import { NextResponse } from 'next/server'
import {
  addB2bMember,
  b2bMemberRole,
  b2bPortal,
  currentB2bPeriod,
  getB2bInvoice,
  issueB2bInvoice,
  listB2bMembers,
  listB2bOrgs,
  markB2bInvoicePaid,
  removeB2bMember,
} from '@/lib/b2b-store'
import { getPiPayment } from '@/lib/pi-platform'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'
import { paymentKindOf } from '@/lib/payment-kind-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * B2B 법인 포털 — 소속원 전용 대시보드 API.
 * GET ?uid= : 소속 법인·요금제·소속원·이용 내역·인보이스.
 *   - member 권한은 본인 이용 내역만 조회한다.
 *   - manager(소속원 role=manager 또는 법인 담당자)는 전사 내역·관리 액션 가능.
 * POST : { uid, action } — member-add | member-remove | invoice-issue | invoice-confirm
 *   - 쓰기 액션은 전부 manager 권한 필요.
 *   - invoice-confirm은 Pi 결제를 서버에서 재검증(paymentId 조회 + txid·금액
 *     대조 + 서버 결제-kind 등록 확인)한 뒤에만 인보이스를 마감한다.
 */

async function portalFor(uid: string) {
  const id = uid.trim()
  if (!id) return null
  // 소속 법인 탐색 — 멤버 레코드의 orgId로 포털 권한을 검사한다.
  // 법인 담당자(managerUid)는 소속원 목록에 없어도 자사 포털에 접근할 수 있다.
  const member = (await listB2bMembers()).find((item) => item.uid === id)
  const managed = member ? null : (await listB2bOrgs()).find((org) => org.managerUid === id)
  const orgId = member?.orgId ?? managed?.id
  if (!orgId) return null
  const portal = await b2bPortal(orgId, id)
  if (!portal) return null
  const role = await b2bMemberRole(orgId, id)
  return { portal, role, member }
}

export async function GET(request: Request) {
  const uid = new URL(request.url).searchParams.get('uid')?.trim() || ''
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 })
  const found = await portalFor(uid)
  if (!found) {
    // 비소속원 — 포털 카드 표시 여부 판별용으로 member:false만 돌린다(404 아님).
    return NextResponse.json({ ok: true, member: false })
  }
  const { portal, role } = found
  // 일반 소속원은 본인 이용 내역만 본다 — 타 직원 이용 내역은 담당자 전용.
  const usage = role === 'manager' ? portal.usage : portal.usage.filter((item) => item.memberUid === uid)
  return NextResponse.json({
    ok: true,
    member: true,
    role: role ?? 'member',
    period: currentB2bPeriod(),
    org: portal.org,
    plan: portal.plan,
    members: portal.members,
    usage,
    invoices: portal.invoices,
  })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    uid?: unknown
    action?: unknown
    orgId?: unknown
    memberUid?: unknown
    memberName?: unknown
    role?: unknown
    invoiceId?: unknown
    paymentId?: unknown
    txid?: unknown
    period?: unknown
  } | null
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const action = typeof body?.action === 'string' ? body.action.trim() : ''
  if (!uid || !action) return NextResponse.json({ error: 'uid and action required' }, { status: 400 })
  const found = await portalFor(uid)
  if (!found) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const orgId = found.portal.org.id
  // 쓰기 액션은 매니저(소속원 role=manager 또는 법인 담당자)만 허용한다.
  if (found.role !== 'manager') return NextResponse.json({ error: 'manager_required' }, { status: 403 })

  if (action === 'member-add' || action === 'member-remove') {
    const memberUid = typeof body?.memberUid === 'string' ? body.memberUid.trim() : ''
    if (!memberUid) return NextResponse.json({ error: 'memberUid required' }, { status: 400 })
    if (action === 'member-remove') {
      if (memberUid === uid) return NextResponse.json({ error: 'cannot_remove_self' }, { status: 400 })
      const removed = await removeB2bMember(memberUid)
      if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 })
      return NextResponse.json({ ok: true })
    }
    const result = await addB2bMember(orgId, memberUid, {
      name: typeof body?.memberName === 'string' ? body.memberName : undefined,
      role: body?.role === 'manager' ? 'manager' : 'member',
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, member: result.member })
  }

  if (action === 'invoice-issue') {
    const period =
      typeof body?.period === 'string' && /^\d{4}-\d{2}$/.test(body.period.trim())
        ? body.period.trim()
        : currentB2bPeriod()
    const result = await issueB2bInvoice(orgId, period, `manager:${uid}`)
    if (!result.ok) {
      const status = result.error === 'already_issued' ? 409 : 400
      return NextResponse.json({ error: result.error, invoice: 'invoice' in result ? result.invoice : undefined }, { status })
    }
    return NextResponse.json({ ok: true, invoice: result.invoice })
  }

  if (action === 'invoice-confirm') {
    const invoiceId = typeof body?.invoiceId === 'string' ? body.invoiceId.trim() : ''
    const paymentId = typeof body?.paymentId === 'string' ? body.paymentId.trim() : ''
    const txid = typeof body?.txid === 'string' ? body.txid.trim() : ''
    if (!invoiceId || !paymentId || !txid) {
      return NextResponse.json({ error: 'invoiceId, paymentId, txid required' }, { status: 400 })
    }
    const invoice = await getB2bInvoice(invoiceId)
    if (!invoice || invoice.orgId !== orgId) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    if (invoice.status === 'paid') return NextResponse.json({ ok: true, invoice })
    if (invoice.status !== 'issued') return NextResponse.json({ error: 'not_payable' }, { status: 400 })
    // 서버 재검증 — Pi Platform 결제 원본에서 kind·invoiceId·금액·txid를 대조하고,
    // 서버 결제-kind 레지스트리에 'b2b-invoice'로 기록된 txid만 인정한다.
    const sandbox = isPiSandboxRequest(request)
    const info = await getPiPayment(paymentId, sandbox).catch(() => null)
    const meta = info?.metadata ?? {}
    const infoTxid =
      info && typeof info.transaction === 'object'
        ? ((info.transaction as Record<string, unknown>)?.txid as string | undefined)
        : undefined
    const metaOk = meta.kind === 'b2b-invoice' && meta.invoiceId === invoiceId
    const amount = typeof info?.amount === 'number' ? info.amount : 0
    const amountOk = amount + 1e-7 >= invoice.totalPi
    const txidOk = infoTxid ? infoTxid === txid : true
    const kindOk = (await paymentKindOf(txid).catch(() => '')) === 'b2b-invoice'
    if (!info || !metaOk || !amountOk || !txidOk || !kindOk) {
      console.warn('[b2b] invoice-confirm rejected', { invoiceId, paymentId, metaOk, amountOk, txidOk, kindOk })
      return NextResponse.json({ error: 'payment_unverified' }, { status: 400 })
    }
    const result = await markB2bInvoicePaid(invoiceId, { paymentId, txid, by: `manager:${uid}` })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, invoice: result.invoice })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
