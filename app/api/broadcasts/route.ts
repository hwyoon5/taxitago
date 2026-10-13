import { NextResponse } from 'next/server'
import { broadcastsForAudience } from '@/lib/broadcast-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 앱 공개 방송 목록 — audience=passenger(승객) / staff(기사·파트너). */
export async function GET(request: Request) {
  const audience = new URL(request.url).searchParams.get('audience')?.trim()
  const group = audience === 'staff' || audience === 'driver' || audience === 'partner' ? 'staff' : 'passenger'
  const entries = await broadcastsForAudience(group)
  return NextResponse.json({
    ok: true,
    broadcasts: entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      body: entry.body,
      target: entry.target,
      banner: entry.banner,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    })),
  })
}
