import { NextResponse } from 'next/server'
import { getCompliance, saveComplianceDoc } from '@/lib/compliance-store'
import { isAdminRequest } from '@/lib/admin-auth'
import { isComplianceDocType } from '@/lib/partner-services'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 심사 상태·메타만 내려주는 뷰 — 이미지 원본(dataUrl)은 제외한다. */
function docMeta(doc: { name: string; uploadedAt: string; status: string; reviewedBy?: string; reviewedAt?: string; reviewNote?: string }) {
  return {
    name: doc.name,
    uploadedAt: doc.uploadedAt,
    status: doc.status,
    reviewedBy: doc.reviewedBy,
    reviewedAt: doc.reviewedAt,
    reviewNote: doc.reviewNote,
  }
}

/**
 * 자격 인증 서류 업로드(운전면허증·화물운송종사자 자격증·차량 등록증).
 * 새 업로드는 항상 'pending' 심사 대기 상태로 저장된다.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    uid?: unknown
    type?: unknown
    name?: unknown
    mime?: unknown
    dataUrl?: unknown
  } | null
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const type = typeof body?.type === 'string' ? body.type.trim() : ''
  if (!isComplianceDocType(type)) {
    return NextResponse.json({ error: '지원하지 않는 서류 종류입니다.' }, { status: 400 })
  }
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const mime = typeof body?.mime === 'string' ? body.mime.trim().toLowerCase() : ''
  const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl : ''
  const saved = await saveComplianceDoc(uid, type, { name, mime, dataUrl })
  if (!saved) {
    return NextResponse.json({ error: 'uid가 올바르지 않거나 이미지/PDF 형식이 아닙니다. (최대 약 2.5MB)' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, doc: docMeta(saved) })
}

/**
 * 서류 조회 — `type` 없이 호출하면 uid의 상태 묶음(메타만)을 돌려준다.
 * 이미지 원본(type 지정)은 본인(viewerUid=uid) 또는 관리자만 열람할 수 있다.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const uid = params.get('uid')?.trim() || ''
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 })
  const record = await getCompliance(uid)
  const type = params.get('type')?.trim() || ''
  if (type) {
    // 신분 증빙 원본은 관리자만 열람 — 메타(상태 묶음)만 일반 조회로 내린다.
    const admin = await isAdminRequest(request)
    if (!admin) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    if (!isComplianceDocType(type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 })
    const doc = record[type]
    if (!doc) return NextResponse.json({ ok: false, doc: null }, { status: 404 })
    return NextResponse.json({ ok: true, doc })
  }
  return NextResponse.json({ ok: true, docs: Object.fromEntries(Object.entries(record).map(([key, doc]) => [key, docMeta(doc)])) })
}
