import { NextResponse } from 'next/server'
import { getFareConfig } from '@/lib/fare-config-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Public fare config — clients need base fares and cancel-fee policy for previews. */
export async function GET() {
  const fare = await getFareConfig()
  return NextResponse.json({ ok: true, fare })
}
