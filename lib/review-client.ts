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
  const post = () =>
    apiFetch(`/api/rides/${encodeURIComponent(input.rideId)}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  let res = await post()
  let data = await readJson<{ review?: ReviewRecord; rating?: PublicRating; error?: string }>(res)
  for (const delay of [700, 1400]) {
    if (res.ok || data.error !== 'not_found') break
    await new Promise((resolve) => setTimeout(resolve, delay))
    res = await post()
    data = await readJson<{ review?: ReviewRecord; rating?: PublicRating; error?: string }>(res)
  }
  if (!res.ok) {
    const message =
      data.error === 'already_reviewed'
        ? '이미 이 운행을 평가했어요.'
        : data.error === 'not_found'
          ? '운행 정보를 아직 동기화하지 못했어요. 잠시 후 다시 시도해 주세요.'
          : data.error === 'not_completed'
            ? '운행이 아직 완료되지 않았어요.'
            : data.error === 'forbidden'
              ? '이 운행의 탑승자만 평가할 수 있어요.'
              : data.error || '리뷰 저장에 실패했어요.'
    throw new Error(message)
  }
  return data
}

export async function fetchUserRating(userId: string, role: RatingRole) {
  const res = await apiFetch(`/api/ratings/${encodeURIComponent(userId)}?role=${role}`, { cache: 'no-store' })
  const data = await readJson<{ rating?: PublicRating }>(res)
  return data.rating ?? null
}

/** 리뷰 감사 포인트 지급을 관리자 장부에 기록한다. 실패해도 사용자 흐름은 막지 않는다. */
export async function recordReviewReward(userId: string, key?: string) {
  try {
    await apiFetch('/api/rewards/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, key }),
    })
  } catch {
    undefined
  }
}
