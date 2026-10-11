'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { getLegalTerm, legalTermList, localizeLegalTerm, type LegalTermId } from '@/lib/legal-terms'
import { useLocale } from '@/components/locale-provider'
import type { MessageKey } from '@/lib/i18n'
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/contact-info'

const TERM_META: Record<LegalTermId, { title: MessageKey; subtitle: MessageKey }> = {
  service: { title: 'terms.service.title', subtitle: 'terms.service.subtitle' },
  location: { title: 'terms.location.title', subtitle: 'terms.location.subtitle' },
  efinance: { title: 'terms.efinance.title', subtitle: 'terms.efinance.subtitle' },
  operation: { title: 'terms.operation.title', subtitle: 'terms.operation.subtitle' },
  privacy: { title: 'terms.privacy.title', subtitle: 'terms.privacy.subtitle' },
  'location-privacy': { title: 'terms.location-privacy.title', subtitle: 'terms.location-privacy.subtitle' },
  opensource: { title: 'terms.opensource.title', subtitle: 'terms.opensource.subtitle' },
}

function TermsHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useLocale()
  return (
    <header className="sticky top-0 z-10 shrink-0 border-b border-[#ECEFF3] bg-white px-2">
      <div className="relative flex h-12 items-center">
        <button
          type="button"
          onClick={onBack}
          className="absolute left-1 inline-flex h-10 w-10 items-center justify-center rounded-full text-[#191919] active:bg-[#F2F3F5]"
          aria-label={t('common.back')}
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={1.8} />
        </button>
        <h1 className="w-full truncate px-12 text-center text-[17px] font-bold tracking-tight text-[#191919]">{title}</h1>
      </div>
    </header>
  )
}

export function TermsListView({ onBack, onOpen }: { onBack: () => void; onOpen: (id: string) => void }) {
  const { t } = useLocale()
  return (
    <div className="flex min-h-full flex-col bg-[#F5F6F8]">
      <TermsHeader title={t('terms.title')} onBack={onBack} />
      <div className="pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))]">
        <p className="px-5 pb-2 pt-4 text-[12px] font-semibold leading-5 text-[#8B919A]">{t('terms.caption')}</p>
        <div className="overflow-hidden bg-white">
          {legalTermList.map((item, index) => {
            const meta = TERM_META[item.id as LegalTermId]
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpen(item.id)}
                className={`flex w-full items-center gap-3 px-5 py-[15px] text-left active:bg-[#F7F8FA] ${index ? 'border-t border-[#F0F1F3]' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <strong className="block text-[15px] font-semibold leading-5 text-[#191919]">{meta ? t(meta.title) : item.title}</strong>
                  <span className="mt-0.5 block truncate text-[12px] font-medium leading-4 text-[#8B919A]">{meta ? t(meta.subtitle) : item.subtitle}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[#C5C9D0]" strokeWidth={2} />
              </button>
            )
          })}
        </div>
        <p className="px-5 pt-4 text-center text-[11px] font-semibold leading-5 text-[#8B919A]">
          {t('terms.contact')}{' '}
          <a href={SUPPORT_MAILTO} className="break-all font-bold text-[#4A82B8]">
            {SUPPORT_EMAIL}
          </a>
        </p>
      </div>
    </div>
  )
}

export function TermsDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, locale } = useLocale()
  const doc = localizeLegalTerm(getLegalTerm(id), locale)
  const meta = doc ? TERM_META[doc.id] : undefined
  return (
    <div className="flex min-h-full flex-col bg-[#F5F6F8]">
      <TermsHeader title={meta ? t(meta.title) : t('terms.title')} onBack={onBack} />
      <div className="px-5 pb-[calc(4rem+env(safe-area-inset-bottom,0px))] pt-4">
        {doc ? (
          <article className="rounded-2xl bg-white px-5 py-5">
            <p className="text-[12px] font-semibold text-[#8B919A]">{meta ? t(meta.subtitle) : doc.subtitle}</p>
            <p className="mt-1 text-[12px] font-medium text-[#B0B5BD]">{t('terms.effective', { date: doc.updated })}</p>
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
          <p className="rounded-2xl bg-white px-5 py-8 text-center text-sm font-semibold text-[#8B919A]">{t('terms.missing')}</p>
        )}
        <p className="pt-4 text-center text-[11px] font-semibold leading-5 text-[#8B919A]">
          {t('terms.contact')}{' '}
          <a href={SUPPORT_MAILTO} className="break-all font-bold text-[#4A82B8]">
            {SUPPORT_EMAIL}
          </a>
        </p>
      </div>
    </div>
  )
}
