'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { getNotice, notices } from '@/lib/notices'
import SupportCenter from '@/components/support-center'
import { useLocale } from '@/components/locale-provider'
import type { AppLocale } from '@/lib/i18n'

function PageFrame({ title, caption, onBack, children }: { title: string; caption: string; onBack: () => void; children: React.ReactNode }) {
  const { t } = useLocale()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-3">
        <button type="button" onClick={onBack} className="mt-0.5 rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="뒤로가기">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <p className="text-xs font-black text-[#4C1FB8]">{t('more.hub')}</p>
          <h2 className="mt-1 text-2xl font-black text-[#0F172A]">{title}</h2>
          <p className="mt-1 text-sm font-bold text-[#64748B]">{caption}</p>
        </div>
      </div>
      <div className="mt-5 min-h-0 flex-1 overflow-y-auto pb-4">{children}</div>
    </div>
  )
}

export function NoticeListView({ onBack, onOpen }: { onBack: () => void; onOpen: (id: string) => void }) {
  return (
    <PageFrame title="공지사항" caption="서비스 소식과 업데이트를 확인하세요." onBack={onBack}>
      <div className="space-y-2">
        {notices.map((item) => (
          <button key={item.id} type="button" onClick={() => onOpen(item.id)} className="w-full rounded-2xl border-2 border-[#CBD5E1] bg-white p-4 text-left shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
            <p className="text-[11px] font-black text-[#4C1FB8]">{item.kind} · {item.date}</p>
            <strong className="mt-1 block text-sm font-black text-[#0F172A]">{item.title}</strong>
            <span className="mt-1 block text-xs font-bold text-[#64748B]">{item.summary}</span>
          </button>
        ))}
      </div>
    </PageFrame>
  )
}

export function NoticeDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const item = getNotice(id)
  return (
    <PageFrame title={item?.title || '공지사항'} caption={item ? `${item.kind} · ${item.date}` : '공지를 찾을 수 없습니다.'} onBack={onBack}>
      <div className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4 text-sm font-medium leading-6 text-[#334155] shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
        {item?.body || '선택한 공지 내용을 불러오지 못했습니다.'}
      </div>
    </PageFrame>
  )
}

export function FaresView({ onBack }: { onBack: () => void }) {
  const rows = [
    { name: '택시', fare: '2.1 Pi', note: '기본 호출 · 도착 후 후결제' },
    { name: '대리운전', fare: '2.1~2.8 Pi', note: '착한요금 / 빠른배정' },
    { name: '주차', fare: '1.5~3 Pi', note: '시간당 · 선결제/후결제' },
    { name: '자전거', fare: '0.2 Pi', note: 'QR 이용 후 자동결제' },
    { name: '킥보드', fare: '0.3 Pi', note: 'QR 이용 후 자동결제' },
    { name: 'EV 충전', fare: '0.38~0.5 Pi', note: 'kWh 기준 선결제' },
    { name: '택배', fare: '1.2~4.2 Pi', note: '차량·크기별 선결제' },
  ]
  return (
    <PageFrame title="이용요금 안내" caption="기본요금과 구간별 요금 체계입니다." onBack={onBack}>
      <div className="overflow-hidden rounded-2xl border-2 border-[#CBD5E1] bg-white shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
        {rows.map((row, index) => (
          <div key={row.name} className={`flex items-start justify-between gap-3 px-4 py-3 ${index ? 'border-t border-[#E2E8F0]' : ''}`}>
            <div>
              <p className="text-sm font-black text-[#0F172A]">{row.name}</p>
              <p className="mt-0.5 text-xs font-bold text-[#64748B]">{row.note}</p>
            </div>
            <p className="shrink-0 text-sm font-black text-[#4C1FB8]">{row.fare}</p>
          </div>
        ))}
      </div>
    </PageFrame>
  )
}

function localSupportActorId() {
  try {
    const existing = window.localStorage.getItem('taxitago-passenger-id')
    if (existing) return existing
    const id = `passenger-${crypto.randomUUID()}`
    window.localStorage.setItem('taxitago-passenger-id', id)
    return id
  } catch {
    return 'passenger-local'
  }
}

export function SupportView({
  onBack,
  onNotice,
  prefillLost,
}: {
  onBack: () => void
  onNotice?: (message: string) => void
  prefillLost?: import('@/components/support-center').LostPrefill | null
}) {
  const [actorId, setActorId] = useState('passenger-local')
  useEffect(() => {
    setActorId(localSupportActorId())
  }, [])
  const faqs = [
    { q: '결제는 언제 되나요?', a: '택시는 도착 후 후결제, 주차·택배는 요청 시 선결제, 자전거·킥보드는 QR 이용 후 자동결제입니다.' },
    { q: '호출을 취소할 수 있나요?', a: '기사 배정 전에는 호출 화면에서 바로 취소할 수 있습니다. 배정 이후에는 고객센터로 문의해 주세요.' },
    { q: '분실물은 어떻게 찾나요?', a: '이용 내역의 운행을 선택한 뒤 분실물 센터에서 물건 종류와 시각을 남기면 해당 기사님과 바로 연결됩니다.' },
    { q: '운행 중 위급하면?', a: '호출 화면의 긴급 SOS를 누르면 현재 GPS와 차량 정보가 운영센터로 즉시 전달됩니다. 위급 시 112에도 연락해 주세요.' },
  ]
  return (
    <PageFrame title="고객센터" caption="SOS · 분실물 · 1:1 문의" onBack={onBack}>
      <div className="mb-4 space-y-2">
        {faqs.map((item) => (
          <div key={item.q} className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
            <p className="text-sm font-black text-[#0F172A]">{item.q}</p>
            <p className="mt-1 text-xs font-bold leading-5 text-[#64748B]">{item.a}</p>
          </div>
        ))}
      </div>
      <SupportCenter actorId={actorId} actorRole="passenger" onNotice={onNotice} prefillLost={prefillLost} />
    </PageFrame>
  )
}

