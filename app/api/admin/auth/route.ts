import { NextResponse } from 'next/server'
import { toDataURL as qrToDataURL } from 'qrcode'
import {
  adminActor,
  createAdminSession,
  deleteAdminSession,
  hasAdminPassword,
  hasStoredAdminPassword,
  provisionTotpSecret,
  setupAdminPassword,
  verifyAdminPassword,
} from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import { verifyStaffLogin } from '@/lib/staff-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // needsSetup은 "DB에 저장된 비밀번호" 기준 — env 비밀번호만 있으면 초기 설정
  // 화면을 열어 새 비밀번호 + OTP를 등록하게 한다.
  const [actor, stored] = await Promise.all([adminActor(request), hasStoredAdminPassword()])
  return NextResponse.json({ ok: true, authenticated: Boolean(actor), needsSetup: !stored, actor })
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
    const totp = await provisionTotpSecret()
    const qrDataUrl = await qrToDataURL(totp.uri, { margin: 1, width: 256 }).catch(() => '')
    const session = await createAdminSession()
    return NextResponse.json({ ok: true, ...session, totpSecret: totp.secret, otpauthUri: totp.uri, qrDataUrl })
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
