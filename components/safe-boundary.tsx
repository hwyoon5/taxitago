'use client'

import { Component, type ReactNode } from 'react'

/**
 * 공용 렌더 에러 바운더리 — 자식 렌더 중 예외가 나도 페이지 전체 크래시
 * (app/error.tsx '일시적인 오류가 발생했습니다')로 번지지 않게 한다.
 * 기본 폴백은 인라인 오류 패널 + 다시 시도 버튼.
 */
export class SafeBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode; label?: string },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback
    return (
      <div className="rounded-2xl border-2 border-[#FCA5A5] bg-[#FEF2F2] p-4 text-center">
        <p className="text-xs font-black text-[#B91C1C]">{this.props.label || '화면을 불러오는 중 문제가 발생했어요.'}</p>
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="mt-2 rounded-full bg-[#4A82B8] px-4 py-1.5 text-[11px] font-black text-white"
        >
          다시 시도
        </button>
      </div>
    )
  }
}
