'use client'

import { useState } from 'react'
import { FileSpreadsheet, X } from 'lucide-react'

type Kind = 'revenue' | 'trips'

const revenue = {
  daily: [
    { period: '2026-09-17 (목)', count: 8, amount: 45.2, note: '오늘' },
    { period: '2026-09-16 (수)', count: 6, amount: 32.8, note: '완료' },
    { period: '2026-09-15 (화)', count: 9, amount: 51.4, note: '완료' },
    { period: '2026-09-14 (월)', count: 7, amount: 38.6, note: '완료' },
  ],
  monthly: [
    { period: '2026-09', count: 54, amount: 298.8, note: '진행 중' },
    { period: '2026-08', count: 121, amount: 642.5, note: '마감' },
    { period: '2026-07', count: 108, amount: 571.3, note: '마감' },
  ],
  yearly: [
    { period: '2026', count: 379, amount: 2010.6, note: '진행 중' },
    { period: '2025', count: 1284, amount: 6842.1, note: '마감' },
  ],
  total: [{ period: '누적 합계', count: 2569, amount: 13564.1, note: '전체' }],
}

const trips = {
  daily: [
    { period: '2026-09-17 (목)', trips: 8, done: 8, cancel: 0 },
    { period: '2026-09-16 (수)', trips: 7, done: 6, cancel: 1 },
    { period: '2026-09-15 (화)', trips: 10, done: 9, cancel: 1 },
    { period: '2026-09-14 (월)', trips: 7, done: 7, cancel: 0 },
  ],
  monthly: [
    { period: '2026-09', trips: 58, done: 54, cancel: 4 },
    { period: '2026-08', trips: 129, done: 121, cancel: 8 },
    { period: '2026-07', trips: 116, done: 108, cancel: 8 },
  ],
  yearly: [
    { period: '2026', trips: 406, done: 379, cancel: 27 },
    { period: '2025', trips: 1361, done: 1284, cancel: 77 },
  ],
}

const routes = [
  { from: '서울시청', to: '강남역', fare: 6.4, service: '택시' },
  { from: '홍대입구', to: '합정', fare: 3.2, service: '택시' },
  { from: '잠실역', to: '송파나루', fare: 4.8, service: '대리' },
  { from: '여의도', to: '공덕', fare: 5.1, service: '택시' },
  { from: '성수', to: '건대입구', fare: 3.6, service: '택시' },
  { from: '사당역', to: '이수', fare: 2.9, service: '대리' },
]

