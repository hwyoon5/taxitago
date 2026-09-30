import { NextResponse } from 'next/server'
import { resetAdminPassword } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { code?: unknown; newPassword?: unknown } | null
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''
  if (!code || !newPassword) {
    return NextResponse.json({ error: 'code and newPassword required' }, { status: 400 })
  }
  const result = await resetAdminPassword(code, newPassword)
  if (!result.ok) {
    const status = result.error === 'invalid_code' ? 401 : result.error === 'totp_not_configured' ? 503 : 400
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ ok: true })
}
