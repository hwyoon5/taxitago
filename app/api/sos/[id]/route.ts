import { NextResponse } from 'next/server'
import { getSos } from '@/lib/support-store'
import { updateSosStatus } from '@/lib/support-engine'
import type { SosStatus } from '@/lib/support-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const alert = getSos(id)
  if (!alert) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, alert })
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { status?: unknown } | null
  const status = body?.status
  if (status !== 'open' && status !== 'acked' && status !== 'resolved') {
    return NextResponse.json({ error: 'status required' }, { status: 400 })
  }
  const alert = updateSosStatus(id, status as SosStatus)
  if (!alert) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, alert })
}
