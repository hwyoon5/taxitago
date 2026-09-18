import { NextResponse } from 'next/server'

const PI_TESTNET_VALIDATION_KEY =
  '2d1fa67d40dd05dc60b6e98c533abe2c924963aa22709e24de8020575c1c4479c2d23dbcaad8d8df8a4b727dcbb9b684112ec08ce2a08093f6072c36e039e3e3'

export function GET() {
  return new NextResponse(PI_TESTNET_VALIDATION_KEY, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
