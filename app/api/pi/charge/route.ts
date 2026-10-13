import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 사전 충전(잔액 충전)은 폐지되었다 — 이용 종료 시점 Pi SDK 직결제로 전환.
 * 이 라우트는 폐기 상태로 유지해 구버전 클라이언트에 명확한 안내를 돌려준다.
 */
export async function POST() {
  return NextResponse.json(
    { ok: false, error: '사전 충전은 지원되지 않습니다. 서비스 이용 종료 시점에 Pi 결제로 바로 정산해 주세요.' },
    { status: 410 },
  )
}
