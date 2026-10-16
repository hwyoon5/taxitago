import { NextResponse } from 'next/server'
import {
  getPenalty,
  listReceivables,
  receivableSummary,
  recordReceivable,
  relievePenalty,
  resolveReceivable,
  type ReceivableStatus,
} from '@/lib/receivable-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 미수금 접수/조회/제공자 정산 — Pi 생태계 내 미수금 관리 전용 라우트.
 * POST  — 셀프·무인 서비스 종료 시점 결제 실패를 이용자 클라이언트가 신고한다.
 *         응답에 누적 페널티·이용제한 만기를 함께 돌려 이용자 화면이 안내한다.
 * GET   ?uid=<userId>      — 본인 미수금·페널티(이용자 화면)
 *       ?partner=<ownerUid> — 해당 파트너 소유 기기의 미수금 + 주/월·이용자별 집계
 *       &status=open|settled|void
 * PATCH — 제공자(파트너) 스코프 처리: 자사(partnerId 일치) 미수금의 settle/void,
 *         또는 자사 미수 이용자에 한한 페널티 감면·제한 해제.
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
  if (partner) {
    const summary = await receivableSummary(partner)
    // 이용자별 페널티를 집계 행에 붙인다 — 제공자가 감면 판단에 쓴다.
    const penalties = await Promise.all(summary.byUser.map((row) => getPenalty(row.userId)))
    const penaltyMap = new Map(penalties.filter(Boolean).map((p) => [p!.userId, p!]))
    return NextResponse.json({
      ok: true,
      total: items.length,
      items,
      summary: {
        ...summary,
        byUser: summary.byUser.map((row) => ({ ...row, penalty: penaltyMap.get(row.userId) ?? null })),
      },
    })
  }
  const penalty = await getPenalty(uid)
  return NextResponse.json({ ok: true, total: items.length, items, penalty })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const result = await recordReceivable({
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
  if (!result) {
    return NextResponse.json({ error: 'invalid_fields' }, { status: 400 })
  }
  const restricted =
    result.penalty?.restrictedUntil && Date.parse(result.penalty.restrictedUntil) > Date.now()
      ? result.penalty.restrictedUntil
      : null
  return NextResponse.json({
    ok: true,
    receivable: result.record,
    penalty: result.penalty ? { points: result.penalty.points, restrictedUntil: restricted } : null,
  })
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    partner?: unknown
    id?: unknown
    action?: unknown
    note?: unknown
    userId?: unknown
    points?: unknown
  } | null
  const partner = typeof body?.partner === 'string' ? body.partner.trim() : ''
  if (!partner) return NextResponse.json({ error: 'partner required' }, { status: 400 })
  const note = typeof body?.note === 'string' ? body.note : ''

  // 페널티 감면/제한 해제 — 자사 미수 이용자에게만 허용한다.
  if (body?.action === 'waive-penalty' || body?.action === 'clear-restriction') {
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    const owns = (await listReceivables({ partnerId: partner })).some((row) => row.userId === userId)
    if (!owns) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const penalty = await relievePenalty(userId, {
      points: body.action === 'waive-penalty' ? Math.max(1, Math.floor(Number(body?.points) || 10)) : 0,
      clearRestriction: body.action === 'clear-restriction',
      actor: `partner:${partner}`,
      note,
    })
    if (!penalty) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ ok: true, penalty })
  }

  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const action = body?.action === 'settle' ? 'settled' : body?.action === 'void' ? 'void' : null
  if (!id || !action) return NextResponse.json({ error: 'invalid_fields' }, { status: 400 })
  // 제공자는 자사 기기의 미수금만 처리할 수 있다.
  const owned = (await listReceivables({ partnerId: partner })).find((row) => row.id === id)
  if (!owned) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const result = await resolveReceivable(id, { status: action, actor: `partner:${partner}`, note })
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, receivable: result.record, penalty: result.penalty })
}
