import { NextResponse } from 'next/server'
import { confirmMatchOnDevice, respondToOffer, toPublicRide } from '@/lib/dispatch-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as {
    driverId?: unknown
    action?: unknown
    ride?: {
      passengerId?: unknown
      pickup?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }
      dest?: { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }
      estimatedFare?: unknown
      kind?: unknown
    }
  } | null
  const action = body?.action === 'accept' || body?.action === 'reject' || body?.action === 'device-accept' ? body.action : null
  if (!action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 })
  }
  if (action === 'device-accept') {
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
    const result = confirmMatchOnDevice(id, {
      passengerId: typeof body?.ride?.passengerId === 'string' ? body.ride.passengerId : undefined,
      pickup: point(body?.ride?.pickup),
      dest: point(body?.ride?.dest),
      estimatedFare: typeof body?.ride?.estimatedFare === 'number' ? body.ride.estimatedFare : undefined,
      kind: body?.ride?.kind === 'daeri' ? 'daeri' : 'taxi',
    })
    if (!result.ride) return NextResponse.json({ error: result.error }, { status: 404 })
    if (!result.ok) return NextResponse.json({ error: result.error, ride: toPublicRide(result.ride) }, { status: 409 })
    return NextResponse.json({ ok: true, ride: toPublicRide(result.ride) })
  }
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  if (!driverId) {
    return NextResponse.json({ error: 'driverId and action required' }, { status: 400 })
  }
  const result = respondToOffer(id, driverId, action)
  if (!result.ride) return NextResponse.json({ error: result.error }, { status: 404 })
  if (!result.ok) return NextResponse.json({ error: result.error, ride: toPublicRide(result.ride) }, { status: 409 })
  return NextResponse.json({ ok: true, ride: toPublicRide(result.ride) })
}
