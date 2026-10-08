import { NextResponse } from 'next/server'
import { recordWalletTx, REVIEW_REWARD_PI } from '@/lib/wallet-history'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 리뷰 감사 포인트 지급을 관리자 장부에 비용(reward)으로 기록한다.
// key가 있으면 (kind, txid) 멱등으로 중복 기록을 막는다.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const dedupeKey = typeof body?.key === 'string' && body.key.trim() ? `review:${body.key.trim()}:${userId}` : ''
  const entry = await recordWalletTx({
    kind: 'reward',
    txid: dedupeKey,
    fromWallet: 'TaxiTago 리워드',
    toWallet: userId,
    amount: REVIEW_REWARD_PI,
    memo: '리뷰 감사 포인트',
    status: 'confirmed',
    network: isPiSandboxRequest(request) ? 'testnet' : 'mainnet',
  })
  return NextResponse.json({ ok: true, reward: entry })
}
