import { NextResponse } from 'next/server'

const PI_MAINNET_VALIDATION_KEY =
  '20c4eeae564a9cea37284830e5e69624b5bc032e80ec163ccffd1b4ebd65c1bfb849508d6ded35afc3c70f0b5cd608105cf07a71a1e1b9cbb7b9971c568874dc'

export function GET() {
  return new NextResponse(PI_MAINNET_VALIDATION_KEY, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
