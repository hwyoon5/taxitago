import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 앱 내 사전 충전 잔액 결제는 폐지되었다 — 모든 서비스 요금은 이용 종료 시점에
 * Pi SDK 직결제(/api/pi/approve → /api/pi/complete → 정산)로 처리된다.
 * 이 라우트는 폐기 상태로 유지해 구버전 클라이언트에 명확한 안내를 돌려준다.
 * 기사/파트너 정산 출금은 /api/payout-requests 등 정산 계열 라우트가 담당한다.
 */
export async function POST() {
  return NextResponse.json(
    { ok: false, error: '앱 잔액 결제는 지원되지 않습니다. 서비스 이용 종료 시점에 Pi 결제로 바로 정산해 주세요.' },
    { status: 410 },
  )
}
