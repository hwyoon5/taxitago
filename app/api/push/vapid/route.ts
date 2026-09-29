import { NextResponse } from 'next/server'
import { getVapidPublicKey } from '@/lib/driver-push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const publicKey = getVapidPublicKey()
  if (!publicKey) return NextResponse.json({ error: 'push unavailable' }, { status: 503 })
  return NextResponse.json({ publicKey })
}
