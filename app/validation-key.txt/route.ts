import { NextResponse } from 'next/server'
import { resolvePiSandbox } from '@/lib/pi-sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Pi 개발자 포털 도메인 인증 키.
 * 포털에 등록된 값과 byte 단위로 동일해야 한다 — 리다이렉트·변형 없이
 * text/plain으로 그대로 내려보낸다.
 * 앱을 새로 만들면 포털이 새 검증 키를 발급한다 — 포털 Checklist > App
 * Domain에 표시된 값을 PI_VALIDATION_KEY_TESTNET/PI_VALIDATION_KEY_MAINNET
 * env로 주입하면 코드 수정 없이 교체된다(env가 없으면 아래 기존 값 사용).
 */
const MAINNET_VALIDATION_KEY =
  (process.env.PI_VALIDATION_KEY_MAINNET || '').trim() ||
  '20c4eeae564a9cea37284830e5e69624b5bc032e80ec163ccffd1b4ebd65c1bfb849508d6ded35afc3c70f0b5cd608105cf07a71a1e1b9cbb7b9971c568874dc'
const TESTNET_VALIDATION_KEY =
  (process.env.PI_VALIDATION_KEY_TESTNET || '').trim() ||
  '419256b525bd05773e27cb47259a3e10f68db14c28fcdbebb4b5e05c5aa17a761ee897c50bb0d33836a605fce058d386bde7048db478fd75da3cd1c168c8c610'

export function GET(request: Request) {
  const host = (
    request.headers.get('x-forwarded-host') ??
    request.headers.get('host') ??
    ''
  )
    .split(':')[0]
    .toLowerCase()
  const url = new URL(request.url)
  // ?pi_network=testnet|mainnet 힌트가 최우선 — 없으면 공용 resolver가
  // host(테스트 도메인 강제) → env(NEXT_PUBLIC_PI_SANDBOX 체인) → 기본값으로
  // 판정한다. SDK가 init하는 네트워크와 같은 규칙이라 어느 배포에서든
  // 실제 앱 네트워크의 검증 키가 내려간다.
  const networkParam = url.searchParams.get('pi_network')
  const isTestnet = resolvePiSandbox({
    hint: networkParam === 'testnet' ? true : networkParam === 'mainnet' ? false : null,
    host,
  })
  const key = isTestnet ? TESTNET_VALIDATION_KEY : MAINNET_VALIDATION_KEY
  return new NextResponse(key, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'CDN-Cache-Control': 'no-store, max-age=0',
      'Vercel-CDN-Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
