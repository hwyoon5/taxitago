import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import { createStaff, deleteStaff, listStaff, publicStaff, updateStaff } from '@/lib/staff-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_login_id: 'invalid_login_id',
  invalid_name: 'invalid_name',
  password_too_short: 'password_too_short',
  duplicate_login_id: 'duplicate_login_id',
  not_found: 'not_found',
}

export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (actor.role !== 'master') {
    return NextResponse.json({ error: 'master_only' }, { status: 403 })
  }
  const staff = await listStaff()
  return NextResponse.json({ ok: true, staff: staff.map(publicStaff) })
}

export async function POST(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (actor.role !== 'master') {
    return NextResponse.json({ error: 'master_only' }, { status: 403 })
  }
  const body = (await request.json().catch(() => null)) as {
    loginId?: unknown; name?: unknown; password?: unknown; role?: unknown
  } | null
  const loginId = typeof body?.loginId === 'string' ? body.loginId : ''
  const name = typeof body?.name === 'string' ? body.name : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const role = body?.role === 'manager' ? 'manager' : 'staff'
  const result = await createStaff({ loginId, name, password, role })
  if (!result.ok) {
    return NextResponse.json({ error: ERROR_MESSAGES[result.error] || result.error }, { status: 400 })
  }
  await recordAudit({
    kind: 'staff',
    actor: actor.staffId,
    actorName: actor.staffName,
    detail: `직원 계정 등록 ${result.staff.loginId}(${result.staff.name}) · ${result.staff.role === 'manager' ? '매니저' : '직원'}`,
    after: publicStaff(result.staff),
  }).catch(() => undefined)
  return NextResponse.json({ ok: true, staff: publicStaff(result.staff) })
}

export async function PATCH(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (actor.role !== 'master') {
    return NextResponse.json({ error: 'master_only' }, { status: 403 })
  }
  const body = (await request.json().catch(() => null)) as {
    id?: unknown; name?: unknown; password?: unknown; role?: unknown
  } | null
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }
  const result = await updateStaff(id, {
    name: typeof body?.name === 'string' ? body.name : undefined,
    password: typeof body?.password === 'string' ? body.password : undefined,
    role: body?.role === 'manager' ? 'manager' : body?.role === 'staff' ? 'staff' : undefined,
  })
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : 400
    return NextResponse.json({ error: ERROR_MESSAGES[result.error] || result.error }, { status })
  }
  await recordAudit({
    kind: 'staff',
    actor: actor.staffId,
    actorName: actor.staffName,
    detail: `직원 계정 수정 ${result.staff.loginId}(${result.staff.name}) · ${result.staff.role === 'manager' ? '매니저' : '직원'}${typeof body?.password === 'string' && body.password.trim() ? ' · 비밀번호 변경' : ''}`,
    after: publicStaff(result.staff),
  }).catch(() => undefined)
  return NextResponse.json({ ok: true, staff: publicStaff(result.staff) })
}

export async function DELETE(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (actor.role !== 'master') {
    return NextResponse.json({ error: 'master_only' }, { status: 403 })
  }
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }
  const result = await deleteStaff(id)
  if (!result.ok) {
    return NextResponse.json({ error: ERROR_MESSAGES[result.error] || result.error }, { status: 404 })
  }
  await recordAudit({
    kind: 'staff',
    actor: actor.staffId,
    actorName: actor.staffName,
    detail: `직원 계정 삭제 ${result.staff.loginId}(${result.staff.name})`,
    before: publicStaff(result.staff),
  }).catch(() => undefined)
  return NextResponse.json({ ok: true })
}
