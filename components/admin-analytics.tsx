'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'

type AnalyticsBucket = {
  at: string
  label: string
  calls: number
  matched: number
  cancelled: number
  unmatched: number
  gmv: number
  commission: number
  newUsers: number
}

type AnalyticsPayload = {
  range: { days: number; bucket: string; from: string; to: string }
  totals: {
    calls: number
    matched: number
    matchRate: number
    cancelled: number
    unmatched: number
    inFlight: number
    gmv: number
    commission: number
    net: number
    settleCount: number
    avgTicket: number
    newUsers: number
  }
  series: AnalyticsBucket[]
  byService: Record<string, { count: number; gross: number; commission: number }>
}

const RANGES = [
  { days: 1, label: '오늘' },
  { days: 7, label: '최근 7일' },
  { days: 30, label: '최근 30일' },
  { days: 90, label: '최근 90일' },
  { days: 365, label: '최근 1년' },
]

const BUCKETS = [
  { id: 'auto', label: '자동' },
  { id: 'day', label: '일별' },
  { id: 'week', label: '주별' },
  { id: 'month', label: '월별' },
]

const SERVICE_LABEL: Record<string, string> = {
  taxi: '택시',
  daeri: '대리운전',
  delivery: '택배',
  bicycle: '자전거',
  kickboard: '킥보드',
  ev: 'EV충전',
  parking: '주차',
}

const pi = (v: number) => `${v.toFixed(4)} Pi`

function BarChart({
  series,
  max,
  renderBar,
  height = 120,
}: {
  series: AnalyticsBucket[]
  max: number
  renderBar: (b: AnalyticsBucket, i: number) => { h: number; cls: string }[]
  height?: number
}) {
  const w = Math.max(series.length, 1)
  const slot = 100 / w
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-28 w-full">
      {series.map((b, i) =>
        renderBar(b, i).map((bar, j) => {
          const bw = slot * 0.7
          const x = i * slot + (slot - bw) / 2
          const h = max > 0 ? (bar.h / max) * (height - 14) : 0
          return (
            <rect
              key={`${i}-${j}`}
              x={x + j * (bw / renderBar(b, i).length)}
              y={height - 12 - h}
              width={bw / renderBar(b, i).length}
              height={Math.max(h, bar.h > 0 ? 1.5 : 0)}
              rx={1}
              className={bar.cls}
            />
          )
        }),
      )}
    </svg>
  )
}

function LineChart({ series, max, height = 120 }: { series: AnalyticsBucket[]; max: number; height?: number }) {
  if (!series.length) return null
  const w = Math.max(series.length - 1, 1)
  const pts = series.map((b, i) => `${(i / w) * 98 + 1},${height - 12 - (max > 0 ? (b.gmv / max) * (height - 16) : 0)}`)
  const area = `1,${height - 10} ${pts.join(' ')} 99,${height - 10}`
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-28 w-full">
      <polygon points={area} className="fill-[#DBEAFE]" />
      <polyline points={pts.join(' ')} fill="none" className="stroke-[#4A82B8]" strokeWidth={1.6} strokeLinejoin="round" />
      {series.map((b, i) => (
        <circle key={i} cx={(i / w) * 98 + 1} cy={height - 12 - (max > 0 ? (b.gmv / max) * (height - 16) : 0)} r={1.4} className="fill-[#1D4ED8]" />
      ))}
    </svg>
  )
}

