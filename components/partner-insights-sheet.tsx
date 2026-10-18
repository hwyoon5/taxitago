'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, Clock3, MapPin, RefreshCw, TrendingUp, X } from 'lucide-react'
import { fetchDriverInsights } from '@/lib/dispatch-client'
import type { InsightBucket, PartnerInsights } from '@/lib/partner-insights'
import { piRound } from '@/lib/pi-format'
import { useLocale } from '@/components/locale-provider'

const BLUE = '#4A82B8'
const BLUE_SOFT = '#BFDBFE'
const AMBER = '#F59E0B'

type RangeDays = 7 | 30 | 90
type PeriodTab = 'day' | 'week' | 'month'

const fmtPi = (v: number) => (Number.isFinite(v) ? piRound(v).toFixed(v >= 100 ? 2 : 4) : '0')
const fmtMin = (min: number) => {
  if (min <= 0) return '0m'
  const h = Math.floor(min / 60)
  return h ? `${h}h ${min % 60}m` : `${min}m`
}

function PiTooltip({ active, payload, label, jobsUnit }: { active?: boolean; payload?: { value?: number; name?: string }[]; label?: string; jobsUnit?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-[11px] font-black text-[#0F172A] shadow-lg">
      <p className="text-[#64748B]">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="tabular-nums">{p.name === 'jobs' ? `${p.value}${jobsUnit || ''}` : `${fmtPi(Number(p.value))} Pi`}</p>
      ))}
    </div>
  )
}

/** 요일 짧은 라벨 — 로케일 Intl로 생성(일~토). */
function dowNames(locale: string) {
  const fmt = new Intl.DateTimeFormat(locale || 'ko-KR', { weekday: 'short' })
  // 2024-01-07은 일요일 — 인덱스로 dow를 표현한다.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 7 + i))))
}

