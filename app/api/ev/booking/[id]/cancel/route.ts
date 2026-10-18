import { NextResponse } from 'next/server'
import { cancelEvBooking } from '@/lib/ev-booking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 예약 취소 — 이용자 본인만 가능, 취소 즉시 대기열이 승격된다. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as { userId?: string } | null
  const result = cancelEvBooking(id, { userId: body?.userId || '' })
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === 'not_found' ? 404 : result.error === 'forbidden' ? 403 : 409 },
    )
  }
  return NextResponse.json({ ok: true, booking: result.booking })
}
