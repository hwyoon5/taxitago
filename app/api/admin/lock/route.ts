import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { acquireEditLock, editLockStatus, releaseEditLock, renewEditLock, EDIT_LOCK_KINDS, type EditLockKind } from '@/lib/edit-lock-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type LockBody = { kind?: unknown; id?: unknown } | null

function parse(body: LockBody): { kind: EditLockKind; id: string } | null {
  const kind = typeof body?.kind === 'string' ? body.kind : ''
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if (!id || !(EDIT_LOCK_KINDS as readonly string[]).includes(kind)) return null
  return { kind: kind as EditLockKind, id }
}

const holderOf = (actor: { staffId: string; staffName: string }) => ({ staffId: actor.staffId, staffName: actor.staffName })

/** POST {kind, id} — 편집 잠금 획득. 다른 직원이 쥐고 있으면 409 + 소유자 정보. */
export async function POST(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = parse(await request.json().catch(() => null))
  if (!parsed) return NextResponse.json({ error: 'kind and id required' }, { status: 400 })
  const result = await acquireEditLock(parsed.kind, parsed.id, holderOf(actor))
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: 'locked', lock: result.lock }, { status: 409 })
  }
  return NextResponse.json({ ok: true, lock: result.lock })
}

/** PUT {kind, id} — 소유자의 잠금 연장(하트비트). */
export async function PUT(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = parse(await request.json().catch(() => null))
  if (!parsed) return NextResponse.json({ error: 'kind and id required' }, { status: 400 })
  const result = await renewEditLock(parsed.kind, parsed.id, holderOf(actor))
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: 'locked', lock: result.lock }, { status: 409 })
  }
  return NextResponse.json({ ok: true, lock: result.lock })
}

/** DELETE {kind, id} — 소유자의 잠금 해제. */
export async function DELETE(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = parse(await request.json().catch(() => null))
  if (!parsed) return NextResponse.json({ error: 'kind and id required' }, { status: 400 })
  const released = await releaseEditLock(parsed.kind, parsed.id, holderOf(actor))
  return NextResponse.json({ ok: released })
}

/** GET ?kind=&id= — 잠금 상태 조회(다른 직원이 편집 중인지 확인용). */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const parsed = parse({ kind: url.searchParams.get('kind'), id: url.searchParams.get('id') })
  if (!parsed) return NextResponse.json({ error: 'kind and id required' }, { status: 400 })
  const lock = await editLockStatus(parsed.kind, parsed.id)
  return NextResponse.json({ ok: true, lock })
}
