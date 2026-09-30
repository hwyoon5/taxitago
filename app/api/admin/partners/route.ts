import { NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import { getPartnerLink, listPartnerLinks, upsertPartnerLink } from '@/lib/partner-ledger-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, partners: listPartnerLinks() })
}

export async function POST(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as {
    uid?: unknown
    role?: unknown
    serviceType?: unknown
    name?: unknown
    phone?: unknown
    vehicle?: unknown
    plate?: unknown
    region?: unknown
    detail?: unknown
    wallet?: unknown
    username?: unknown
  } | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : ''
  if (!name || !phone) {
    return NextResponse.json({ error: 'name and phone required' }, { status: 400 })
  }
  const uid = typeof body?.uid === 'string' && body.uid.trim() ? body.uid.trim() : `partner-${crypto.randomUUID().slice(0, 8)}`
  const previous = getPartnerLink(uid)
  const role = body?.role === '파트너' ? '파트너' : '기사'
  const serviceType =
    body?.serviceType === '대리운전' || body?.serviceType === '택배' ? body.serviceType : '택시'
  const text = (value: unknown, fallback?: string) => (typeof value === 'string' && value.trim() ? value.trim() : fallback)
  const record = upsertPartnerLink({
    uid,
    username: text(body?.username, previous?.username) || name,
    wallet: text(body?.wallet, previous?.wallet) || '',
    role,
    name,
    phone,
    detail: text(body?.detail, previous?.detail) || '',
    vehicle: text(body?.vehicle, previous?.vehicle) || '',
    plate: text(body?.plate, previous?.plate) || '',
    region: text(body?.region, previous?.region) || '',
    serviceType,
    linkedAt: previous?.linkedAt || new Date().toISOString(),
  })
  return NextResponse.json({ ok: true, partner: record })
}
