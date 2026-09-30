import { NextResponse } from 'next/server'
import { createAdminSession, deleteAdminSession, verifyAdminPassword } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!password) return NextResponse.json({ error: 'password required' }, { status: 400 })
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
