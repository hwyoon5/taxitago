import { NextResponse } from 'next/server'
import {
  createAdminSession,
  deleteAdminSession,
  hasAdminPassword,
  isAdminRequest,
  setupAdminPassword,
  verifyAdminPassword,
} from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const [authenticated, configured] = await Promise.all([isAdminRequest(request), hasAdminPassword()])
  return NextResponse.json({ ok: true, authenticated, needsSetup: !configured })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { action?: unknown; password?: unknown } | null
  const password = typeof body?.password === 'string' ? body.password : ''
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
