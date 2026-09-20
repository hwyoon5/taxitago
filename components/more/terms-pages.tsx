'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getLegalTerm, legalTermList } from '@/lib/legal-terms'

function TermsHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="sticky top-0 z-10 shrink-0 border-b border-[#ECEFF3] bg-white px-2">
      <div className="relative flex h-12 items-center">
        <button
          type="button"
          onClick={onBack}
          className="absolute left-1 inline-flex h-10 w-10 items-center justify-center rounded-full text-[#191919] active:bg-[#F2F3F5]"
          aria-label="뒤로가기"
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={1.8} />
        </button>
        <h1 className="w-full truncate px-12 text-center text-[17px] font-bold tracking-tight text-[#191919]">{title}</h1>
      </div>
    </header>
  )
}

export function TermsListView({ onBack, onOpen }: { onBack: () => void; onOpen: (id: string) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F5F6F8]">
      <TermsHeader title="약관 및 정책" onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-5 pb-2 pt-4 text-[12px] font-semibold leading-5 text-[#8B919A]">TaxiTago 서비스 이용과 개인정보 보호에 관한 안내입니다.</p>
        <div className="overflow-hidden bg-white">
          {legalTermList.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpen(item.id)}
              className={`flex w-full items-center gap-3 px-5 py-[15px] text-left active:bg-[#F7F8FA] ${index ? 'border-t border-[#F0F1F3]' : ''}`}
            >
              <span className="min-w-0 flex-1">
                <strong className="block text-[15px] font-semibold leading-5 text-[#191919]">{item.title}</strong>
                <span className="mt-0.5 block truncate text-[12px] font-medium leading-4 text-[#8B919A]">{item.subtitle}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[#C5C9D0]" strokeWidth={2} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function TermsDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const doc = getLegalTerm(id)
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F5F6F8]">
      <TermsHeader title={doc?.title || '약관 및 정책'} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-4">
        {doc ? (
          <article className="rounded-2xl bg-white px-5 py-5">
            <p className="text-[12px] font-semibold text-[#8B919A]">{doc.subtitle}</p>
            <p className="mt-1 text-[12px] font-medium text-[#B0B5BD]">시행일 {doc.updated}</p>
            <div className="mt-5 space-y-5">
              {doc.sections.map((section) => (
                <section key={section.heading}>
                  <h2 className="text-[14px] font-bold leading-5 text-[#191919]">{section.heading}</h2>
                  <p className="mt-1.5 text-[13px] font-medium leading-[1.65] text-[#4B5563]">{section.body}</p>
                </section>
              ))}
            </div>
          </article>
        ) : (
          <p className="rounded-2xl bg-white px-5 py-8 text-center text-sm font-semibold text-[#8B919A]">약관 내용을 찾을 수 없습니다.</p>
        )}
      </div>
    </div>
  )
}
