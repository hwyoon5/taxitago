import { NextResponse } from 'next/server'
import { adminActor, isAdminRequest } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
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
  const actor = await adminActor(request)
  if (!actor) {
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
    insuranceCompany?: unknown
    insurancePolicyNo?: unknown
    insuranceExpiresAt?: unknown
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
    insuranceCompany: text(body?.insuranceCompany, previous?.insuranceCompany) || '',
    insurancePolicyNo: text(body?.insurancePolicyNo, previous?.insurancePolicyNo) || '',
    insuranceExpiresAt: text(body?.insuranceExpiresAt, previous?.insuranceExpiresAt) || '',
    linkedAt: previous?.linkedAt || new Date().toISOString(),
  })
  await recordAudit({
    kind: 'partner',
    actor: actor.staffId,
    actorName: actor.staffName,
    refId: `partner:${record.uid}`,
    detail: `기사·파트너 ${previous ? '수정' : '등록'} ${record.name}(${record.uid}) · ${record.role}/${record.serviceType}`,
    after: { uid: record.uid, name: record.name, phone: record.phone, role: record.role, serviceType: record.serviceType },
  }).catch(() => undefined)
  return NextResponse.json({ ok: true, partner: record })
}
