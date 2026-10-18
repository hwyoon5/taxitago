import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import { altPayAdminState, releaseAltPayLock, settleAltPayFee, waiveAltPayFee } from '@/lib/altpay-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 타 결제 수단 완료·미입금 수수료 이월 모니터링.
 * GET  — 완료 기록(상태·사유) + 제공자별 미입금 수수료 장부.
 * POST { action: 'settle', providerId, amount? } — 수수료 입금 처리(0이면 자동 해제)
 *      { action: 'waive', providerId, amount? }  — 수수료 면제
 *      { action: 'unlock', providerId }         — 자동 차단 수동 해제
 */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ ok: true, ...(await altPayAdminState()) })
}

export async function POST(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { action?: unknown; providerId?: unknown; amount?: unknown } | null
  const action = typeof body?.action === 'string' ? body.action.trim() : ''
  const providerId = typeof body?.providerId === 'string' ? body.providerId.trim() : ''
  const amount = typeof body?.amount === 'number' && Number.isFinite(body.amount) ? body.amount : null
  if (!providerId) return NextResponse.json({ error: 'providerId required' }, { status: 400 })

  if (action === 'settle' || action === 'waive' || action === 'unlock') {
    const result =
      action === 'settle'
        ? await settleAltPayFee(providerId, amount, actor.staffId)
        : action === 'waive'
          ? await waiveAltPayFee(providerId, amount, actor.staffId)
          : await releaseAltPayLock(providerId)
    if (!result.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const settled = result as { paid?: number; waived?: number }
    await recordAudit({
      kind: 'altpay',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: providerId,
      detail:
        action === 'settle'
          ? `타 결제 미입금 수수료 입금 처리 ${(settled.paid ?? 0).toFixed(4)} Pi`
          : action === 'waive'
            ? `타 결제 미입금 수수료 면제 ${(settled.waived ?? 0).toFixed(4)} Pi`
            : '타 결제 자동 차단 수동 해제',
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, ledger: result.ledger })
  }
  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}
