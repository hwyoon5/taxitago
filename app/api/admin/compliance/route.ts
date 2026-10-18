import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import { complianceGate, getCompliance, setComplianceDocStatus } from '@/lib/compliance-store'
import { listRegistryUsers } from '@/lib/user-registry'
import { COMPLIANCE_DOC_LABEL, effectiveServiceRoles, isComplianceDocType, requiredComplianceDocs, type ComplianceDocType } from '@/lib/partner-services'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 자격 인증 관리 — 기사 가입자의 필수 증빙 제출·심사 상태를 합친 목록.
 * 레지스트리의 기사(기사 역할 1개 이상)만 대상으로 하고, 서류가 없는 타입은
 * 'missing'으로 표시한다.
 */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const users = await listRegistryUsers().catch(() => [])
  const rows: {
    uid: string
    username: string
    name: string
    phone: string
    serviceType: string
    serviceRoles: string[]
    locked: boolean
    required: ComplianceDocType[]
    docs: Record<string, unknown>
    overall: 'compliant' | 'pending' | 'rejected' | 'none'
    linkedAt: string
  }[] = []
  for (const user of users) {
    if (user.withdrawnAt) continue
    const roles = effectiveServiceRoles(user)
    if (!roles.length) continue
    const required = requiredComplianceDocs(user)
    const record = await getCompliance(user.uid)
    const gate = await complianceGate(user).catch(() => null)
    const docs = Object.fromEntries(
      required.map((type) => {
        const doc = record[type]
        return [
          type,
          doc
            ? {
                name: doc.name,
                uploadedAt: doc.uploadedAt,
                status: doc.status,
                reviewedBy: doc.reviewedBy,
                reviewedAt: doc.reviewedAt,
                reviewNote: doc.reviewNote,
              }
            : { status: 'missing' },
        ]
      }),
    )
    rows.push({
      uid: user.uid,
      username: user.username,
      name: user.name || '',
      phone: user.phone || '',
      serviceType: user.serviceType || '',
      serviceRoles: roles,
      locked: Boolean(user.lockedAt),
      required,
      docs,
      overall: gate?.status ?? 'pending',
      linkedAt: user.linkedAt,
    })
  }
  rows.sort((a, b) => {
    // 심사 대기·반려가 위로 — 운영자가 처리할 건부터 본다.
    const rank = (row: (typeof rows)[number]) => (row.overall === 'rejected' ? 0 : row.overall === 'pending' ? 1 : 2)
    return rank(a) - rank(b) || b.linkedAt.localeCompare(a.linkedAt)
  })
  return NextResponse.json({ ok: true, partners: rows })
}

/** 서류 심사 — approve/reject + 사유, 감사 로그(kind 'partner')를 남긴다. */
export async function POST(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as {
    uid?: unknown
    type?: unknown
    action?: unknown
    note?: unknown
  } | null
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const type = typeof body?.type === 'string' ? body.type.trim() : ''
  const action = body?.action === 'approve' ? 'approved' : body?.action === 'reject' ? 'rejected' : ''
  const note = typeof body?.note === 'string' ? body.note.trim() : ''
  if (!uid || !isComplianceDocType(type) || !action) {
    return NextResponse.json({ error: 'uid, type, action(approve|reject) required' }, { status: 400 })
  }
  if (action === 'rejected' && !note) {
    return NextResponse.json({ error: '반려 사유를 입력해 주세요.' }, { status: 400 })
  }
  const doc = await setComplianceDocStatus(uid, type, action, { by: actor.staffId, note })
  if (!doc) return NextResponse.json({ error: '제출된 서류가 없습니다.' }, { status: 404 })
  await recordAudit({
    kind: 'partner',
    actor: actor.staffId,
    actorName: actor.staffName,
    refId: `compliance:${uid}:${type}`,
    detail: `자격 인증 ${action === 'approved' ? '승인' : '반려'} — ${COMPLIANCE_DOC_LABEL[type]}${note ? ` · ${note}` : ''}`,
    after: { uid, type, status: action, note: note || undefined },
  }).catch(() => undefined)
  const users = await listRegistryUsers().catch(() => [])
  const user = users.find((row) => row.uid === uid)
  const gate = user ? await complianceGate(user).catch(() => null) : null
  return NextResponse.json({ ok: true, doc, gate })
}
