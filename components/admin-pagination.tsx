'use client'

import { useEffect, useMemo, useState } from 'react'

/** 페이지당 표시 개수 옵션 — 모든 관리자 리스트 공통 */
export const ADMIN_PAGE_SIZES = [10, 20, 30, 50]

/**
 * 공통 페이지네이션 hook — 전체 목록을 pageSize 단위로 나누어 반환한다.
 * deps에 필터/정렬 상태를 넣으면 변경 시 자동으로 1페이지로 돌아간다.
 */
export function usePagination<T>(items: T[], defaultSize = 10, deps: readonly unknown[] = []) {
  const [pageSize, setPageSize] = useState(defaultSize)
  const [page, setPage] = useState(1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1) }, [pageSize, ...deps])

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const paged = items.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const rangeStart = items.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const rangeEnd = Math.min(items.length, currentPage * pageSize)

  // 현재 페이지 중심 최대 5개 번호 버튼
  const pageButtons = useMemo(() => {
    const span = 2
    const start = Math.max(1, Math.min(currentPage - span, totalPages - span * 2))
    const end = Math.min(totalPages, start + span * 2)
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  }, [currentPage, totalPages])

  return {
    pageSize, setPageSize,
    page: currentPage, setPage,
    totalPages, paged, rangeStart, rangeEnd, pageButtons,
    total: items.length,
  }
}

/** 화면당 개수 선택 드롭다운 */
export function PageSizeSelect({
  pageSize,
  onChange,
  className,
}: {
  pageSize: number
  onChange: (size: number) => void
  className?: string
}) {
  return (
    <select
      value={pageSize}
      onChange={(event) => onChange(Number(event.target.value))}
      className={className || 'rounded-lg border border-[#CBD5E1] bg-white px-2 py-1 text-[11px] font-black text-[#334155] outline-none'}
    >
      {ADMIN_PAGE_SIZES.map((size) => (
        <option key={size} value={size}>{size}개씩 보기</option>
      ))}
    </select>
  )
}

/** 하단 페이지 네비게이션 — 이전/다음 + 번호 버튼 + 범위 표시 */
export function PaginationBar({
  total,
  rangeStart,
  rangeEnd,
  page,
  totalPages,
  pageButtons,
  onPage,
}: {
  total: number
  rangeStart: number
  rangeEnd: number
  page: number
  totalPages: number
  pageButtons: number[]
  onPage: (page: number) => void
}) {
  if (total === 0) return null
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E2E8F0] pt-3">
      <p className="text-[10px] font-bold text-[#94A3B8]">
        전체 {total}건 중 {rangeStart}-{rangeEnd}번
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="rounded-lg border border-[#CBD5E1] px-2.5 py-1 text-[11px] font-black text-[#475569] disabled:opacity-40"
        >
          이전
        </button>
        {pageButtons.map((number) => (
          <button
            key={number}
            type="button"
            onClick={() => onPage(number)}
            className={`min-w-7 rounded-lg px-2 py-1 text-[11px] font-black ${number === page ? 'bg-[#0F172A] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
          >
            {number}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="rounded-lg border border-[#CBD5E1] px-2.5 py-1 text-[11px] font-black text-[#475569] disabled:opacity-40"
        >
          다음
        </button>
      </div>
    </div>
  )
}
