import { NextResponse } from 'next/server'
import { flushDispatchPersist, getRide, hydrateDispatchFromKv, saveRide, syncDispatchFromDisk } from '@/lib/dispatch-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 안심귀가 공유 링크 발급 — 승객 본인만 생성할 수 있다.
 * 토큰은 라이드 레코드에 붙어 `/track/<token>` 공개 페이지가 읽는다.
 * 같은 콜에 재요청하면 기존 토큰을 돌려줘 지인에게 보낸 링크가 유지된다.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { passengerId?: string } | null
  const passengerId = typeof body?.passengerId === 'string' ? body.passengerId.trim() : ''
  if (!passengerId) return NextResponse.json({ error: 'passengerId required' }, { status: 400 })
  syncDispatchFromDisk()
  await hydrateDispatchFromKv()
  const ride = getRide(id)
  if (!ride) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (ride.passengerId !== passengerId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!ride.shareToken) {
    ride.shareToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8)
    saveRide(ride)
    await flushDispatchPersist().catch(() => undefined)
  }
  return NextResponse.json({ ok: true, token: ride.shareToken, url: `/track/${ride.shareToken}` })
}