export default function PartnerInsightsSheet({
  driverId,
  altDriverId,
  onClose,
}: {
  driverId: string
  altDriverId?: string
  onClose: () => void
}) {
  const { t, locale } = useLocale()
  const [days, setDays] = useState<RangeDays>(30)
  const [period, setPeriod] = useState<PeriodTab>('day')
  const [data, setData] = useState<PartnerInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    if (!driverId) {
      setLoading(false)
      return
    }
    setError(false)
    const insights = await fetchDriverInsights(driverId, altDriverId, days)
    if (insights) {
      setData(insights)
    } else {
      setError(true)
    }
    setLoading(false)
  }, [driverId, altDriverId, days])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const series: InsightBucket[] = useMemo(() => {
    if (!data) return []
    if (period === 'week') return data.byWeek
    if (period === 'month') return data.byMonth
    // 일별은 라벨을 MM/DD로 줄인다.
    return data.daily.map((b) => ({ ...b, label: b.label.slice(5) }))
  }, [data, period])

  const dow = useMemo(() => {
    if (!data) return []
    const names = dowNames(locale)
    return data.dow.map((d) => ({ ...d, name: names[d.dow] }))
  }, [data, locale])

  const peakHour = useMemo(() => {
    if (!data) return null
    const top = [...data.hourly].sort((a, b) => b.jobs - a.jobs || b.netPi - a.netPi)[0]
    return top && top.jobs > 0 ? top.hour : null
  }, [data])

  const demandPeak = useMemo(() => {
    if (!data) return []
    return [...data.demand.hourly].sort((a, b) => b.jobs - a.jobs).slice(0, 3).filter((h) => h.jobs > 0)
  }, [data])

  const serviceTotal = data?.totals.netPi || 0

  return (
    <div className="fixed inset-0 z-[100] flex items-end bg-slate-900/45 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-[28px] bg-[#F8FAFC] sm:mx-auto sm:max-w-lg sm:rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('insights.title')}
      >
        {/* 헤더 */}
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-[28px] border-b border-[#E2E8F0] bg-white px-4 py-3.5">
          <p className="flex items-center gap-1.5 text-sm font-black text-[#0F172A]">
            <BarChart3 className="h-4 w-4 text-[#4A82B8]" />
            {t('insights.title')}
            {data ? (
              <span className={`ml-1 rounded-full px-2 py-0.5 text-[9px] font-black ${data.network === 'mainnet' ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#FEF3C7] text-[#B45309]'}`}>
                {data.network === 'mainnet' ? t('insights.mainnet') : t('insights.testnet')}
              </span>
            ) : null}
          </p>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#475569]" aria-label={t('common.close')}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4 pb-8">
          {/* 기간 선택 */}
          <div className="flex items-center gap-1.5">
            {([7, 30, 90] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-full px-3.5 py-1.5 text-[11px] font-black ${days === d ? 'bg-[#0F172A] text-white' : 'bg-white text-[#475569] ring-1 ring-[#E2E8F0]'}`}
              >
                {t('insights.range').replace('{days}', String(d))}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setLoading(true)
                void load()
              }}
              className="ml-auto rounded-full bg-white p-2 text-[#4A82B8] ring-1 ring-[#E2E8F0]"
              aria-label={t('common.refresh')}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {error ? (
            <article className="rounded-[20px] border-2 border-dashed border-[#FCA5A5] bg-white p-5 text-center">
              <p className="text-xs font-black text-[#B91C1C]">{t('insights.error')}</p>
              <button
                type="button"
                onClick={() => {
                  setLoading(true)
                  void load()
                }}
                className="mt-3 rounded-full bg-[#4A82B8] px-4 py-2 text-[11px] font-black text-white"
              >
                {t('insights.retry')}
              </button>
            </article>
          ) : loading && !data ? (
            <article className="rounded-[20px] bg-white p-8 text-center text-xs font-black text-[#64748B]">{t('common.loading')}</article>
          ) : data ? (
            <>
              {/* 요약 카드 */}
              <div className="grid grid-cols-2 gap-2">
                <article className="rounded-[20px] bg-[#0F172A] p-3.5 text-white">
                  <p className="text-[10px] font-black text-[#94A3B8]">{t('insights.totalRevenue')}</p>
                  <p className="mt-1 text-xl font-black tabular-nums">{fmtPi(data.totals.netPi)} <span className="text-[11px]">Pi</span></p>
                  <p className="mt-0.5 text-[9px] font-bold text-[#94A3B8]">
                    {t('insights.grossFee').replace('{gross}', fmtPi(data.totals.grossPi)).replace('{fee}', fmtPi(data.totals.commissionPi))}
                  </p>
                </article>
                <article className="rounded-[20px] bg-white p-3.5 ring-1 ring-[#E2E8F0]">
                  <p className="text-[10px] font-black text-[#64748B]">{t('insights.completedJobs')}</p>
                  <p className="mt-1 text-xl font-black tabular-nums text-[#0F172A]">{data.totals.jobs}<span className="text-[11px]"> {t('insights.jobsUnit')}</span></p>
                  <p className="mt-0.5 text-[9px] font-bold text-[#64748B]">{t('insights.avgJob').replace('{avg}', fmtPi(data.totals.avgPi))}</p>
                </article>
                <article className="rounded-[20px] bg-white p-3.5 ring-1 ring-[#E2E8F0]">
                  <p className="flex items-center gap-1 text-[10px] font-black text-[#64748B]"><Clock3 className="h-3 w-3" />{t('insights.driveTime')}</p>
                  <p className="mt-1 text-xl font-black tabular-nums text-[#0F172A]">{fmtMin(data.totals.minutes)}</p>
                  {data.totals.kwh > 0 ? <p className="mt-0.5 text-[9px] font-bold text-[#64748B]">{data.totals.kwh} kWh {t('insights.charged')}</p> : null}
                </article>
                <article className="rounded-[20px] bg-white p-3.5 ring-1 ring-[#E2E8F0]">
                  <p className="flex items-center gap-1 text-[10px] font-black text-[#64748B]"><TrendingUp className="h-3 w-3 text-[#4A82B8]" />{t('insights.peakHour')}</p>
                  <p className="mt-1 text-xl font-black tabular-nums text-[#0F172A]">{peakHour === null ? '—' : `${peakHour}${t('insights.hourUnit')}`}</p>
                  {demandPeak.length ? (
                    <p className="mt-0.5 text-[9px] font-bold text-[#B45309]">
                      {t('insights.demandPeak')} {demandPeak.map((h) => `${h.hour}${t('insights.hourUnit')}`).join('·')}
                    </p>
                  ) : null}
                </article>
              </div>

              {data.totals.jobs === 0 ? (
                <article className="rounded-[20px] border-2 border-dashed border-[#CBD5E1] bg-white p-5 text-center text-xs font-bold leading-5 text-[#64748B]">
                  {t('insights.empty')}
                </article>
              ) : null}

              {/* 기간별 수익 차트 — 일별/주별/월별 */}
              <article className="rounded-[20px] bg-white p-4 ring-1 ring-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black text-[#334155]">{t('insights.periodChart')}</p>
                  <div className="flex gap-1 rounded-full bg-[#F1F5F9] p-0.5">
                    {(['day', 'week', 'month'] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPeriod(p)}
                        className={`rounded-full px-2.5 py-1 text-[10px] font-black ${period === p ? 'bg-white text-[#0F172A] shadow-sm' : 'text-[#64748B]'}`}
                      >
                        {t(`insights.tab.${p}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-3 h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={series} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
                      <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                      <Tooltip content={<PiTooltip jobsUnit={t('insights.jobsUnit')} />} cursor={{ fill: '#F1F5F9' }} />
                      <Bar dataKey="netPi" name="netPi" radius={[4, 4, 0, 0]} fill={BLUE} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>

              {/* 서비스별 수익 구성 */}
              {data.byService.length ? (
                <article className="rounded-[20px] bg-white p-4 ring-1 ring-[#E2E8F0]">
                  <p className="text-xs font-black text-[#334155]">{t('insights.byService')}</p>
                  <ul className="mt-3 space-y-2.5">
                    {data.byService.map((row) => {
                      const share = serviceTotal > 0 ? Math.round((row.netPi / serviceTotal) * 100) : 0
                      return (
                        <li key={row.service}>
                          <div className="flex items-center justify-between text-[11px] font-black">
                            <span className="text-[#0F172A]">{row.label} <span className="font-bold text-[#94A3B8]">{row.jobs}{t('insights.jobsUnit')}</span></span>
                            <span className="tabular-nums text-[#0F172A]">{fmtPi(row.netPi)} Pi <span className="font-bold text-[#94A3B8]">{share}%</span></span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#F1F5F9]">
                            <div className="h-full rounded-full bg-[#4A82B8]" style={{ width: `${Math.max(2, share)}%` }} />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </article>
              ) : null}

              {/* 시간대별 인사이트 — 내 수익 + 플랫폼 콜 집중 */}
              <article className="rounded-[20px] bg-white p-4 ring-1 ring-[#E2E8F0]">
                <p className="text-xs font-black text-[#334155]">{t('insights.hourlyTitle')}</p>
                <p className="mt-1 text-[10px] font-bold leading-4 text-[#64748B]">{t('insights.hourlyHint')}</p>
                <div className="mt-3 h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.hourly} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                      <XAxis dataKey="hour" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval={2} tickFormatter={(h: number) => `${h}`} />
                      <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip content={<PiTooltip jobsUnit={t('insights.jobsUnit')} />} cursor={{ fill: '#F1F5F9' }} />
                      <Bar dataKey="jobs" name="jobs" radius={[3, 3, 0, 0]}>
                        {data.hourly.map((h) => (
                          <Cell key={h.hour} fill={h.hour === peakHour ? AMBER : BLUE_SOFT} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* 플랫폼 전체 콜 집중 시간대 */}
                <p className="mt-3 text-[10px] font-black text-[#64748B]">{t('insights.demandHourly')}</p>
                <div className="mt-2 h-24">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.demand.hourly} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                      <XAxis dataKey="hour" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval={2} />
                      <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip cursor={{ fill: '#F1F5F9' }} />
                      <Bar dataKey="jobs" name="jobs" radius={[3, 3, 0, 0]}>
                        {data.demand.hourly.map((h) => (
                          <Cell key={h.hour} fill={demandPeak.some((p) => p.hour === h.hour) ? AMBER : BLUE_SOFT} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>

              {/* 요일 패턴 */}
              <article className="rounded-[20px] bg-white p-4 ring-1 ring-[#E2E8F0]">
                <p className="text-xs font-black text-[#334155]">{t('insights.dowTitle')}</p>
                <div className="mt-3 h-24">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dow} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip cursor={{ fill: '#F1F5F9' }} />
                      <Bar dataKey="jobs" name="jobs" radius={[3, 3, 0, 0]} fill={BLUE} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>

              {/* 지역 인사이트 — 내 픽업 vs 플랫폼 콜 집중 */}
              <article className="rounded-[20px] bg-white p-4 ring-1 ring-[#E2E8F0]">
                <p className="flex items-center gap-1 text-xs font-black text-[#334155]"><MapPin className="h-3.5 w-3.5 text-[#4A82B8]" />{t('insights.regionTitle')}</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-black text-[#64748B]">{t('insights.myRegions')}</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {data.regions.length ? data.regions.slice(0, 5).map((r) => (
                        <li key={r.label} className="flex items-center justify-between rounded-xl bg-[#F8FAFC] px-2.5 py-1.5 text-[11px] font-black text-[#0F172A]">
                          <span className="min-w-0 truncate">{r.label}</span>
                          <span className="ml-1 shrink-0 tabular-nums text-[#4A82B8]">{r.jobs}</span>
                        </li>
                      )) : <li className="text-[11px] font-bold text-[#94A3B8]">—</li>}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-[#B45309]">{t('insights.demandRegions')}</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {data.demand.regions.length ? data.demand.regions.slice(0, 5).map((r) => (
                        <li key={r.label} className="flex items-center justify-between rounded-xl bg-[#FFFBEB] px-2.5 py-1.5 text-[11px] font-black text-[#0F172A]">
                          <span className="min-w-0 truncate">{r.label}</span>
                          <span className="ml-1 shrink-0 tabular-nums text-[#B45309]">{r.jobs}</span>
                        </li>
                      )) : <li className="text-[11px] font-bold text-[#94A3B8]">—</li>}
                    </ul>
                  </div>
                </div>
                <p className="mt-2 text-[9px] font-bold leading-4 text-[#94A3B8]">{t('insights.regionHint')}</p>
              </article>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
