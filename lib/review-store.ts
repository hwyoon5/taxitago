import type { QualityFlag, RatingProfile, ReviewRecord } from '@/lib/review-types'

type ReviewDb = {
  reviews: Map<string, ReviewRecord>
  byRide: Map<string, string[]>
  profiles: Map<string, RatingProfile>
  flags: QualityFlag[]
}

function db(): ReviewDb {
  const globalStore = globalThis as typeof globalThis & { __taxitagoReviews?: ReviewDb }
  if (!globalStore.__taxitagoReviews) {
    globalStore.__taxitagoReviews = {
      reviews: new Map(),
      byRide: new Map(),
      profiles: new Map(),
      flags: [],
    }
  }
  return globalStore.__taxitagoReviews
}

export function profileKey(userId: string, role: RatingProfile['role']) {
  return `${role}:${userId}`
}

export function saveReview(record: ReviewRecord) {
  const store = db()
  store.reviews.set(record.id, record)
  const ids = store.byRide.get(record.rideId) ?? []
  if (!ids.includes(record.id)) store.byRide.set(record.rideId, [...ids, record.id])
  return record
}

export function getReview(id: string) {
  return db().reviews.get(id) ?? null
}

export function listReviewsForRide(rideId: string) {
  const ids = db().byRide.get(rideId) ?? []
  return ids.map((id) => db().reviews.get(id)).filter((item): item is ReviewRecord => Boolean(item))
}

export function listReviewsForUser(userId: string) {
  return [...db().reviews.values()].filter((item) => item.toId === userId)
}

export function findRideReview(rideId: string, fromId: string) {
  return listReviewsForRide(rideId).find((item) => item.fromId === fromId) ?? null
}

export function getProfile(userId: string, role: RatingProfile['role']) {
  return db().profiles.get(profileKey(userId, role)) ?? null
}

export function saveProfile(profile: RatingProfile) {
  db().profiles.set(profileKey(profile.userId, profile.role), profile)
  return profile
}

export function addQualityFlag(flag: QualityFlag) {
  const store = db()
  store.flags = [flag, ...store.flags.filter((item) => !(item.userId === flag.userId && item.rideId === flag.rideId && item.kind === flag.kind))].slice(0, 300)
  return flag
}

export function listQualityFlags(filter?: { userId?: string; openOnly?: boolean }) {
  return db().flags.filter((flag) => {
    if (filter?.userId && flag.userId !== filter.userId) return false
    if (filter?.openOnly && flag.status !== 'open') return false
    return true
  })
}
