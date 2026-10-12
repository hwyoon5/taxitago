import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import { sendPiToAddress } from '@/lib/pi-direct-send'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'
import {
  getPayoutRequest,
  listPayoutRequests,
  markPayoutApproved,
  markPayoutFailed,
  markPayoutRejected,
} from '@/lib/payout-request-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const requests = await listPayoutRequests()
  return NextResponse.json({
    ok: true,
    requests,
    pending: requests.filter((entry) => entry.status === 'pending').length,
  })
}

export async function POST(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as {
    action?: unknown
    id?: unknown
    reason?: unknown
  } | null
  const action = body?.action
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  }
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 200) : ''
  const pending = id ? await getPayoutRequest(id) : null
  if (!pending || pending.status !== 'pending') {
    return NextResponse.json({ error: 'not_found_or_decided' }, { status: 404 })
  }

  if (action === 'reject') {
    if (!reason) {
      return NextResponse.json({ error: '반려 사유를 입력해 주세요.' }, { status: 400 })
    }
    const entry = await markPayoutRejected(id, actor, reason)
    await recordAudit({
      kind: 'payout',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `payout-req:${id}`,
      reason,
      detail: `출금 신청 반려 · ${pending.applicantName}(${pending.role}) ${pending.amount.toFixed(7)}Pi`,
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, request: entry })
  }

  // 승인 — 플랫폼 지갑에서 신청 지갑으로 즉시 송금한다.
  const sent = await sendPiToAddress({
    recipient: pending.wallet,
    amount: pending.amount,
    memoText: 'TaxiTago 정산',
    reason: `${pending.role === 'partner' ? '파트너' : '기사'} 수익 출금 (${pending.applicantName})`,
    purpose: 'fee',
    sandbox: isPiSandboxRequest(request),
  })
  if (!sent.ok) {
    await markPayoutFailed(id, sent.error).catch(() => undefined)
    return NextResponse.json({ error: sent.error }, { status: sent.status })
  }
  const entry = await markPayoutApproved(id, actor, sent.txid)
  await recordAudit({
    kind: 'payout',
    actor: actor.staffId,
    actorName: actor.staffName,
    refId: `payout-req:${id}`,
    detail: `출금 신청 승인·송금 완료 · ${pending.applicantName}(${pending.role}) ${pending.amount.toFixed(7)}Pi → ${pending.wallet.slice(0, 12)}…`,
    after: { txid: sent.txid, amount: pending.amount },
  }).catch(() => undefined)
  return NextResponse.json({ ok: true, approved: true, txid: sent.txid, request: entry })
}
