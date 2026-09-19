'use client'

import { useState } from 'react'
import { Check, Star, X } from 'lucide-react'
import { submitRideReview } from '@/lib/review-client'
import { DRIVER_REVIEW_TAGS, PASSENGER_REVIEW_TAGS, type RatingRole } from '@/lib/review-types'

const LABELS = ['', '아쉬워요', '보통이에요', '좋아요', '만족해요', '최고예요']

export type RideReviewTarget = {
  rideId: string
  raterId: string
  raterRole: RatingRole
  targetName: string
  vehicle?: string
  plate?: string
}

export default function RideReviewModal({
  target,
  onClose,
  onSubmitted,
}: {
  target: RideReviewTarget
  onClose: () => void
  onSubmitted?: (rating: number) => void
}) {
  const [rating, setRating] = useState(5)
  const [tags, setTags] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const ratingDriver = target.raterRole === 'passenger'
  const tagPool = ratingDriver ? DRIVER_REVIEW_TAGS : PASSENGER_REVIEW_TAGS
  const peerLabel = ratingDriver ? `${target.targetName} 기사님` : target.targetName

  const toggleTag = (tag: string) => {
    setTags((items) => (items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]))
  }

  const submit = () => {
    if (busy) return
    setBusy(true)
    void submitRideReview({
      rideId: target.rideId,
      fromId: target.raterId,
      fromRole: target.raterRole,
      rating,
      tags,
      comment,
    })
      .then(() => {
        setDone(true)
        window.setTimeout(() => onSubmitted?.(rating), 1200)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '평가 저장에 실패했어요.')
        setBusy(false)
      })
  }

  return (
    <div className="fixed inset-0 z-[99] flex items-end bg-[#1e1033]/55 p-0 sm:items-center sm:p-4">
      <section className="mx-auto max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-white p-5 shadow-2xl sm:rounded-[32px]">
        {done ? (
          <div className="py-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#4C1FB8] text-white">
              <Check className="h-8 w-8" strokeWidth={3} />
            </div>
            <h2 className="mt-4 text-2xl font-black text-[#0F172A]">평가가 반영되었습니다</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-[#475569]">평균 별점이 다시 계산되었고, 저조한 평점은 품질 모니터링에 올라갑니다.</p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-black text-[#4C1FB8]">{ratingDriver ? '운행 완료 · 기사 평가' : '운행 완료 · 승객 평가'}</p>
                <h2 className="mt-1 text-xl font-black leading-7 text-[#0F172A]">{ratingDriver ? '기사님과의 이동은 어떠셨나요?' : '승객분과의 운행은 어떠셨나요?'}</h2>
                <p className="mt-1 text-sm font-bold text-[#64748B]">1~5점과 피드백 태그를 남겨 주세요</p>
              </div>
              <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="닫기">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 flex items-center gap-3 rounded-[22px] border-2 border-[#E0D4FF] bg-[#F8F5FF] p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#4C1FB8] font-black text-white">{peerLabel.slice(0, 1)}</div>
              <div>
                <p className="font-black text-[#0F172A]">{peerLabel}</p>
                {target.vehicle ? (
                  <p className="mt-1 text-xs font-bold text-[#475569]">{target.vehicle}{target.plate ? ` · ${target.plate}` : ''}</p>
                ) : (
                  <p className="mt-1 text-xs font-bold text-[#475569]">상호 평가 · 실제 번호는 보이지 않습니다</p>
                )}
              </div>
            </div>
            <div className="mt-5 text-center">
              <p className="text-xs font-black text-[#334155]">평점 · 1점부터 5점</p>
              <div className="mt-2 flex justify-center gap-1.5">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRating(value)}
                    aria-label={`${value}점`}
                    className={`rounded-2xl p-1.5 transition ${value <= rating ? 'text-[#4C1FB8]' : 'text-[#D8CCF5]'}`}
                  >
                    <Star className="h-8 w-8" fill="currentColor" strokeWidth={0} />
                  </button>
                ))}
              </div>
              <p className="mt-2 text-sm font-black text-[#4C1FB8]">{rating}점 · {LABELS[rating]}</p>
            </div>
            <p className="mt-5 text-xs font-black text-[#334155]">피드백 태그 · 여러 개 선택 가능</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {tagPool.map((tag) => {
                const selected = tags.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full px-3 py-2 text-xs font-black ${selected ? 'bg-[#4C1FB8] text-white shadow-[0_8px_16px_rgba(76,31,184,0.28)]' : 'border border-[#D8CCF5] bg-[#F8F5FF] text-[#4C1FB8]'}`}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
            <label className="mt-4 block">
              <span className="text-xs font-black text-[#334155]">한줄 후기</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                placeholder={ratingDriver ? '기사님께 전하고 싶은 말을 남겨 주세요' : '승객께 전하고 싶은 말을 남겨 주세요'}
                className="mt-2 w-full resize-none rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] px-4 py-3 text-sm font-bold text-[#0F172A] outline-none focus:border-[#4C1FB8]"
              />
            </label>
            {error ? <p className="mt-2 text-center text-xs font-bold text-[#B91C1C]">{error}</p> : null}
            <button type="button" onClick={submit} disabled={busy} className="mt-4 w-full rounded-2xl bg-[#4C1FB8] py-4 text-base font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.35)] disabled:opacity-60">
              {busy ? '저장 중…' : '평가 제출'}
            </button>
          </>
        )}
      </section>
    </div>
  )
}
