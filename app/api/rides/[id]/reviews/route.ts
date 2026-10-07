import { NextResponse } from 'next/server'
import { hydrateDispatchFromKv, syncDispatchFromDisk } from '@/lib/dispatch-store'
import { rideReviews, submitRideReview } from '@/lib/review-engine'
import { recordWalletTx, REVIEW_REWARD_PI } from '@/lib/wallet-history'
import { isPiSandboxEnv } from '@/lib/pi-sandbox'
import type { RatingRole } from '@/lib/review-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  await hydrateDispatchFromKv()
  return NextResponse.json({ ok: true, reviews: rideReviews(id) })
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  syncDispatchFromDisk()
  await hydrateDispatchFromKv()
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const fromId = typeof body?.fromId === 'string' ? body.fromId.trim() : ''
  const fromRole = body?.fromRole === 'driver' || body?.fromRole === 'passenger' ? (body.fromRole as RatingRole) : null
  const rating = typeof body?.rating === 'number' ? body.rating : Number(body?.rating)
  if (!fromId || !fromRole || !Number.isFinite(rating)) {
    return NextResponse.json({ error: 'fromId, fromRole, rating required' }, { status: 400 })
  }
  const result = submitRideReview({
    rideId: id,
    fromId,
    fromRole,
    rating,
    tags: Array.isArray(body?.tags) ? body.tags.filter((item): item is string => typeof item === 'string') : [],
    comment: typeof body?.comment === 'string' ? body.comment : '',
  })
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'already_reviewed' ? 409 : 400
    return NextResponse.json({ error: result.error, review: result.review }, { status })
  }
  // 탑승자 리뷰가 실제로 접수된 시점에 감사 포인트 지급을 장부에 기록한다.
  // 클라이언트 별도 호출에만 의존하면 요청이 유실될 때 지출이 0으로 남는다.
  // (kind, txid) 멱등이라 클라이언트의 보조 기록 호출과 중복되지 않는다.
  if (fromRole === 'passenger') {
    await recordWalletTx({
      kind: 'reward',
      txid: `review:${id}:${fromId}`,
      fromWallet: 'TaxiTago 리워드',
      toWallet: fromId,
      amount: REVIEW_REWARD_PI,
      memo: '리뷰 감사 포인트',
      status: 'confirmed',
      network: isPiSandboxEnv() ? 'testnet' : 'mainnet',
    }).catch(() => undefined)
  }
  return NextResponse.json({ ok: true, review: result.review, rating: result.rating })
}
