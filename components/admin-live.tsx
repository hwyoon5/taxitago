'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'

type Presence = { passenger: number; driver: number; partner: number }

type LiveRide = {
  id: string
  kind: 'taxi' | 'daeri'
  status: string
  passengerId: string
  pickup: string
  dest: string
  estimatedFare: number
  driver: { id: string; name: string; vehicle: string; plate: string } | null
  offerExpiresAt: string | null
  createdAt: string
  updatedAt: string
}

type MobilityBucket = { total: number; rented: number; idle: number; active: number; other: number }

type LiveSnapshot = {
  ok: boolean
  generatedAt: string
  presence: Presence
  matching: {
    searching: number
    offered: number
    assigned: number
    driversOnline: number
    driversBusy: number
  }
  rides: LiveRide[]
  mobility: { bicycle: MobilityBucket; kickboard: MobilityBucket }
  presenceWindowMs: number
}

type Sample = Presence & { at: number }

const POLL_MS = 8_000
const MAX_SAMPLES = 45 // 8s 간격 × 45 ≈ 최근 6분 추이

const ROLE_META: { key: keyof Presence; label: string; color: string; soft: string }[] = [
  { key: 'passenger', label: '이용자(승객)', color: '#4A82B8', soft: '#E8F1FA' },
  { key: 'driver', label: '기사', color: '#0D9488', soft: '#E6F7F4' },
  { key: 'partner', label: '파트너', color: '#D97706', soft: '#FEF3E2' },
]

const RIDE_STATUS: Record<string, { label: string; cls: string }> = {
  searching: { label: '매칭 대기', cls: 'bg-[#FEF3C7] text-[#92400E]' },
  offered: { label: '배차 제안 중', cls: 'bg-[#DBEAFE] text-[#1D4ED8]' },
  assigned: { label: '이용 중', cls: 'bg-[#DCFCE7] text-[#15803D]' },
}

const fmtAgo = (iso: string) => {
  const diff = Date.now() - Date.parse(iso || '')
  if (!Number.isFinite(diff) || diff < 0) return '방금'
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}초 전`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
  return `${Math.floor(diff / 3_600_000)}시간 전`
}

const fmtTime = (iso: string) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''
}

/** 역할별 접속자 추이를 그리는 간단 SVG 라인 차트 — 외부 차트 라이브러리 없이 구현. */
function PresenceChart({ history }: { history: Sample[] }) {
  const W = 600
  const H = 140
  const PAD = 8
  const maxVal = Math.max(1, ...history.flatMap((s) => [s.passenger, s.driver, s.partner]))
  const xAt = (i: number) => (history.length <= 1 ? W / 2 : PAD + (i / (history.length - 1)) * (W - PAD * 2))
  const yAt = (v: number) => H - PAD - (v / maxVal) * (H - PAD * 2)
  const pathFor = (key: keyof Presence) =>
    history.map((s, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(s[key]).toFixed(1)}`).join(' ')
  const grid = [0.25, 0.5, 0.75, 1]
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" role="img" aria-label="역할별 접속자 추이">
        {grid.map((g) => (
          <line key={g} x1={PAD} x2={W - PAD} y1={yAt(maxVal * g)} y2={yAt(maxVal * g)} stroke="#E2E8F0" strokeDasharray="4 4" strokeWidth="1" />
        ))}
        <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="#CBD5E1" strokeWidth="1" />
        {ROLE_META.map((role) =>
          history.length >= 2 ? (
            <path key={role.key} d={pathFor(role.key)} fill="none" stroke={role.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          ) : null,
        )}
        {history.length ? (
          ROLE_META.map((role) => {
            const last = history[history.length - 1]
            return <circle key={role.key} cx={xAt(history.length - 1)} cy={yAt(last[role.key])} r="3.5" fill={role.color} />
          })
        ) : null}
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-[#94A3B8]">
        <div className="flex items-center gap-3">
          {ROLE_META.map((role) => (
            <span key={role.key} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: role.color }} />
              {role.label}
            </span>
          ))}
        </div>
        <span>{history.length >= 2 ? '← 최근 약 6분 · 지금 →' : '표본 수집 중…'}</span>
      </div>
    </div>
  )
}

