import { NextResponse } from 'next/server'
import { adminActor, hasAdminPrivilege } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import { addShiftEntry, listShiftBoard, removeShiftEntry, SHIFT_TAGS, SHIFT_TEXT_MAX, type ShiftTag } from '@/lib/shift-board-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET — 인수인계 메모 목록(최신순). */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const entries = await listShiftBoard()
  return NextResponse.json({ ok: true, entries })
}

/** POST {tag, text} — 인수인계 메모 등록. 작성자는 인증된 관리자 본인. */
export async function POST(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { tag?: unknown; text?: unknown } | null
  const tag = (SHIFT_TAGS as readonly string[]).includes(body?.tag as string) ? (body!.tag as ShiftTag) : '특이사항'
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, SHIFT_TEXT_MAX) : ''
  if (!text) return NextResponse.json({ error: '내용을 입력해 주세요.' }, { status: 400 })
  const entry = await addShiftEntry({
    staffId: actor.staffId,
    staffName: actor.staffName,
    position: actor.position,
    tag,
    text,
  })
  await recordAudit({
    kind: 'shift',
    actor: actor.staffId,
    actorName: actor.staffName,
    refId: `shift:${entry.id}`,
    detail: `인수인계 메모 등록 [${tag}] ${text.slice(0, 40)}`,
  }).catch(() => undefined)
  return NextResponse.json({ ok: true, entry })
}

/** DELETE {id} — 본인 메모 또는 상위 직급(팀장·최고책임자)만 삭제할 수 있다. */
export async function DELETE(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const entries = await listShiftBoard()
  const target = entries.find((entry) => entry.id === id)
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (target.staffId !== actor.staffId && !hasAdminPrivilege(actor)) {
    return NextResponse.json({ error: '본인이 작성한 메모만 삭제할 수 있습니다.' }, { status: 403 })
  }
  const removed = await removeShiftEntry(id)
  if (!removed) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await recordAudit({
    kind: 'shift',
    actor: actor.staffId,
    actorName: actor.staffName,
    refId: `shift:${id}`,
    detail: `인수인계 메모 삭제 · ${target.staffName}의 [${target.tag}] 메모`,
  }).catch(() => undefined)
  return NextResponse.json({ ok: true })
}
