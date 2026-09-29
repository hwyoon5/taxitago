import { NextResponse } from 'next/server'
import { markRideProgress, toPublicRide } from '@/lib/dispatch-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { passengerId?: unknown; step?: unknown } | null
  const passengerId = typeof body?.passengerId === 'string' ? body.passengerId.trim() : ''
  const step = body?.step === 'boarded' || body?.step === 'arrived' ? body.step : null
  if (!passengerId || !step) return NextResponse.json({ error: 'passengerId and step required' }, { status: 400 })
  const result = markRideProgress(id, passengerId, step)
  if (!result.ok || !result.ride) {
    const error = result.error === 'not_boarded' ? '먼저 탑승을 확인해 주세요.' : result.error
    return NextResponse.json({ error }, { status: result.error === 'not_found' ? 404 : 409 })
  }
  return NextResponse.json({ ok: true, ride: toPublicRide(result.ride) })
}
