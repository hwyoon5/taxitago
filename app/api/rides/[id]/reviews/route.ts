import { NextResponse } from 'next/server'
import { rideReviews, submitRideReview } from '@/lib/review-engine'
import type { RatingRole } from '@/lib/review-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return NextResponse.json({ ok: true, reviews: rideReviews(id) })
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const fromId = typeof body?.fromId === 'string' ? body.fromId.trim() : ''
  const fromRole = body?.fromRole === 'driver' || body?.fromRole === 'passenger' ? (body.fromRole as RatingRole) : null
  const rating = typeof body?.rating === 'number' ? body.rating : Number(body?.rating)
  if (!fromId || !fromRole || !Number.isFinite(rating)) {
    return NextResponse.json({ error: 'fromId, fromRole, rating required' }, { status: 400 })
  }
  const result = submitRideReview({
    rideId: id,
    fromId,
    fromRole,
    rating,
    tags: Array.isArray(body?.tags) ? body.tags.filter((item): item is string => typeof item === 'string') : [],
    comment: typeof body?.comment === 'string' ? body.comment : '',
  })
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : result.error === 'already_reviewed' ? 409 : 400
    return NextResponse.json({ error: result.error, review: result.review }, { status })
  }
  return NextResponse.json({ ok: true, review: result.review, rating: result.rating })
}
