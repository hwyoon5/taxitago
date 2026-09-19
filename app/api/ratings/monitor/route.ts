import { NextResponse } from 'next/server'
import { qualityMonitor } from '@/lib/review-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ ok: true, monitor: qualityMonitor() })
}
