import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { listRentals } from '@/lib/rental-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 관리자 공유 모빌리티 대여 이력 조회 — 대여 중/반납 전체를 날짜·상태·검색어로 필터한다.
 * from·to: YYYY-MM-DD (KST 하루 경계), status: rented|returned,
 * q: 기기 ID·모델·주소·소유 파트너·대여자 부분 일치.
 */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const params = new URL(request.url).searchParams
  const from = params.get('from')?.trim() || ''
  const to = params.get('to')?.trim() || ''
  const status = params.get('status')?.trim() || ''
  const q = (params.get('q') || '').trim().toLowerCase()

  const fromMs = /^\d{4}-\d{2}-\d{2}$/.test(from) ? Date.parse(`${from}T00:00:00+09:00`) : -Infinity
  const toMs = /^\d{4}-\d{2}-\d{2}$/.test(to) ? Date.parse(`${to}T23:59:59.999+09:00`) : Infinity

  const items = (await listRentals()).filter((row) => {
    const at = Date.parse(row.rentedAt)
    if (Number.isFinite(fromMs) && at < fromMs) return false
    if (Number.isFinite(toMs) && at > toMs) return false
    if (status && row.status !== status) return false
    if (q) {
      const hay = [row.deviceId, row.model, row.address, row.ownerName, row.ownerUid, row.renterId, row.id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  return NextResponse.json({ ok: true, total: items.length, generatedAt: new Date().toISOString(), items })
}
