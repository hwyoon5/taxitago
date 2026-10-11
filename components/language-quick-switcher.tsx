'use client'

import { useState } from 'react'
import { Check, Languages } from 'lucide-react'
import { useLocale } from '@/components/locale-provider'

/**
 * 헤더 등 눈에 띄는 위치에 두는 언어 퀵스위처 — 현재 언어 코드(KR/EN/JP/CN)를
 * 보여 주고, 탭하면 지원 언어를 고르는 하단 시트를 연다.
 * 실제 언어 변경은 LocaleProvider의 setLocale이 담당한다.
 */
export default function LanguageQuickSwitcher() {
  const { locale, locales, current, setLocale, t } = useLocale()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('home.language')}
        className="flex h-10 items-center gap-1 rounded-full bg-[#E8F1FA] px-3 text-[11px] font-black text-[#4A82B8] transition hover:bg-[#DCEBF7] active:scale-95"
      >
        <Languages className="h-4 w-4" />
        {current.short}
      </button>
      {open ? (
        <div className="fixed inset-0 z-[140] flex items-end justify-center bg-[#0F172A]/45 sm:items-center" onClick={() => setOpen(false)}>
          <section
            className="w-full max-w-md rounded-t-[28px] bg-white px-5 pb-7 pt-4 shadow-2xl sm:rounded-[28px]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-language-title"
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[#E2E8F0]" />
            <h3 id="quick-language-title" className="text-lg font-black text-[#0F172A]">
              {t('settings.languageTitle')}
            </h3>
            <p className="mt-1 text-sm font-bold text-[#64748B]">{t('settings.languageHint')}</p>
            <div className="mt-4 overflow-hidden rounded-2xl border border-[#E2E8F0]">
              {locales.map((item, index) => {
                const selected = item.id === locale
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setLocale(item.id)
                      setOpen(false)
                    }}
                    className={`flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-[#F8FAFC] ${index ? 'border-t border-[#F1F5F9]' : ''} ${selected ? 'bg-[#E8F1FA]' : 'bg-white'}`}
                  >
                    <span className="text-xl leading-none">{item.flag}</span>
                    <span className="min-w-0 flex-1">
                      <strong className="block text-sm font-black text-[#0F172A]">{item.nativeName}</strong>
                      <span className="mt-0.5 block text-[11px] font-bold text-[#64748B]">{item.englishName}</span>
                    </span>
                    <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-black text-[#64748B]">{item.short}</span>
                    {selected ? <Check className="h-5 w-5 shrink-0 text-[#4A82B8]" strokeWidth={2.5} /> : null}
                  </button>
                )
              })}
            </div>
            <button type="button" onClick={() => setOpen(false)} className="mt-4 w-full py-3 text-sm font-black text-[#64748B]">
              {t('settings.close')}
            </button>
          </section>
        </div>
      ) : null}
    </>
  )
}