/** 실시간 운영 지표·매출/콜 리포트 — 기간 + 집계 단위 필터, SVG 차트. */
export default function AdminAnalytics() {
  const [days, setDays] = useState(7)
  const [bucket, setBucket] = useState('auto')
  const [data, setData] = useState<AnalyticsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (d: number, b: string, silent = false) => {
    if (!silent) setLoading(true)
    const res = await fetch(`/api/admin/analytics?days=${d}&bucket=${b}`, { headers: adminHeaders(), cache: 'no-store' }).catch(() => null)
    const payload = (await res?.json().catch(() => null)) as (AnalyticsPayload & { error?: string }) | null
    if (payload?.range) {
      setData(payload)
      setError('')
    } else if (!silent) {
      setError('리포트를 불러오지 못했습니다.')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load(days, bucket)
    const timer = window.setInterval(() => void load(days, bucket, true), 30_000)
    return () => window.clearInterval(timer)
  }, [days, bucket, load])

  const t = data?.totals
  const series = data?.series ?? []
  const maxCalls = Math.max(1, ...series.map((b) => b.calls))
  const maxGmv = Math.max(0.0001, ...series.map((b) => b.gmv))
  const maxUsers = Math.max(1, ...series.map((b) => b.newUsers))
  const services = Object.entries(data?.byService ?? {})
    .map(([id, v]) => ({ id, label: SERVICE_LABEL[id] ?? id, ...v }))
    .filter((s) => s.gross > 0 || s.count > 0)
    .sort((a, b) => b.gross - a.gross)
  const maxServiceGross = Math.max(0.0001, ...services.map((s) => s.gross))

  const cards: { label: string; value: string; sub?: string; cls: string }[] = t
    ? [
        { label: '총 콜 수', value: `${t.calls}건`, sub: `매칭 ${t.matched} · 취소 ${t.cancelled} · 미배차 ${t.unmatched}`, cls: 'text-[#0F172A]' },
        { label: '매칭 성공률', value: `${t.matchRate}%`, sub: t.inFlight ? `진행 중 ${t.inFlight}건` : undefined, cls: 'text-[#15803D]' },
        { label: '총 거래액 (GMV)', value: pi(t.gmv), sub: `정산 ${t.settleCount}건 · 건당 ${pi(t.avgTicket)}`, cls: 'text-[#1D4ED8]' },
        { label: '플랫폼 수수료', value: pi(t.commission), sub: `기사 순지급 ${pi(t.net)}`, cls: 'text-[#4A82B8]' },
        { label: '신규 가입자', value: `${t.newUsers}명`, sub: '기간 내 Pi 연동 가입', cls: 'text-[#0F172A]' },
      ]
    : []

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-[#0F172A]">통계 · 매출/콜 리포트</h2>
          <p className="mt-0.5 text-[11px] font-bold text-[#94A3B8]">
            {data ? `${data.range.from.slice(0, 10)} ~ ${data.range.to.slice(0, 10)} · ${data.range.bucket === 'hour' ? '시간별' : data.range.bucket === 'day' ? '일별' : data.range.bucket === 'week' ? '주별' : '월별'} 집계 · 30초 자동 갱신` : '실제 콜·정산·가입 데이터 기반 집계'}
          </p>
        </div>
        <button type="button" onClick={() => void load(days, bucket)} className="rounded-full bg-[#4A82B8] px-3 py-2 text-xs font-black text-white shadow-[0_6px_14px_rgba(74,130,184,0.28)]">
          새로고침
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {RANGES.map((r) => (
          <button
            key={r.days}
            type="button"
            onClick={() => setDays(r.days)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-black ${days === r.days ? 'bg-[#4A82B8] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
          >
            {r.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-[#E2E8F0]" />
        {BUCKETS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBucket(b.id)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-black ${bucket === b.id ? 'bg-[#0F172A] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {error ? <p className="rounded-2xl border-2 border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-xs font-bold text-[#B91C1C]">{error}</p> : null}
      {loading ? <p className="rounded-2xl bg-[#F1F5F9] px-4 py-6 text-center text-xs font-bold text-[#64748B]">리포트를 집계하는 중…</p> : null}

      {t ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {cards.map((card) => (
              <div key={card.label} className="rounded-2xl border-2 border-[#E2E8F0] bg-white p-3.5">
                <p className="text-[10px] font-black text-[#94A3B8]">{card.label}</p>
                <p className={`mt-1 text-lg font-black ${card.cls}`}>{card.value}</p>
                {card.sub ? <p className="mt-0.5 text-[10px] font-bold leading-4 text-[#64748B]">{card.sub}</p> : null}
              </div>
            ))}
          </div>

          <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-black">콜 수 추이</p>
              <span className="flex items-center gap-3 text-[10px] font-bold text-[#64748B]">
                <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-[#BFDBFE]" /> 전체 콜</span>
                <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-[#4A82B8]" /> 매칭 성공</span>
              </span>
            </div>
            {series.length ? (
              <>
                <BarChart
                  series={series}
                  max={maxCalls}
                  renderBar={(b) => [
                    { h: b.calls, cls: 'fill-[#BFDBFE]' },
                    { h: b.matched, cls: 'fill-[#4A82B8]' },
                  ]}
                />
                <div className="mt-1 flex justify-between text-[9px] font-bold text-[#94A3B8]">
                  <span>{series[0]?.label}</span>
                  {series.length > 2 ? <span>{series[Math.floor(series.length / 2)]?.label}</span> : null}
                  <span>{series[series.length - 1]?.label}</span>
                </div>
              </>
            ) : (
              <p className="mt-4 rounded-xl bg-[#F8FAFC] px-3 py-6 text-center text-[11px] font-bold text-[#94A3B8]">기간 내 콜이 없습니다.</p>
            )}
          </section>

          <div className="grid gap-3 md:grid-cols-2">
            <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
              <p className="text-sm font-black">거래액(GMV) 추이</p>
              {series.length ? (
                <>
                  <LineChart series={series} max={maxGmv} />
                  <div className="mt-1 flex justify-between text-[9px] font-bold text-[#94A3B8]">
                    <span>{series[0]?.label}</span>
                    <span>{series[series.length - 1]?.label}</span>
                  </div>
                </>
              ) : (
                <p className="mt-4 rounded-xl bg-[#F8FAFC] px-3 py-6 text-center text-[11px] font-bold text-[#94A3B8]">기간 내 정산 건이 없습니다.</p>
              )}
            </section>
            <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
              <p className="text-sm font-black">신규 가입자 추이</p>
              {series.length ? (
                <>
                  <BarChart series={series} max={maxUsers} renderBar={(b) => [{ h: b.newUsers, cls: 'fill-[#4A82B8]' }]} />
                  <div className="mt-1 flex justify-between text-[9px] font-bold text-[#94A3B8]">
                    <span>{series[0]?.label}</span>
                    <span>{series[series.length - 1]?.label}</span>
                  </div>
                </>
              ) : (
                <p className="mt-4 rounded-xl bg-[#F8FAFC] px-3 py-6 text-center text-[11px] font-bold text-[#94A3B8]">기간 내 신규 가입이 없습니다.</p>
              )}
            </section>
          </div>

          <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
            <p className="text-sm font-black">서비스별 거래액</p>
            {services.length ? (
              <ul className="mt-3 space-y-2">
                {services.map((s) => (
                  <li key={s.id}>
                    <div className="flex items-center justify-between text-[11px] font-black">
                      <span className="text-[#334155]">{s.label} <span className="font-bold text-[#94A3B8]">{s.count}건</span></span>
                      <span className="text-[#0F172A]">{pi(s.gross)} <span className="font-bold text-[#64748B]">· 수수료 {pi(s.commission)}</span></span>
                    </div>
                    <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-[#F1F5F9]">
                      <div className="h-full rounded-full bg-[#4A82B8]" style={{ width: `${Math.max(2, (s.gross / maxServiceGross) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 rounded-xl bg-[#F8FAFC] px-3 py-6 text-center text-[11px] font-bold text-[#94A3B8]">기간 내 정산 건이 없습니다.</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
