import { NextResponse } from 'next/server'
import { partnerInsights } from '@/lib/partner-insights'
import { hydrateDispatchFromKv } from '@/lib/dispatch-store'
import { hydrateEscrowFromKv } from '@/lib/escrow-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/drivers/insights?driverId=<id>&altDriverId=<id>&days=30
 * 파트너(택시·대리 기사, 택배 배송원, EV 충전 파트너)의 수익·인사이트 집계.
 * 조회 장부는 현재 네트워크 스코프(testnet/mainnet)로 한정된다.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const driverId = params.get('driverId')?.trim() || ''
  if (!driverId) return NextResponse.json({ error: 'driverId required' }, { status: 400 })
  const aliases = params.getAll('altDriverId').map((id) => id.trim()).filter((id) => id && id !== driverId)
  const days = Number.parseInt(params.get('days') || '30', 10)
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv()])
  const insights = await partnerInsights(driverId, aliases, days)
  return NextResponse.json({ ok: true, insights })
}