export default function PartnerStatSheet({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const isRevenue = kind === 'revenue'
  const tabs = isRevenue
    ? ([{ id: 'daily', label: '일일 수익' }, { id: 'monthly', label: '월별 수익' }, { id: 'yearly', label: '년도별 수익' }, { id: 'total', label: '총 수익' }] as const)
    : ([{ id: 'daily', label: '일별 운행' }, { id: 'monthly', label: '월별 운행' }, { id: 'yearly', label: '년도별 운행' }] as const)
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('daily')
  const [opened, setOpened] = useState<{ period: string; count: number; cancel: number; amount?: number } | null>(null)
  const revenueRows = revenue[tab === 'total' ? 'total' : tab === 'monthly' ? 'monthly' : tab === 'yearly' ? 'yearly' : 'daily']
  const tripRows = trips[tab === 'monthly' ? 'monthly' : tab === 'yearly' ? 'yearly' : 'daily']
  const details = opened
    ? Array.from({ length: Math.min(opened.count, 8) }, (_, index) => {
        const route = routes[(opened.period.length + index * 3) % routes.length]
        const canceled = index < opened.cancel
        return {
          id: `${opened.period}-${index}`,
          time: `${String(7 + ((index * 2) % 14)).padStart(2, '0')}:${String((index * 13) % 60).padStart(2, '0')}`,
          ...route,
          fare: canceled ? 0 : route.fare,
          status: canceled ? '취소' : '완료',
        }
      })
    : []
  const accent = isRevenue
    ? { ink: 'text-teal-700', on: 'bg-teal-700 text-white', off: 'bg-teal-50 text-teal-700', head: 'bg-teal-700', border: 'border-teal-200', zebra: 'bg-teal-50', hover: 'hover:bg-teal-100 active:bg-teal-200', total: 'bg-teal-100 text-teal-900', amount: 'text-teal-700' }
    : { ink: 'text-sky-700', on: 'bg-sky-700 text-white', off: 'bg-sky-50 text-sky-700', head: 'bg-cyan-800', border: 'border-sky-200', zebra: 'bg-sky-50', hover: 'hover:bg-sky-100 active:bg-sky-200', total: 'bg-sky-100 text-sky-900', amount: 'text-sky-700' }
  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-slate-900/45 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-[32px] bg-white shadow-2xl transition-transform duration-300 ease-out sm:rounded-[32px]" onClick={(event) => event.stopPropagation()}>
        <div className="px-5 pt-4">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className={`flex items-center gap-1.5 text-sm font-semibold ${accent.ink}`}>
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {isRevenue ? '수익 상세 내역' : '운행 횟수 상세 내역'}
              </p>
              <h2 className="mt-1 text-2xl font-semibold leading-snug tracking-tight text-slate-900">{isRevenue ? '엑셀 시트 · 수익 통계' : '엑셀 시트 · 운행 통계'}</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-full bg-slate-100 p-2 text-slate-600" aria-label="통계 닫기">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
            {tabs.map((item) => (
              <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${tab === item.id ? accent.on : accent.off}`}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-auto px-5 pb-6">
          <div className={`overflow-hidden rounded-[18px] border-2 ${accent.border}`}>
            <div className={`grid ${isRevenue ? 'grid-cols-[1.4fr_0.7fr_0.9fr_0.7fr]' : 'grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr]'} ${accent.head} px-3 py-2.5 text-xs font-normal text-white`}>
              <span>기간</span>
              {isRevenue ? <><span>건수</span><span>수익(Pi)</span><span>상태</span></> : <><span>운행 횟수</span><span>완료</span><span>취소</span></>}
            </div>
            <div>
              {isRevenue
                ? revenueRows.map((row, index) => (
                    <button
                      key={row.period}
                      type="button"
                      onClick={() => setOpened({ period: row.period, count: row.count, cancel: 0, amount: row.amount })}
                      className={`grid w-full grid-cols-[1.4fr_0.7fr_0.9fr_0.7fr] border-t border-slate-100 px-3 py-3 text-left text-sm font-semibold leading-snug transition ${index % 2 === 0 ? 'bg-white' : accent.zebra} ${accent.hover}`}
                    >
                      <span className="font-normal text-slate-900">{row.period}</span>
                      <span className="font-normal text-slate-600">{row.count.toLocaleString()}건</span>
                      <span className={`font-normal ${accent.amount}`}>{row.amount.toFixed(1)}</span>
                      <span className="font-normal text-slate-800">{row.note}</span>
                    </button>
                  ))
                : tripRows.map((row, index) => (
                    <button
                      key={row.period}
                      type="button"
                      onClick={() => setOpened({ period: row.period, count: row.trips, cancel: row.cancel })}
                      className={`grid w-full grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr] border-t border-slate-100 px-3 py-3 text-left text-sm font-semibold leading-snug transition ${index % 2 === 0 ? 'bg-white' : accent.zebra} ${accent.hover}`}
                    >
                      <span className="font-normal text-slate-900">{row.period}</span>
                      <span className={`font-normal ${accent.amount}`}>{row.trips.toLocaleString()}회</span>
                      <span className="font-normal text-slate-600">{row.done.toLocaleString()}건</span>
                      <span className="font-normal text-slate-800">{row.cancel.toLocaleString()}건</span>
                    </button>
                  ))}
              <div className={`grid ${isRevenue ? 'grid-cols-[1.4fr_0.7fr_0.9fr_0.7fr]' : 'grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr]'} px-3 py-2.5 text-sm font-normal ${accent.total}`}>
                {isRevenue ? (
                  <>
                    <span>합계</span>
                    <span>{revenueRows.reduce((sum, row) => sum + row.count, 0).toLocaleString()}건</span>
                    <span>{revenueRows.reduce((sum, row) => sum + row.amount, 0).toFixed(1)}</span>
                    <span>Pi</span>
                  </>
                ) : (
                  <>
                    <span>합계</span>
                    <span>{tripRows.reduce((sum, row) => sum + row.trips, 0).toLocaleString()}회</span>
                    <span>{tripRows.reduce((sum, row) => sum + row.done, 0).toLocaleString()}건</span>
                    <span>{tripRows.reduce((sum, row) => sum + row.cancel, 0).toLocaleString()}건</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <p className="mt-3 text-center text-sm font-semibold leading-relaxed text-slate-800">행을 선택하면 해당 기간의 세부 운행 내역을 볼 수 있어요</p>
        </div>
      </section>
      {opened ? (
        <div
          className="fixed inset-0 z-[110] flex items-end bg-slate-900/50 sm:items-center sm:p-6"
          onClick={(event) => {
            event.stopPropagation()
            setOpened(null)
          }}
        >
          <section className="mx-auto max-h-[82vh] w-full max-w-sm overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-sm font-semibold ${accent.ink}`}>{isRevenue ? '수익 세부 내역' : '운행 세부 내역'}</p>
                <h3 className="mt-1 text-xl font-semibold leading-snug tracking-tight text-slate-900">{opened.period}</h3>
                {opened.amount != null ? <p className={`mt-1 text-lg font-semibold ${accent.amount}`}>합계 {opened.amount.toFixed(1)} Pi</p> : null}
              </div>
              <button type="button" onClick={() => setOpened(null)} className="rounded-full bg-slate-100 p-2 text-slate-600" aria-label="세부 내역 닫기">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="mt-4 space-y-2">
              {details.map((item) => (
                <li key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">{item.time} · {item.service}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${item.status === '완료' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>{item.status}</span>
                  </div>
                  <p className="mt-1.5 text-base font-normal leading-snug text-slate-900">{item.from} → {item.to}</p>
                  {isRevenue ? (
                    <p className={`mt-1 text-base font-semibold ${accent.amount}`}>{item.status === '완료' ? `+${item.fare.toFixed(1)} Pi` : '정산 없음'}</p>
                  ) : (
                    <p className="mt-1 text-sm font-semibold text-slate-800">{item.status === '완료' ? '운행 완료' : '호출 취소'} · {item.fare ? `${item.fare.toFixed(1)} Pi` : '요금 없음'}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  )
}
