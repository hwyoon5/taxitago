import { NextResponse } from 'next/server'
import { ridesForLostAndFound } from '@/lib/support-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const userId = url.searchParams.get('userId')?.trim() || ''
  const role = url.searchParams.get('role')
  if (!userId || (role !== 'passenger' && role !== 'driver')) {
    return NextResponse.json({ error: 'userId and role required' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, rides: ridesForLostAndFound(userId, role) })
}
