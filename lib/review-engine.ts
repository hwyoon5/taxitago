import { getDriver, getRide, nowIso, saveDriver } from '@/lib/dispatch-store'
import {
  addQualityFlag,
  findRideReview,
  getProfile,
  listQualityFlags,
  listReviewsForRide,
  listReviewsForUser,
  saveProfile,
  saveReview,
} from '@/lib/review-store'
import {
  LOW_RATING_THRESHOLD,
  REPEAT_LOW_COUNT,
  WATCHLIST_AVERAGE,
  type PublicRating,
  type QualityFlag,
  type RatingProfile,
  type RatingRole,
  type ReviewRecord,
} from '@/lib/review-types'

function clampRating(value: number) {
  const n = Math.round(value)
  return Math.min(5, Math.max(1, n))
}

function emptyProfile(userId: string, role: RatingRole): RatingProfile {
  return {
    userId,
    role,
    average: 5,
    count: 0,
    lastRatings: [],
    lowCount: 0,
    updatedAt: nowIso(),
  }
}

function toPublic(profile: RatingProfile, flags: QualityFlag[]): PublicRating {
  return {
    userId: profile.userId,
    role: profile.role,
    average: profile.average,
    count: profile.count,
    flagged: flags.some((flag) => flag.status === 'open'),
    openFlags: flags.filter((flag) => flag.status === 'open').length,
  }
}

export function recomputeRating(userId: string, role: RatingRole) {
  const reviews = listReviewsForUser(userId)
    .filter((item) => item.toRole === role)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const current = getProfile(userId, role) ?? emptyProfile(userId, role)
  if (reviews.length === 0) return saveProfile(current)
  const sum = reviews.reduce((total, item) => total + item.rating, 0)
  const lastRatings = reviews.slice(0, 12).map((item) => item.rating)
  const profile = saveProfile({
    userId,
    role,
    average: Math.round((sum / reviews.length) * 100) / 100,
    count: reviews.length,
    lastRatings,
    lowCount: reviews.filter((item) => item.rating <= LOW_RATING_THRESHOLD).length,
    updatedAt: nowIso(),
  })
  if (role === 'driver') {
    const driver = getDriver(userId)
    if (driver) saveDriver({ ...driver, rating: profile.average.toFixed(2) })
  }
  return profile
}

function raiseFlags(review: ReviewRecord, profile: RatingProfile) {
  const flags: QualityFlag[] = []
  if (review.rating <= LOW_RATING_THRESHOLD) {
    flags.push({
      id: crypto.randomUUID(),
      userId: review.toId,
      role: review.toRole,
      kind: 'low_rating',
      rideId: review.rideId,
      rating: review.rating,
      average: profile.average,
      note: `${review.rating}점 리뷰 · 품질 점검 필요`,
      status: 'open',
      createdAt: nowIso(),
    })
  }
  const recentLow = profile.lastRatings.slice(0, REPEAT_LOW_COUNT)
  if (recentLow.length >= REPEAT_LOW_COUNT && recentLow.every((score) => score <= 3)) {
    flags.push({
      id: crypto.randomUUID(),
      userId: review.toId,
      role: review.toRole,
      kind: 'repeat_low',
      rideId: review.rideId,
      rating: review.rating,
      average: profile.average,
      note: `최근 ${REPEAT_LOW_COUNT}건이 3점 이하`,
      status: 'open',
      createdAt: nowIso(),
    })
  }
  if (profile.count >= 5 && profile.average < WATCHLIST_AVERAGE) {
    flags.push({
      id: crypto.randomUUID(),
      userId: review.toId,
      role: review.toRole,
      kind: 'watchlist',
      rideId: review.rideId,
      rating: review.rating,
      average: profile.average,
      note: `평균 ${profile.average.toFixed(2)}점 · 관찰 대상`,
      status: 'open',
      createdAt: nowIso(),
    })
  }
  flags.forEach(addQualityFlag)
  return flags
}

export function submitRideReview(input: {
  rideId: string
  fromId: string
  fromRole: RatingRole
  rating: number
  tags?: string[]
  comment?: string
}) {
  const ride = getRide(input.rideId)
  if (!ride) return { ok: false as const, error: 'not_found', review: null as ReviewRecord | null }
  if (ride.status !== 'completed') return { ok: false as const, error: 'not_completed', review: null }
  if (input.fromRole === 'passenger' && ride.passengerId !== input.fromId) {
    return { ok: false as const, error: 'forbidden', review: null }
  }
  if (input.fromRole === 'driver' && ride.assignedDriverId !== input.fromId) {
    return { ok: false as const, error: 'forbidden', review: null }
  }
  if (findRideReview(input.rideId, input.fromId)) {
    return { ok: false as const, error: 'already_reviewed', review: findRideReview(input.rideId, input.fromId) }
  }
  const toId = input.fromRole === 'passenger' ? ride.assignedDriverId : ride.passengerId
  const toRole: RatingRole = input.fromRole === 'passenger' ? 'driver' : 'passenger'
  if (!toId) return { ok: false as const, error: 'no_peer', review: null }

  const review = saveReview({
    id: crypto.randomUUID(),
    rideId: input.rideId,
    fromId: input.fromId,
    fromRole: input.fromRole,
    toId,
    toRole,
    rating: clampRating(input.rating),
    tags: (input.tags ?? []).slice(0, 6),
    comment: (input.comment ?? '').trim().slice(0, 300),
    createdAt: nowIso(),
  })
  const profile = recomputeRating(toId, toRole)
  raiseFlags(review, profile)
  return {
    ok: true as const,
    review,
    rating: toPublic(profile, listQualityFlags({ userId: toId, openOnly: true })),
  }
}

export function rideReviews(rideId: string) {
  return listReviewsForRide(rideId)
}

export function userRating(userId: string, role: RatingRole): PublicRating {
  const profile = recomputeRating(userId, role)
  return toPublic(profile, listQualityFlags({ userId, openOnly: true }))
}

export function qualityMonitor() {
  const flags = listQualityFlags({ openOnly: true })
  const byUser = new Map<string, { userId: string; role: RatingRole; average: number; openFlags: number; kinds: string[] }>()
  for (const flag of flags) {
    const profile = getProfile(flag.userId, flag.role) ?? emptyProfile(flag.userId, flag.role)
    const current = byUser.get(`${flag.role}:${flag.userId}`) ?? {
      userId: flag.userId,
      role: flag.role,
      average: profile.average,
      openFlags: 0,
      kinds: [],
    }
    current.openFlags += 1
    if (!current.kinds.includes(flag.kind)) current.kinds.push(flag.kind)
    byUser.set(`${flag.role}:${flag.userId}`, current)
  }
  return {
    threshold: LOW_RATING_THRESHOLD,
    watchlistAverage: WATCHLIST_AVERAGE,
    openFlags: flags,
    watchlist: [...byUser.values()].sort((a, b) => a.average - b.average),
  }
}
