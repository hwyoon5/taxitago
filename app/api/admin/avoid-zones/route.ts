import { NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { hydrateAvoidFromKv, listAvoidZones } from '@/lib/avoid-zone-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  await hydrateAvoidFromKv()
  return NextResponse.json({ ok: true, zones: listAvoidZones() })
}
