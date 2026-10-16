import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import { listPenalties, listReceivables, relievePenalty, resolveReceivable, type ReceivableStatus } from '@/lib/receivable-store'

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
  const penalties = await listPenalties()
  return NextResponse.json({ ok: true, total: items.length, openTotal, penalties, generatedAt: new Date().toISOString(), items })
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
    userId?: unknown
    points?: unknown
  } | null
  const note = typeof body?.note === 'string' ? body.note : ''

  // 페널티 감면/제한 해제 — 운영자 정책 판단 영역.
  if (body?.action === 'penalty-waive' || body?.action === 'penalty-clear' || body?.action === 'penalty-unrestrict') {
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    const penalty = await relievePenalty(userId, {
      points:
        body.action === 'penalty-clear'
          ? Number.MAX_SAFE_INTEGER
          : body.action === 'penalty-waive'
            ? Math.max(1, Math.floor(Number(body?.points) || 10))
            : 0,
      clearRestriction: body.action !== 'penalty-waive',
      actor: actor.staffId,
      note,
    })
    if (!penalty) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await recordAudit({
      kind: 'receivable',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `penalty:${userId}`,
      detail:
        body.action === 'penalty-waive'
          ? `페널티 감면 → 잔여 ${penalty.points}점`
          : body.action === 'penalty-unrestrict'
            ? '이용 제한 즉시 해제'
            : '페널티 전체 초기화 + 제한 해제',
      reason: note || undefined,
      after: { points: penalty.points, restrictedUntil: penalty.restrictedUntil },
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, penalty })
  }

  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const action = body?.action === 'settle' ? 'settled' : body?.action === 'void' ? 'void' : null
  if (!id || !action) {
    return NextResponse.json({ error: 'invalid_fields' }, { status: 400 })
  }
  const result = await resolveReceivable(id, { status: action, actor: actor.staffId, note })
  if (!result) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const updated = result.record
  await recordAudit({
    kind: 'receivable',
    actor: actor.staffId,
    actorName: actor.staffName,
    refId: `receivable:${updated.id}`,
    detail: action === 'settled' ? `미수금 수동 정산 완료 (${updated.amount} Pi)` : `미수금 무효 처리 (${updated.amount} Pi)`,
    reason: note || undefined,
    after: { status: updated.status, userId: updated.userId, service: updated.service },
  }).catch(() => undefined)
  return NextResponse.json({ ok: true, receivable: updated, penalty: result.penalty })
}