export default function AdminLiveDashboard() {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null)
  const [history, setHistory] = useState<Sample[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const timerRef = useRef<number | null>(null)

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setRefreshing(true)
    try {
      const res = await fetch('/api/admin/live', { headers: adminHeaders(), cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as LiveSnapshot | null
      if (!res.ok || !data?.ok) throw new Error(data ? 'request_failed' : 'bad_response')
      setSnap(data)
      setHistory((prev) => [...prev, { at: Date.now(), ...data.presence }].slice(-MAX_SAMPLES))
      setError('')
    } catch {
      setError('실시간 현황을 불러오지 못했습니다. 잠시 후 다시 시도합니다.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
    timerRef.current = window.setInterval(() => void load(true), POLL_MS)
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
    }
  }, [load])

  const presence = snap?.presence ?? { passenger: 0, driver: 0, partner: 0 }
  const total = presence.passenger + presence.driver + presence.partner
  const matching = snap?.matching

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-[#0F172A]">실시간 접속 · 매칭 현황</h2>
          <p className="mt-0.5 text-[11px] font-bold text-[#94A3B8]">
            앱 접속 하트비트 기준(90초 윈도) · {POLL_MS / 1000}초마다 자동 갱신
            {snap ? ` · 마지막 갱신 ${fmtTime(snap.generatedAt)}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(false)}
          disabled={refreshing}
          className="rounded-full bg-[#4A82B8] px-3 py-2 text-xs font-black text-white shadow-[0_6px_14px_rgba(74,130,184,0.28)] disabled:opacity-60"
        >
          {refreshing ? '갱신 중…' : '새로고침'}
        </button>
      </div>

      {error ? <p className="rounded-2xl border-2 border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-xs font-bold text-[#B91C1C]">{error}</p> : null}
      {loading ? <p className="rounded-2xl bg-[#F1F5F9] px-4 py-6 text-center text-xs font-bold text-[#64748B]">실시간 데이터를 불러오는 중…</p> : null}

      {!loading ? (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {ROLE_META.map((role) => (
              <div key={role.key} className="rounded-2xl border-2 p-4" style={{ borderColor: role.color, background: role.soft }}>
                <p className="text-[11px] font-black" style={{ color: role.color }}>{role.label}</p>
                <p className="mt-1 text-3xl font-black text-[#0F172A]">{presence[role.key]}</p>
                <p className="mt-0.5 text-[10px] font-bold text-[#64748B]">명 접속 중</p>
              </div>
            ))}
            <div className="rounded-2xl border-2 border-[#0F172A] bg-[#0F172A] p-4">
              <p className="text-[11px] font-black text-[#93C5FD]">전체 접속자</p>
              <p className="mt-1 text-3xl font-black text-white">{total}</p>
              <p className="mt-0.5 text-[10px] font-bold text-[#94A3B8]">세 역할 합계</p>
            </div>
          </section>

          <section className="rounded-2xl border-2 border-[#E2E8F0] bg-white p-4">
            <h3 className="text-xs font-black text-[#334155]">접속자 수 추이</h3>
            <div className="mt-2">
              <PresenceChart history={history} />
            </div>
          </section>

          <section className="rounded-2xl border-2 border-[#E2E8F0] bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black text-[#334155]">서비스 매칭 현황</h3>
              {matching ? (
                <span className="text-[10px] font-bold text-[#94A3B8]">
                  영업 중 기사 {matching.driversOnline}명 · 운행 중 {matching.driversBusy}명
                </span>
              ) : null}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-[#FEF3C7] px-3 py-3 text-center">
                <p className="text-xl font-black text-[#92400E]">{matching?.searching ?? 0}</p>
                <p className="text-[10px] font-black text-[#92400E]">매칭 대기</p>
              </div>
              <div className="rounded-xl bg-[#DBEAFE] px-3 py-3 text-center">
                <p className="text-xl font-black text-[#1D4ED8]">{matching?.offered ?? 0}</p>
                <p className="text-[10px] font-black text-[#1D4ED8]">배차 제안 중</p>
              </div>
              <div className="rounded-xl bg-[#DCFCE7] px-3 py-3 text-center">
                <p className="text-xl font-black text-[#15803D]">{matching?.assigned ?? 0}</p>
                <p className="text-[10px] font-black text-[#15803D]">이용 중</p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {snap?.rides.length ? (
                snap.rides.map((ride) => {
                  const status = RIDE_STATUS[ride.status] ?? { label: ride.status, cls: 'bg-[#F1F5F9] text-[#475569]' }
                  return (
                    <div key={ride.id} className="rounded-xl border border-[#E2E8F0] px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded-full bg-[#E8F1FA] px-2 py-0.5 text-[10px] font-black text-[#4A82B8]">
                            {ride.kind === 'daeri' ? '대리운전' : '택시 호출'}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${status.cls}`}>{status.label}</span>
                        </div>
                        <span className="text-[10px] font-bold text-[#94A3B8]">{fmtAgo(ride.updatedAt)}</span>
                      </div>
                      <p className="mt-1.5 truncate text-xs font-bold text-[#0F172A]">
                        {ride.pickup || '출발지 미상'} <span className="text-[#94A3B8]">→</span> {ride.dest || '목적지 미상'}
                      </p>
                      <p className="mt-1 text-[10px] font-bold text-[#64748B]">
                        승객 {ride.passengerId.slice(0, 10)}
                        {ride.driver ? ` · 기사 ${ride.driver.name}${ride.driver.plate ? ` (${ride.driver.plate})` : ''}` : ' · 기사 미배정'}
                        {ride.estimatedFare ? ` · 예상 ${ride.estimatedFare} Pi` : ''}
                      </p>
                    </div>
                  )
                })
              ) : (
                <p className="rounded-xl bg-[#F8FAFC] px-3 py-4 text-center text-[11px] font-bold text-[#94A3B8]">
                  현재 진행 중이거나 매칭 대기 중인 호출이 없습니다.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border-2 border-[#E2E8F0] bg-white p-4">
            <h3 className="text-xs font-black text-[#334155]">공유 모빌리티 대여 현황</h3>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(['bicycle', 'kickboard'] as const).map((type) => {
                const row = snap?.mobility[type]
                const label = type === 'bicycle' ? '자전거' : '킥보드'
                return (
                  <div key={type} className="rounded-xl bg-[#F8FAFC] px-3 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-black text-[#334155]">{label}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${row?.rented ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#F1F5F9] text-[#64748B]'}`}>
                        {row?.rented ?? 0}대 이용 중
                      </span>
                    </div>
                    <p className="mt-1.5 text-[10px] font-bold text-[#64748B]">
                      등록 {row?.total ?? 0}대 · 대여 가능 {((row?.idle ?? 0) + (row?.active ?? 0))}대
                      {row?.other ? ` · 기타 ${row.other}대` : ''}
                    </p>
                  </div>
                )
              })}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
