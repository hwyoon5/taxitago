import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Pi 개발자 포털 도메인 인증 키.
 * 포털에 등록된 값과 byte 단위로 동일해야 한다 — 리다이렉트·변형 없이
 * text/plain으로 그대로 내려보낸다.
 */
const MAINNET_VALIDATION_KEY =
  '20c4eeae564a9cea37284830e5e69624b5bc032e80ec163ccffd1b4ebd65c1bfb849508d6ded35afc3c70f0b5cd608105cf07a71a1e1b9cbb7b9971c568874dc'
const TESTNET_VALIDATION_KEY =
  '2d1fa67d40dd05dc60b6e98c533abe2c924963aa22709e24de8020575c1c4479c2d23dbcaad8d8df8a4b727dcbb9b684112ec08ce2a08093f6072c36e039e3e3'

export function GET(request: Request) {
  const host = (
    request.headers.get('x-forwarded-host') ??
    request.headers.get('host') ??
    ''
  )
    .split(':')[0]
    .toLowerCase()
  const url = new URL(request.url)
  const isTestnet =
    host === 'test.taxitago.co.kr' ||
    host.startsWith('test.') ||
    url.searchParams.get('pi_network') === 'testnet'
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
