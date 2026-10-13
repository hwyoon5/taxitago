import { NextResponse } from 'next/server'
import { broadcastsForAudience } from '@/lib/broadcast-store'
import { BROADCAST_REGION_KEYS, type BroadcastRegion } from '@/lib/broadcast-regions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 앱 공개 방송 목록 — audience=passenger(승객) / driver(기사) / partner(파트너), 레거시 staff=기사. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const audience = searchParams.get('audience')?.trim()
  const group = audience === 'driver' || audience === 'staff' ? 'driver' : audience === 'partner' ? 'partner' : 'passenger'
  const rawRegion = searchParams.get('region')?.trim() ?? ''
  const region = (BROADCAST_REGION_KEYS as string[]).includes(rawRegion) && rawRegion !== 'nation' ? (rawRegion as BroadcastRegion) : ''
  const entries = await broadcastsForAudience(group, region)
  return NextResponse.json({
    ok: true,
    broadcasts: entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      body: entry.body,
      target: entry.target,
      region: entry.region ?? 'nation',
      banner: entry.banner,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    })),
  })
}
