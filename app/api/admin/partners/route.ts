import { NextResponse } from 'next/server'
import { adminActor, isAdminRequest } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import { getPartnerLink, listPartnerLinks, upsertPartnerLink, type PartnerLinkRecord } from '@/lib/partner-ledger-server'
import { listRegistryUsers, upsertRegistryUser, type RegistryUser } from '@/lib/user-registry'
import { ALL_PARTNER_SERVICE_TYPES } from '@/lib/partner-services'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function registryToLink(user: RegistryUser): PartnerLinkRecord {
  return {
    uid: user.uid,
    username: user.username,
    wallet: user.wallet,
    role: user.role,
    name: user.name,
    phone: user.phone,
    detail: user.detail,
    vehicle: user.vehicle,
    plate: user.plate,
    region: user.region,
    serviceType: user.serviceType,
    insuranceCompany: user.insuranceCompany,
    insurancePolicyNo: user.insurancePolicyNo,
    insuranceExpiresAt: user.insuranceExpiresAt,
    insuranceDocName: user.insuranceDocName,
    insuranceDocAt: user.insuranceDocAt,
    linkedAt: user.linkedAt,
    updatedAt: user.updatedAt,
  }
}

/**
 * 기사·파트너 목록 — 영속 레지스트리(KV/파일)를 권위로 하고 인메모리 연동
 * 장부를 병합한다. 인메모리만 읽으면 서버리스 인스턴스가 바뀌거나 재시작될
 * 때 다른 인스턴스에서 등록된 기사·파트너가 목록에서 사라진다.
 */
async function mergedPartners(): Promise<PartnerLinkRecord[]> {
  const [links, registry] = await Promise.all([
    Promise.resolve(listPartnerLinks()),
    listRegistryUsers().catch(() => [] as RegistryUser[]),
  ])
  const merged = new Map<string, PartnerLinkRecord>()
  for (const user of registry) {
    if (user.role !== '기사' && user.role !== '파트너') continue
    merged.set(user.uid, registryToLink(user))
  }
  for (const link of links) {
    const existing = merged.get(link.uid)
    // 인메모리 링크가 더 최신이면 그 값으로 덮는다 — 아직 레지스트리에
    // 반영되지 않은 직후 쓰기도 목록에 보이게 한다.
    if (!existing || link.updatedAt > existing.updatedAt) merged.set(link.uid, link)
  }
  return [...merged.values()].sort((a, b) => b.linkedAt.localeCompare(a.linkedAt))
}

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, partners: await mergedPartners() })
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
    typeof body?.serviceType === 'string' && (ALL_PARTNER_SERVICE_TYPES as readonly string[]).includes(body.serviceType.trim())
      ? body.serviceType.trim()
      : '택시'
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
  // 영속 가입자 레지스트리에도 반영 — 관리자가 직접 등록한 기사·파트너도
  // '가입자' 목록과 다른 인스턴스의 '기사·파트너' 목록에 보이게 한다.
  await upsertRegistryUser(record).catch((error) => {
    console.error('[partners] registry upsert failed', { uid: record.uid, error })
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
