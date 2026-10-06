import { NextResponse } from 'next/server'
import { getFareConfig } from '@/lib/fare-config-server'
import { getAdminWallet } from '@/lib/admin-wallet'
import { isPiWalletAddress } from '@/lib/pi-wallet'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Public fare config — clients need base fares and cancel-fee policy for previews. */
export async function GET() {
  const [fare, adminWallet] = await Promise.all([getFareConfig(), getAdminWallet()])
  // 플랫폼 공식 입금 수신지 — 등록된 Pi 주소(G+55자)만 공개하고 데모 플레이스홀더는 숨긴다.
  const depositWallet = isPiWalletAddress(adminWallet) ? adminWallet.trim() : ''
  return NextResponse.json({ ok: true, fare, depositWallet })
}
