import { NextResponse } from 'next/server'
import {
  adminActor,
  createAdminSession,
  deleteAdminSession,
  hasAdminPassword,
  setupAdminPassword,
  verifyAdminPassword,
} from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import { verifyStaffLogin } from '@/lib/staff-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const [actor, configured] = await Promise.all([adminActor(request), hasAdminPassword()])
  return NextResponse.json({ ok: true, authenticated: Boolean(actor), needsSetup: !configured, actor })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    action?: unknown
    password?: unknown
    staffId?: unknown
  } | null
  const password = typeof body?.password === 'string' ? body.password : ''
  const staffId = typeof body?.staffId === 'string' ? body.staffId.trim() : ''
  if (!password) return NextResponse.json({ error: 'password required' }, { status: 400 })

  if (body?.action === 'setup') {
    const result = await setupAdminPassword(password)
    if (!result.ok) {
      const status = result.error === 'already_configured' ? 409 : 400
      return NextResponse.json({ error: result.error }, { status })
    }
    const session = await createAdminSession()
    return NextResponse.json({ ok: true, ...session })
  }

  if (staffId) {
    const staff = await verifyStaffLogin(staffId, password.trim())
    if (!staff) {
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
    }
    const session = await createAdminSession({
      staffId: staff.loginId,
      staffName: staff.name,
      staffRole: staff.role,
    })
    await recordAudit({
      kind: 'login',
      actor: staff.loginId,
      actorName: staff.name,
      detail: `직원 로그인 (${staff.role === 'manager' ? '매니저' : '직원'})`,
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, ...session })
  }

  if (!(await hasAdminPassword())) {
    return NextResponse.json({ error: 'setup_required' }, { status: 409 })
  }
  if (!(await verifyAdminPassword(password))) {
    return NextResponse.json({ error: 'invalid_password' }, { status: 401 })
  }
  const session = await createAdminSession()
  return NextResponse.json({ ok: true, ...session })
}

export async function DELETE(request: Request) {
  const token = request.headers.get('x-admin-key')?.trim() || ''
  await deleteAdminSession(token)
  return NextResponse.json({ ok: true })
}
