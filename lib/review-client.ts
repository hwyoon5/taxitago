import { apiFetch } from '@/lib/app-origin'
import type { PublicRating, RatingRole, ReviewRecord } from '@/lib/review-types'

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

export async function submitRideReview(input: {
  rideId: string
  fromId: string
  fromRole: RatingRole
  rating: number
  tags: string[]
  comment: string
}) {
  const res = await apiFetch(`/api/rides/${encodeURIComponent(input.rideId)}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await readJson<{ review?: ReviewRecord; rating?: PublicRating; error?: string }>(res)
  if (!res.ok) throw new Error(data.error === 'already_reviewed' ? '이미 이 운행을 평가했어요.' : data.error || '리뷰 저장에 실패했어요.')
  return data
}

export async function fetchUserRating(userId: string, role: RatingRole) {
  const res = await apiFetch(`/api/ratings/${encodeURIComponent(userId)}?role=${role}`, { cache: 'no-store' })
  const data = await readJson<{ rating?: PublicRating }>(res)
  return data.rating ?? null
}
