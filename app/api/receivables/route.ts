import { NextResponse } from 'next/server'
import { listReceivables, recordReceivable, type ReceivableStatus } from '@/lib/receivable-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 미수금 접수/조회.
 * POST — 셀프·무인 서비스 종료 시점 결제 실패를 이용자 클라이언트가 신고한다.
 *         서버는 금액·서비스만 검증하고 식별 정보는 클라이언트 보고값을 신뢰한다
 *         (연락 목적의 운영 데이터이며 Pi 검증 장부가 아니다).
 * GET  ?uid=<userId>      — 본인 미수금 목록(이용자 화면)
 *      ?partner=<ownerUid> — 해당 파트너 소유 기기의 미수금(파트너 대시보드)
 *      &status=open|settled|void
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const uid = (params.get('uid') || '').trim()
  const partner = (params.get('partner') || '').trim()
  if (!uid && !partner) {
    return NextResponse.json({ error: 'uid or partner required' }, { status: 400 })
  }
  const statusRaw = (params.get('status') || '').trim()
  const status: ReceivableStatus | '' =
    statusRaw === 'open' || statusRaw === 'settled' || statusRaw === 'void' ? statusRaw : ''
  const items = await listReceivables({
    status,
    userId: uid || undefined,
    partnerId: partner || undefined,
  })
  return NextResponse.json({ ok: true, total: items.length, items })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const record = await recordReceivable({
    userId: typeof body.userId === 'string' ? body.userId : '',
    wallet: typeof body.wallet === 'string' ? body.wallet : '',
    phone: typeof body.phone === 'string' ? body.phone : '',
    service: typeof body.service === 'string' ? body.service : '',
    serviceKey: typeof body.serviceKey === 'string' ? body.serviceKey : '',
    partnerId: typeof body.partnerId === 'string' ? body.partnerId : '',
    partnerName: typeof body.partnerName === 'string' ? body.partnerName : '',
    deviceId: typeof body.deviceId === 'string' ? body.deviceId : '',
    place: typeof body.place === 'string' ? body.place : '',
    amount: typeof body.amount === 'number' ? body.amount : NaN,
    reason: typeof body.reason === 'string' ? body.reason : '',
    detail: typeof body.detail === 'string' ? body.detail : '',
  })
  if (!record) {
    return NextResponse.json({ error: 'invalid_fields' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, receivable: record })
}
