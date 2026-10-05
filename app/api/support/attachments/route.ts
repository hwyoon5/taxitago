import { NextResponse } from 'next/server'
import { getAttachments } from '@/lib/attachment-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 문의/분실물 첨부 사진 조회. 엔티티 ID(uuid)를 알아야 조회 가능하다. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')?.trim() || ''
  if (!id || id.length > 64 || !/^[\w-]+$/.test(id)) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, photos: await getAttachments(id) })
}
