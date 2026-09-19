export type RatingRole = 'passenger' | 'driver'

export type ReviewRecord = {
  id: string
  rideId: string
  fromId: string
  fromRole: RatingRole
  toId: string
  toRole: RatingRole
  rating: number
  tags: string[]
  comment: string
  createdAt: string
}

export type RatingProfile = {
  userId: string
  role: RatingRole
  average: number
  count: number
  lastRatings: number[]
  lowCount: number
  updatedAt: string
}

export type QualityFlagKind = 'low_rating' | 'repeat_low' | 'watchlist'

export type QualityFlag = {
  id: string
  userId: string
  role: RatingRole
  kind: QualityFlagKind
  rideId: string
  rating: number
  average: number
  note: string
  status: 'open' | 'acked'
  createdAt: string
}

export type PublicRating = {
  userId: string
  role: RatingRole
  average: number
  count: number
  flagged: boolean
  openFlags: number
}

export const DRIVER_REVIEW_TAGS = ['친절해요', '응대가 부드러워요', '설명이 명확해요', '배려가 좋아요', '운전이 안전해요', '차가 깨끗해요']
export const PASSENGER_REVIEW_TAGS = ['약속 시간을 지켜요', '승하차가 빨라요', '매너가 좋아요', '목적지가 명확해요', '정리가 잘 돼요']
export const LOW_RATING_THRESHOLD = 2
export const WATCHLIST_AVERAGE = 3.5
export const REPEAT_LOW_COUNT = 3
