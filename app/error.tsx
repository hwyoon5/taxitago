'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-base font-semibold text-[#0f172a]">일시적인 오류가 발생했습니다</p>
      <p className="text-sm text-slate-500">문제가 자동으로 기록되었습니다. 잠시 후 다시 시도해 주세요.</p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-2 rounded-full bg-[#4A82B8] px-5 py-2 text-sm font-semibold text-white"
      >
        다시 시도
      </button>
    </div>
  )
}
