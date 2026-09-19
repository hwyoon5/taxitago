import { NextResponse } from 'next/server'
import { userRating } from '@/lib/review-engine'
import type { RatingRole } from '@/lib/review-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params
  const roleParam = new URL(request.url).searchParams.get('role')
  const role: RatingRole = roleParam === 'passenger' ? 'passenger' : 'driver'
  if (!userId.trim()) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  return NextResponse.json({ ok: true, rating: userRating(userId, role) })
}
