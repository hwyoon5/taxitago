import { NextResponse } from 'next/server'
import { getPublicRide } from '@/lib/dispatch-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const ride = getPublicRide(id)
  if (!ride) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, ride })
}
