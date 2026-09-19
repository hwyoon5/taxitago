'use client'

import { useState } from 'react'
import { FileSpreadsheet, X } from 'lucide-react'
import type { DriverEarning, DriverEarningsStats, EarningsPeriodRow } from '@/lib/escrow-types'

type Kind = 'revenue' | 'trips'

const emptyStats: DriverEarningsStats = {
  todayAmount: 0,
  todayTrips: 0,
  rating: '5.00',
  daily: [],
  monthly: [],
  yearly: [],
  total: [{ period: '누적 합계', count: 0, amount: 0, trips: 0, done: 0, cancel: 0, note: '전체' }],
  recent: [],
}

export default function PartnerStatSheet({
  kind,
  onClose,
  stats,
}: {
  kind: Kind
  onClose: () => void
  stats?: DriverEarningsStats | null
}) {
  const live = stats ?? emptyStats
  const isRevenue = kind === 'revenue'
  const tabs = isRevenue
    ? ([{ id: 'daily', label: '일일 수익' }, { id: 'monthly', label: '월별 수익' }, { id: 'yearly', label: '년도별 수익' }, { id: 'total', label: '총 수익' }] as const)
    : ([{ id: 'daily', label: '일별 운행' }, { id: 'monthly', label: '월별 운행' }, { id: 'yearly', label: '년도별 운행' }] as const)
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('daily')
  const [opened, setOpened] = useState<{ period: string; amount?: number } | null>(null)
  const rows: EarningsPeriodRow[] =
    tab === 'total' ? live.total : tab === 'monthly' ? live.monthly : tab === 'yearly' ? live.yearly : live.daily
  const details: DriverEarning[] = opened
    ? live.recent.filter((item) => {
        const at = item.at.slice(0, 7)
        if (tab === 'yearly') return item.at.startsWith(opened.period)
        if (tab === 'monthly') return at === opened.period
        if (tab === 'total') return true
        return opened.period.startsWith(item.at.slice(0, 10))
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
              <h2 className="mt-1 text-2xl font-semibold leading-snug tracking-tight text-slate-900">{isRevenue ? '에스크로 정산 · 수익 통계' : '에스크로 정산 · 운행 통계'}</h2>
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
              {rows.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm font-semibold text-slate-500">아직 정산된 운행이 없습니다</p>
              ) : isRevenue ? (
                rows.map((row, index) => (
                  <button
                    key={row.period}
                    type="button"
                    onClick={() => setOpened({ period: row.period, amount: row.amount })}
                    className={`grid w-full grid-cols-[1.4fr_0.7fr_0.9fr_0.7fr] border-t border-slate-100 px-3 py-3 text-left text-sm font-semibold leading-snug transition ${index % 2 === 0 ? 'bg-white' : accent.zebra} ${accent.hover}`}
                  >
                    <span className="font-normal text-slate-900">{row.period}</span>
                    <span className="font-normal text-slate-600">{row.count.toLocaleString()}건</span>
                    <span className={`font-normal ${accent.amount}`}>{row.amount.toFixed(1)}</span>
                    <span className="font-normal text-slate-800">{row.note}</span>
                  </button>
                ))
              ) : (
                rows.map((row, index) => (
                  <button
                    key={row.period}
                    type="button"
                    onClick={() => setOpened({ period: row.period })}
                    className={`grid w-full grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr] border-t border-slate-100 px-3 py-3 text-left text-sm font-semibold leading-snug transition ${index % 2 === 0 ? 'bg-white' : accent.zebra} ${accent.hover}`}
                  >
                    <span className="font-normal text-slate-900">{row.period}</span>
                    <span className={`font-normal ${accent.amount}`}>{row.trips.toLocaleString()}회</span>
                    <span className="font-normal text-slate-600">{row.done.toLocaleString()}건</span>
                    <span className="font-normal text-slate-800">{row.cancel.toLocaleString()}건</span>
                  </button>
                ))
              )}
              {rows.length > 0 ? (
                <div className={`grid ${isRevenue ? 'grid-cols-[1.4fr_0.7fr_0.9fr_0.7fr]' : 'grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr]'} px-3 py-2.5 text-sm font-normal ${accent.total}`}>
                  {isRevenue ? (
                    <>
                      <span>합계</span>
                      <span>{rows.reduce((sum, row) => sum + row.count, 0).toLocaleString()}건</span>
                      <span>{rows.reduce((sum, row) => sum + row.amount, 0).toFixed(1)}</span>
                      <span>Pi</span>
                    </>
                  ) : (
                    <>
                      <span>합계</span>
                      <span>{rows.reduce((sum, row) => sum + row.trips, 0).toLocaleString()}회</span>
                      <span>{rows.reduce((sum, row) => sum + row.done, 0).toLocaleString()}건</span>
                      <span>{rows.reduce((sum, row) => sum + row.cancel, 0).toLocaleString()}건</span>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <p className="mt-3 text-center text-sm font-semibold leading-relaxed text-slate-800">행을 선택하면 에스크로 정산된 운행을 볼 수 있어요</p>
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
              {details.length === 0 ? (
                <li className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm font-semibold text-slate-500">해당 기간 내역이 없습니다</li>
              ) : details.map((item) => (
                <li key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">{new Date(item.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${item.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>{item.status === 'completed' ? '완료' : '취소'}</span>
                  </div>
                  <p className="mt-1.5 text-base font-normal leading-snug text-slate-900">{item.route}</p>
                  <p className={`mt-1 text-base font-semibold ${accent.amount}`}>{item.status === 'completed' ? `+${item.amount.toFixed(2)} Pi` : '정산 없음'}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  )
}