export function SettingsView({ onBack, onNotice }: { onBack: () => void; onNotice?: (message: string) => void }) {
  const { t, locale, locales, current, setLocale } = useLocale()
  const [push, setPush] = useState(true)
  const [marketing, setMarketing] = useState(false)
  const [location, setLocation] = useState(true)
  const [languageOpen, setLanguageOpen] = useState(false)
  const toggle = (label: string, value: boolean, setValue: (next: boolean) => void) => {
    setValue(!value)
    onNotice?.(t(value ? 'settings.toggleOff' : 'settings.toggleOn', { label }))
  }
  const applyLanguage = (next: AppLocale) => {
    setLocale(next)
    setLanguageOpen(false)
    const selected = locales.find((item) => item.id === next)
    onNotice?.(t('settings.applied', { name: selected?.nativeName || next }))
  }
  const Row = ({ label, caption, value, onToggle }: { label: string; caption: string; value: boolean; onToggle: () => void }) => (
    <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 rounded-2xl border-2 border-[#CBD5E1] bg-white p-4 text-left shadow-[0_8px_18px_rgba(15,23,42,0.08)] active:scale-[0.99]">
      <span>
        <strong className="block text-sm font-black text-[#0F172A]">{label}</strong>
        <span className="mt-1 block text-xs font-bold text-[#64748B]">{caption}</span>
      </span>
      <span className={`relative h-6 w-11 rounded-full ${value ? 'bg-[#4C1FB8]' : 'bg-[#CBD5E1]'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${value ? 'left-5.5 right-0.5' : 'left-0.5'}`} style={{ left: value ? '1.35rem' : '0.15rem' }} />
      </span>
    </button>
  )
  return (
    <PageFrame title={t('settings.title')} caption={t('settings.caption')} onBack={onBack}>
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setLanguageOpen(true)}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border-2 border-[#CBD5E1] bg-white p-4 text-left shadow-[0_8px_18px_rgba(15,23,42,0.08)] active:scale-[0.99]"
        >
          <span>
            <strong className="block text-sm font-black text-[#0F172A]">{t('settings.language')}</strong>
            <span className="mt-1 block text-xs font-bold text-[#64748B]">{t('settings.languageCaption')}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-sm font-black text-[#4C1FB8]">
            {current.flag} {current.nativeName}
            <ChevronRight className="h-4 w-4 text-[#94A3B8]" />
          </span>
        </button>
        <Row label={t('settings.push')} caption={t('settings.pushCaption')} value={push} onToggle={() => toggle(t('settings.push'), push, setPush)} />
        <Row label={t('settings.marketing')} caption={t('settings.marketingCaption')} value={marketing} onToggle={() => toggle(t('settings.marketing'), marketing, setMarketing)} />
        <Row label={t('settings.location')} caption={t('settings.locationCaption')} value={location} onToggle={() => toggle(t('settings.location'), location, setLocation)} />
      </div>
      {languageOpen ? (
        <div className="fixed inset-0 z-[120] flex items-end bg-[#1e1033]/45 sm:items-center sm:p-4" onClick={() => setLanguageOpen(false)}>
          <section
            className="mx-auto w-full max-w-md rounded-t-[28px] bg-white px-5 pb-7 pt-4 shadow-2xl sm:rounded-[28px]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-language-title"
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
            <h3 id="app-language-title" className="text-lg font-black text-[#0F172A]">
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
                    onClick={() => applyLanguage(item.id)}
                    className={`flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-[#F8FAFC] ${index ? 'border-t border-[#F1F5F9]' : ''} ${selected ? 'bg-[#F5F3FF]' : 'bg-white'}`}
                  >
                    <span className="text-xl leading-none">{item.flag}</span>
                    <span className="min-w-0 flex-1">
                      <strong className="block text-sm font-black text-[#0F172A]">{item.nativeName}</strong>
                      <span className="mt-0.5 block text-[11px] font-bold text-[#64748B]">{item.englishName}</span>
                    </span>
                    {selected ? <Check className="h-5 w-5 text-[#4C1FB8]" strokeWidth={2.5} /> : null}
                  </button>
                )
              })}
            </div>
            <button type="button" onClick={() => setLanguageOpen(false)} className="mt-4 w-full py-3 text-sm font-black text-[#64748B]">
              {t('settings.close')}
            </button>
          </section>
        </div>
      ) : null}
    </PageFrame>
  )
}
