import { NextResponse } from 'next/server'
import { getPartnerLink, upsertPartnerLink } from '@/lib/partner-ledger-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    uid?: unknown
    username?: unknown
    wallet?: unknown
    role?: unknown
    name?: unknown
    linkedAt?: unknown
  } | null
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const username = typeof body?.username === 'string' ? body.username.trim() : ''
  const wallet = typeof body?.wallet === 'string' ? body.wallet.trim() : ''
  if (!uid || !wallet) {
    return NextResponse.json({ error: 'uid and wallet required' }, { status: 400 })
  }
  const record = upsertPartnerLink({
    uid,
    username: username || uid,
    wallet,
    role: typeof body?.role === 'string' ? body.role : undefined,
    name: typeof body?.name === 'string' ? body.name : undefined,
    linkedAt: typeof body?.linkedAt === 'string' ? body.linkedAt : new Date().toISOString(),
  })
  return NextResponse.json({ ok: true, profile: record })
}

export async function GET(request: Request) {
  const uid = new URL(request.url).searchParams.get('uid')?.trim() || ''
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 })
  const profile = getPartnerLink(uid)
  if (!profile) return NextResponse.json({ ok: false, profile: null }, { status: 404 })
  return NextResponse.json({ ok: true, profile })
}
