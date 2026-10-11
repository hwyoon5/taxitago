'use client'

import { useState } from 'react'
import { ShieldCheck, X } from 'lucide-react'

/**
 * 파트너 기기(자전거·킥보드) 대여 직전에 표시하는 중개 서비스 이용·면책 동의 모달.
 * 통신판매중개자 지위(서비스 이용약관 제7조)와 이용자 책임 범위를 고지하고,
 * 체크 후 '동의 및 대여 시작'을 누른 경우에만 대여 전이가 진행된다.
 */
export function RentalConsentModal({
  device,
  onConsent,
  onClose,
}: {
  /** 동의 대상 기기 — 시리얼·종류·공급 파트너명을 고지에 포함한다. */
  device?: { serial: string; kind: string; ownerName: string } | null
  onConsent: () => void
  onClose: () => void
}) {
  const [checked, setChecked] = useState(false)

  return (
    <div className="fixed inset-0 z-[96] flex items-end bg-[#0f172a]/55 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="rental-consent-title"
        className="mx-auto w-full max-w-md rounded-t-[32px] bg-white p-5 shadow-2xl sm:rounded-[32px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold text-[#4A82B8]">LEGAL NOTICE</p>
            <h2 id="rental-consent-title" className="mt-1 text-xl font-bold text-[#0F172A]">이용 전 확인 및 면책 동의</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#64748B]" aria-label="닫기">
            <X className="h-5 w-5" />
          </button>
        </div>

        {device ? (
          <div className="mt-4 rounded-2xl bg-[#E8F1FA] px-4 py-3">
            <p className="text-sm font-black text-[#0F172A]">{device.serial}</p>
            <p className="mt-0.5 text-[11px] font-bold text-[#64748B]">
              {device.kind} · 공급 파트너: {device.ownerName || '미등록 파트너'}
            </p>
          </div>
        ) : null}

        <div className="mt-4 rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4">
          <p className="flex items-center gap-1.5 text-xs font-black text-[#334155]">
            <ShieldCheck className="h-4 w-4 text-[#4A82B8]" />
            중개 서비스 안내
          </p>
          <p className="mt-2 text-[13px] font-bold leading-[1.7] text-[#475569]">
            본 서비스는 파트너(공급자)의 기기를 중개하는 것으로, 안전수칙 준수 및 이용 중 발생하는 과실·사고에 대한 책임은 이용자 본인에게 있습니다.
          </p>
          <p className="mt-2 text-[11px] font-bold leading-5 text-[#94A3B8]">
            기기의 결함·정비 상태·표시 정보에 대한 책임은 해당 기기를 공급하는 파트너에게 있으며, 자세한 내용은 서비스 이용약관(제7조 통신판매중개자의 지위, 제8조 책임의 제한)을 따릅니다.
          </p>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-[#CBD5E1] px-4 py-3">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[#4A82B8]"
          />
          <span className="text-[13px] font-bold leading-5 text-[#0F172A]">
            위 내용을 확인했으며, 중개 서비스 이용 및 면책 조항에 동의합니다.
          </span>
        </label>

        <button
          type="button"
          disabled={!checked}
          onClick={onConsent}
          className="mt-4 w-full rounded-2xl bg-[#4A82B8] py-3.5 text-base font-bold text-white shadow-[0_10px_22px_rgba(74,130,184,0.28)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          동의 및 대여 시작
        </button>
        <button type="button" onClick={onClose} className="mt-2 w-full py-2.5 text-sm font-black text-[#64748B]">
          취소
        </button>
      </section>
    </div>
  )
}
