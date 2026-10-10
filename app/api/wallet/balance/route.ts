import { NextResponse } from 'next/server'
import { fetchOnchainPiBalance } from '@/lib/pi-balance'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'
import { isPiWalletAddress } from '@/lib/pi-wallet'
import { userSpendableBalance, walletsForUid } from '@/lib/user-credit-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 지갑 잔액 조회 — ?wallet=G… (또는 ?uid= 로 연동 지갑 해석), &sandbox= 힌트.
 * onchain: Pi 공식 Horizon의 실제 native 잔액(메인넷이어도 임의 생성 없음).
 * spendable: 서버 장부(입금 크레딧−지출)의 사용 가능 잔액 — 둘을 분리해
 * 프론트가 온체인 값과 앱 내 잔액을 구분해 표시할 수 있다.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  let wallet = (params.get('wallet') || '').trim()
  const uid = (params.get('uid') || '').trim()
  const sandboxParam = (params.get('sandbox') || '').trim().toLowerCase()
  const sandboxHint = sandboxParam === 'true' ? true : sandboxParam === 'false' ? false : null
  const sandbox = isPiSandboxRequest(request, sandboxHint)

  if (!isPiWalletAddress(wallet) && uid) {
    const linked = await walletsForUid(uid).catch(() => new Set<string>())
    wallet = [...linked][0] || ''
  }
  if (!isPiWalletAddress(wallet)) {
    return NextResponse.json({ error: 'valid wallet required' }, { status: 400 })
  }

  const [onchain, spendable] = await Promise.all([
    fetchOnchainPiBalance(wallet, { sandbox }),
    userSpendableBalance(wallet, uid).catch(() => null),
  ])
  return NextResponse.json({
    ok: true,
    network: onchain.network,
    wallet,
    onchain,
    spendable,
  })
}
