import { NextResponse } from 'next/server'
import { cancelRide, toPublicRide } from '@/lib/dispatch-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { passengerId?: unknown } | null
  const passengerId = typeof body?.passengerId === 'string' ? body.passengerId : undefined
  const ride = cancelRide(id, passengerId)
  if (!ride) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, ride: toPublicRide(ride) })
}
