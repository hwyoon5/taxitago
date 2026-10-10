import { NextResponse } from 'next/server'
import { getInsuranceDoc, saveInsuranceDoc } from '@/lib/insurance-doc-store'
import { getPartnerLink, upsertPartnerLink } from '@/lib/partner-ledger-server'
import { upsertRegistryUser } from '@/lib/user-registry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 보험증권 사본 업로드/조회. uid 기준으로 저장하며, 성공 시 파트너 레코드의
 * insuranceDocName/insuranceDocAt 메타데이터도 함께 갱신한다.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    uid?: unknown
    name?: unknown
    mime?: unknown
    dataUrl?: unknown
  } | null
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  if (!uid || uid.length > 64 || !/^[\w-]+$/.test(uid)) {
    return NextResponse.json({ error: 'uid가 올바르지 않습니다.' }, { status: 400 })
  }
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const mime = typeof body?.mime === 'string' ? body.mime.trim().toLowerCase() : ''
  const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl : ''
  const saved = await saveInsuranceDoc(uid, { name, mime, dataUrl })
  if (!saved) {
    return NextResponse.json(
      { error: '이미지 또는 PDF 파일만 업로드할 수 있습니다. (최대 약 2.5MB)' },
      { status: 400 },
    )
  }
  const record = getPartnerLink(uid)
  if (record) {
    upsertPartnerLink({ ...record, insuranceDocName: saved.name, insuranceDocAt: saved.uploadedAt })
  }
  // 영속 레지스트리에도 증권 메타데이터를 반영 — 다른 인스턴스의 관리자
  // '기사·파트너' 목록에서도 업로드 사실이 보이게 한다.
  await upsertRegistryUser({ uid, insuranceDocName: saved.name, insuranceDocAt: saved.uploadedAt }).catch((error) =>
    console.error('[partners] insurance doc registry upsert failed', { uid, error }),
  )
  return NextResponse.json({ ok: true, doc: { name: saved.name, uploadedAt: saved.uploadedAt } })
}

export async function GET(request: Request) {
  const uid = new URL(request.url).searchParams.get('uid')?.trim() || ''
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 })
  const doc = await getInsuranceDoc(uid)
  if (!doc) return NextResponse.json({ ok: false, doc: null }, { status: 404 })
  return NextResponse.json({ ok: true, doc })
}
