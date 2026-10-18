import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import { fdsBlockManually, fdsRelease, listFdsState, resolveFdsAlert } from '@/lib/fds-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * FDS 모니터링 — GET: 경보·차단·최근 시그널.
 * PATCH: { action: 'release', actorId } 차단 해제
 *        { action: 'resolve', alertId } 경보 처리 완료
 *        { action: 'block', actorId, reason, until? } 수동 차단
 */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const state = await listFdsState()
  return NextResponse.json({ ok: true, ...state })
}

export async function PATCH(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const action = typeof body?.action === 'string' ? body.action.trim() : ''
  const actorId = typeof body?.actorId === 'string' ? body.actorId.trim() : ''
  const alertId = typeof body?.alertId === 'string' ? body.alertId.trim() : ''

  if (action === 'release') {
    if (!actorId) return NextResponse.json({ error: 'actorId required' }, { status: 400 })
    await fdsRelease(actorId)
    await recordAudit({
      kind: 'fds',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `fds:${actorId}`,
      detail: `FDS 차단 해제 · ${actorId}`,
    }).catch(() => undefined)
    return NextResponse.json({ ok: true })
  }

  if (action === 'resolve') {
    if (!alertId) return NextResponse.json({ error: 'alertId required' }, { status: 400 })
    const result = await resolveFdsAlert(alertId, actor.staffId)
    if (!result.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await recordAudit({
      kind: 'fds',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `fds:${alertId}`,
      detail: `FDS 경보 처리 완료 · ${result.alert.ruleLabel}`,
    }).catch(() => undefined)
    return NextResponse.json({ ok: true })
  }

  if (action === 'block') {
    if (!actorId) return NextResponse.json({ error: 'actorId required' }, { status: 400 })
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
    if (!reason) return NextResponse.json({ error: 'reason required' }, { status: 400 })
    const until = typeof body?.until === 'string' && Date.parse(body.until) > Date.now() ? body.until : undefined
    await fdsBlockManually(actorId, { reason, until, by: actor.staffId })
    await recordAudit({
      kind: 'fds',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `fds:${actorId}`,
      detail: `FDS 수동 차단 · ${actorId}${until ? ` · ${until}까지` : ' · 영구'} · ${reason}`,
    }).catch(() => undefined)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
