import { NextResponse } from 'next/server'
import { getDeliveryDispatch, publicDelivery } from '@/lib/delivery-dispatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const job = getDeliveryDispatch(id)
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, job: publicDelivery(job) })
}
