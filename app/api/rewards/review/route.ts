import { NextResponse } from 'next/server'
import { recordWalletTx, REVIEW_REWARD_PI } from '@/lib/wallet-history'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 리뷰 감사 마일리지 지급 일시 중단 스위치 — 클라이언트 REVIEW_REWARD_ENABLED와 짝. 재개 시 true로. */
const REVIEW_REWARD_ENABLED = false

// 리뷰 감사 마일리지 지급을 관리자 장부에 비용(reward)으로 기록한다.
// key가 있으면 (kind, txid) 멱등으로 중복 기록을 막는다.
export async function POST(request: Request) {
  if (!REVIEW_REWARD_ENABLED) {
    return NextResponse.json({ ok: true, disabled: true, message: '리뷰 감사 마일리지 지급이 일시 중단되었습니다.' })
  }
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
    memo: '리뷰 감사 마일리지',
    status: 'confirmed',
    network: isPiSandboxRequest(request) ? 'testnet' : 'mainnet',
  })
  return NextResponse.json({ ok: true, reward: entry })
}
