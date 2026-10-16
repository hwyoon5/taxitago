import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import { listReceivables, resolveReceivable, type ReceivableStatus } from '@/lib/receivable-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 관리자 미수금 장부 — 결제 실패로 남은 미수 건을 상태·검색어로 조회하고
 * 수동 정산(settled) 또는 무효(void) 처리한다. 처리는 감사 로그에 남는다.
 * from·to: YYYY-MM-DD (KST 하루 경계), status: open|settled|void,
 * q: 이용자 ID·지갑·전화번호·서비스·파트너·기기 부분 일치.
 */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const params = new URL(request.url).searchParams
  const statusRaw = (params.get('status') || '').trim()
  const status: ReceivableStatus | '' =
    statusRaw === 'open' || statusRaw === 'settled' || statusRaw === 'void' ? statusRaw : ''
  const q = (params.get('q') || '').trim().toLowerCase()
  const from = params.get('from')?.trim() || ''
  const to = params.get('to')?.trim() || ''
  const fromMs = /^\d{4}-\d{2}-\d{2}$/.test(from) ? Date.parse(`${from}T00:00:00+09:00`) : -Infinity
  const toMs = /^\d{4}-\d{2}-\d{2}$/.test(to) ? Date.parse(`${to}T23:59:59.999+09:00`) : Infinity

  const items = (await listReceivables({ status: status || undefined })).filter((row) => {
    const at = Date.parse(row.createdAt)
    if (Number.isFinite(fromMs) && at < fromMs) return false
    if (Number.isFinite(toMs) && at > toMs) return false
    if (q) {
      const hay = [row.userId, row.wallet, row.phone, row.service, row.partnerName, row.partnerId, row.deviceId, row.place, row.id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const openTotal = items.filter((row) => row.status === 'open').reduce((sum, row) => sum + row.amount, 0)
  return NextResponse.json({ ok: true, total: items.length, openTotal, generatedAt: new Date().toISOString(), items })
}

export async function PATCH(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as {
    id?: unknown
    action?: unknown
    note?: unknown
  } | null
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const action = body?.action === 'settle' ? 'settled' : body?.action === 'void' ? 'void' : null
  const note = typeof body?.note === 'string' ? body.note : ''
  if (!id || !action) {
    return NextResponse.json({ error: 'invalid_fields' }, { status: 400 })
  }
  const updated = await resolveReceivable(id, { status: action, actor: actor.staffId, note })
  if (!updated) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  await recordAudit({
    kind: 'receivable',
    actor: actor.staffId,
    actorName: actor.staffName,
    refId: `receivable:${updated.id}`,
    detail: action === 'settled' ? `미수금 수동 정산 완료 (${updated.amount} Pi)` : `미수금 무효 처리 (${updated.amount} Pi)`,
    reason: note || undefined,
    after: { status: updated.status, userId: updated.userId, service: updated.service },
  }).catch(() => undefined)
  return NextResponse.json({ ok: true, receivable: updated })
}
