'use client'

import { useState, type ReactNode } from 'react'
import { Check, Copy, X } from 'lucide-react'

/** 클립보드 복사 버튼 — 복사 성공 시 잠시 체크 표시로 바뀐다. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label ? `${label} 복사` : '복사'}
      className="flex shrink-0 items-center gap-1 rounded-lg border-2 border-[#CBD5E1] bg-white px-2 py-1 text-[10px] font-black text-[#475569] hover:border-[#4A82B8] hover:text-[#4A82B8]"
    >
      {copied ? <Check size={11} className="text-[#15803D]" /> : <Copy size={11} />}
      {copied ? '복사됨' : '복사'}
    </button>
  )
}

export type AdminDetailRow = {
  label: string
  value: string
  /** true면 값 옆에 복사 버튼을 붙인다. */
  copy?: boolean
}

/**
 * 관리자 모드 공용 '상세 보기' 모달 — 입금 내역 상세 팝업과 같은 패턴.
 * hero: 상단 강조 값(금액 등), heroNote: 보조 설명(시각 등), badges: 상태 배지
 * 영역, rows: 라벨/값 목록(복사 버튼 옵션).
 */
export function AdminDetailModal({
  title,
  eyebrow = 'DETAIL',
  hero,
  heroNote,
  badges,
  rows,
  onClose,
}: {
  title: string
  eyebrow?: string
  hero?: string
  heroNote?: string
  badges?: ReactNode
  rows: AdminDetailRow[]
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <section
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-[24px] bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-black text-[#4A82B8]">{eyebrow}</p>
            <h3 className="mt-0.5 text-lg font-black text-[#0F172A]">{title}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full bg-[#F1F5F9] p-1.5 text-[#475569]">
            <X size={16} />
          </button>
        </div>
        {hero || heroNote || badges ? (
          <div className="mt-3 rounded-2xl bg-[#EFF6FF] px-4 py-3 text-center">
            {hero ? <p className="text-2xl font-black text-[#1D4ED8]">{hero}</p> : null}
            {heroNote || badges ? (
              <p className="mt-0.5 text-[10px] font-bold text-[#475569]">
                {heroNote}
                {badges}
              </p>
            ) : null}
          </div>
        ) : null}
        <dl className="mt-4 space-y-3">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-[10px] font-black text-[#94A3B8]">{row.label}</dt>
              <dd className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg bg-[#F8FAFC] px-2.5 py-1.5 font-mono text-[11px] font-bold text-[#334155]">
                  {row.value || '-'}
                </code>
                {row.copy && row.value ? <CopyButton value={row.value} label={row.label} /> : null}
              </dd>
            </div>
          ))}
        </dl>
        <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-[#0F172A] py-2.5 text-xs font-black text-white">
          닫기
        </button>
      </section>
    </div>
  )
}
