import { NextResponse } from 'next/server'
import { deletePartnerLink, getPartnerLink, upsertPartnerLink } from '@/lib/partner-ledger-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    uid?: unknown
    username?: unknown
    wallet?: unknown
    role?: unknown
    name?: unknown
    phone?: unknown
    detail?: unknown
    vehicle?: unknown
    plate?: unknown
    region?: unknown
    serviceType?: unknown
    linkedAt?: unknown
  } | null
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const wallet = typeof body?.wallet === 'string' ? body.wallet.trim() : ''
  if (!uid || !wallet) {
    return NextResponse.json({ error: 'uid and wallet required' }, { status: 400 })
  }
  const previous = getPartnerLink(uid)
  const text = (value: unknown, fallback?: string) => (typeof value === 'string' ? value.trim() : fallback)
  const record = upsertPartnerLink({
    uid,
    username: username || uid,
    wallet,
    role: text(body?.role, previous?.role),
    name: text(body?.name, previous?.name),
    phone: text(body?.phone, previous?.phone),
    detail: text(body?.detail, previous?.detail),
    vehicle: text(body?.vehicle, previous?.vehicle),
    plate: text(body?.plate, previous?.plate),
    region: text(body?.region, previous?.region),
    serviceType: text(body?.serviceType, previous?.serviceType),
    linkedAt: typeof body?.linkedAt === 'string' ? body.linkedAt : previous?.linkedAt || new Date().toISOString(),
  })
  return NextResponse.json({ ok: true, profile: record })
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as { uid?: unknown } | null
  const fromBody = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const uid = fromBody || new URL(request.url).searchParams.get('uid')?.trim() || ''
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 })
  deletePartnerLink(uid)
  return NextResponse.json({ ok: true })
}

export async function GET(request: Request) {
  const uid = new URL(request.url).searchParams.get('uid')?.trim() || ''
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 })
  const profile = getPartnerLink(uid)
  if (!profile) return NextResponse.json({ ok: false, profile: null }, { status: 404 })
  return NextResponse.json({ ok: true, profile })
}
