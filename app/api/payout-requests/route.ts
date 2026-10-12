import { NextResponse } from 'next/server'
import { driverEarningsStats, driverPayoutTarget } from '@/lib/escrow-engine'
import { hydrateDispatchFromKv } from '@/lib/dispatch-store'
import { hydrateEscrowFromKv } from '@/lib/escrow-store'
import { piRound } from '@/lib/pi-format'
import { heldPayoutTotal, listPayoutRequestsFor, queuePayoutRequest } from '@/lib/payout-request-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PAYOUT_PI = 10_000

function idsFrom(request: Request, body?: Record<string, unknown> | null) {
  if (body) {
    const id = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
    const aliases = Array.isArray(body?.altDriverId)
      ? (body.altDriverId as unknown[]).map((v) => String(v).trim()).filter((v) => v && v !== id)
      : []
    return { id, aliases }
  }
  const params = new URL(request.url).searchParams
  const id = params.get('driverId')?.trim() || ''
  const aliases = params.getAll('altDriverId').map((v) => v.trim()).filter((v) => v && v !== id)
  return { id, aliases }
}

/** 출금 가능 수익 = 누적 정산 수익 − 대기/승인된 신청 홀드. */
async function availableFor(ids: string[]) {
  if (!ids.length) return { earned: 0, held: 0, available: 0 }
  await Promise.all([hydrateDispatchFromKv().catch(() => undefined), hydrateEscrowFromKv().catch(() => undefined)])
  const stats = await driverEarningsStats(ids[0], ids.slice(1)).catch(() => null)
  const earned = stats?.total?.[0]?.amount ?? 0
  const held = await heldPayoutTotal(ids)
  return { earned, held, available: Math.max(0, piRound(earned - held)) }
}

export async function GET(request: Request) {
  const { id, aliases } = idsFrom(request)
  if (!id) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  const ids = [id, ...aliases]
  const [requests, balance] = await Promise.all([listPayoutRequestsFor(ids), availableFor(ids)])
  return NextResponse.json({ ok: true, requests, ...balance })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const { id, aliases } = idsFrom(request, body)
  if (!id) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  const amount = piRound(Number(body?.amount))
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYOUT_PI) {
    return NextResponse.json({ error: `출금 금액은 0보다 크고 ${MAX_PAYOUT_PI.toLocaleString('ko-KR')} Pi 이하여야 합니다.` }, { status: 400 })
  }
  const target = driverPayoutTarget(id)
  const wallet = (typeof body?.wallet === 'string' ? body.wallet.trim() : '') || target.wallet
  if (!wallet) {
    return NextResponse.json({ error: '정산 받을 지갑 주소를 입력해 주세요.' }, { status: 400 })
  }
  const role = body?.role === 'partner' ? 'partner' : 'driver'
  const name = (typeof body?.name === 'string' ? body.name.trim() : '') || target.name
  const memo = typeof body?.memo === 'string' ? body.memo.trim().slice(0, 60) : ''
  const balance = await availableFor([id, ...aliases])
  if (amount > balance.available) {
    return NextResponse.json(
      { error: `출금 가능 수익(${balance.available.toFixed(7)} Pi)을 초과하는 금액입니다.` },
      { status: 400 },
    )
  }
  const entry = await queuePayoutRequest({
    role,
    applicantId: id,
    aliasIds: aliases,
    applicantName: name,
    amount,
    wallet,
    memo,
  })
  return NextResponse.json({ ok: true, request: entry, ...balance, available: Math.max(0, piRound(balance.available - amount)) })
}
