import { NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { listAudit } from '@/lib/audit-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const entries = await listAudit(500)
  return NextResponse.json({ ok: true, entries })
}
