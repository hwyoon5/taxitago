import { NextResponse } from 'next/server'
import { markRideProgress, toPublicRide } from '@/lib/dispatch-engine'
import { hydrateDispatchFromKv } from '@/lib/dispatch-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as {
    passengerId?: unknown
    step?: unknown
    ride?: {
      pickup?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }
      dest?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }
      estimatedFare?: unknown
      kind?: unknown
      boardedAt?: unknown
      driverId?: unknown
    }
  } | null
  const passengerId = typeof body?.passengerId === 'string' ? body.passengerId.trim() : ''
  const step = body?.step === 'boarded' || body?.step === 'arrived' ? body.step : null
  if (!passengerId || !step) return NextResponse.json({ error: 'passengerId and step required' }, { status: 400 })
  await hydrateDispatchFromKv()
  const point = (value: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown } | undefined) => {
    const lat = Number(value?.lat)
    const lng = Number(value?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined
    return {
      lat,
      lng,
      address: typeof value?.address === 'string' ? value.address : undefined,
      label: typeof value?.label === 'string' ? value.label : undefined,
    }
  }
  const snapshot = body?.ride
  const result = markRideProgress(id, passengerId, step, {
    pickup: point(snapshot?.pickup),
    dest: point(snapshot?.dest),
    estimatedFare: typeof snapshot?.estimatedFare === 'number' ? snapshot.estimatedFare : undefined,
    kind: snapshot?.kind === 'daeri' ? 'daeri' : 'taxi',
    boardedAt: typeof snapshot?.boardedAt === 'string' ? snapshot.boardedAt : null,
    driverId: typeof snapshot?.driverId === 'string' ? snapshot.driverId : null,
  })
  if (!result.ok || !result.ride) {
    const error = result.error === 'not_boarded' ? '먼저 탑승을 확인해 주세요.' : result.error
    return NextResponse.json({ error }, { status: result.error === 'not_found' ? 404 : 409 })
  }
  return NextResponse.json({ ok: true, ride: toPublicRide(result.ride) })
}
