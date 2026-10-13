'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import { BUSAN_CITY_HALL } from '@/lib/user-location'
import {
  createNaverLatLng,
  loadNaverMaps,
  type NaverMapInstance,
  type NaverMapsSdk,
  type NaverMarker,
} from '@/lib/naver-maps'

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

type TrackedDriver = {
  id: string
  name: string
  vehicle: string
  plate: string
  duty: string
  rideStatus: string | null
  rideKind: 'taxi' | 'daeri' | null
  lat: number
  lng: number
  lastSeenAt: string
}

type TrackedUser = {
  id: string
  role: 'passenger' | 'partner'
  rideStatus: string | null
  rideKind: 'taxi' | 'daeri' | null
  lat: number | null
  lng: number | null
  lastSeenAt: string
}

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
  tracking: { drivers: TrackedDriver[]; users: TrackedUser[] }
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

const DRIVER_STATUS: Record<string, { label: string; cls: string }> = {
  online: { label: '대기 중', cls: 'bg-[#DBEAFE] text-[#1D4ED8]' },
  busy: { label: '운행 중', cls: 'bg-[#DCFCE7] text-[#15803D]' },
  offline: { label: '오프라인', cls: 'bg-[#F1F5F9] text-[#64748B]' },
}
const USER_STATUS: Record<string, { label: string; cls: string }> = {
  searching: { label: '호출 대기', cls: 'bg-[#FEF3C7] text-[#92400E]' },
  offered: { label: '배차 제안 중', cls: 'bg-[#DBEAFE] text-[#1D4ED8]' },
  assigned: { label: '이용 중', cls: 'bg-[#DCFCE7] text-[#15803D]' },
}
const USER_ROLE: Record<TrackedUser['role'], { label: string; cls: string }> = {
  passenger: { label: '승객', cls: 'bg-[#E8F1FA] text-[#4A82B8]' },
  partner: { label: '파트너', cls: 'bg-[#FEF3E2] text-[#D97706]' },
}

type RegionKey = 'all' | 'metro' | 'gangwon' | 'chungcheong' | 'jeolla' | 'gyeongbuk' | 'gyeongnam' | 'jeju'
type RegionBounds = { minLat: number; maxLat: number; minLng: number; maxLng: number }
const REGIONS: { key: RegionKey; label: string; bounds?: RegionBounds }[] = [
  { key: 'all', label: '전체 보기' },
  { key: 'metro', label: '수도권', bounds: { minLat: 36.8, maxLat: 38.3, minLng: 126.3, maxLng: 127.9 } },
  { key: 'gangwon', label: '강원', bounds: { minLat: 37.0, maxLat: 38.7, minLng: 127.7, maxLng: 129.6 } },
  { key: 'chungcheong', label: '충청', bounds: { minLat: 35.9, maxLat: 37.1, minLng: 126.9, maxLng: 128.5 } },
  { key: 'jeolla', label: '전라', bounds: { minLat: 34.3, maxLat: 36.1, minLng: 125.9, maxLng: 128.0 } },
  { key: 'gyeongbuk', label: '대구·경북', bounds: { minLat: 35.5, maxLat: 37.6, minLng: 128.0, maxLng: 129.6 } },
  { key: 'gyeongnam', label: '부산·경남', bounds: { minLat: 34.5, maxLat: 35.9, minLng: 127.6, maxLng: 129.4 } },
  { key: 'jeju', label: '제주', bounds: { minLat: 33.0, maxLat: 33.6, minLng: 126.1, maxLng: 127.0 } },
]
const regionBounds = (key: RegionKey) => REGIONS.find((r) => r.key === key)?.bounds ?? null
const regionLabel = (key: RegionKey) => REGIONS.find((r) => r.key === key)?.label ?? ''
/** 권역 필터 — '전체 보기'는 전원 표시, 특정 권역은 경계 상자 안 좌표만(좌표 미보고자는 제외). */
const inRegionBounds = (lat: number | null | undefined, lng: number | null | undefined, b: RegionBounds | null) =>
  !b ? true : lat != null && lng != null && lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng

/** 역지오코딩 캐시 키 — 3자리 반올림으로 약 100m 그리드 안 이동은 같은 주소로 재사용한다. */
const coordKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`

/** 전체 주소를 시/도 · 시/군/구 · 동/읍/면(또는 도로명) 수준으로 축약 — 번지·건물번호 등 숫자 토큰부터 자른다. */
function shortenAddress(address: string) {
  const tokens = address.trim().split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (const token of tokens) {
    if (out.length && /\d/.test(token)) break
    out.push(token)
    if (out.length >= 3) break
  }
  return out.join(' ')
}

/** 기사·승객 좌표를 스캐터 플롯으로 그리는 간단 관제 맵 — 지도 SDK 로드 실패 시 폴백. */
function TrackingScatter({ drivers, users }: { drivers: TrackedDriver[]; users: TrackedUser[] }) {
  const W = 600
  const H = 260
  const PAD = 26
  const points = [
    ...drivers.map((d) => ({ lat: d.lat, lng: d.lng })),
    ...users.filter((u) => u.lat != null && u.lng != null).map((u) => ({ lat: u.lat as number, lng: u.lng as number })),
  ]
  if (!points.length) {
    return (
      <p className="rounded-xl bg-[#F8FAFC] px-3 py-8 text-center text-[11px] font-bold text-[#94A3B8]">
        위치가 보고된 접속자가 없습니다.
      </p>
    )
  }
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const minLat = Math.min(...lats) - 0.004
  const maxLat = Math.max(...lats) + 0.004
  const minLng = Math.min(...lngs) - 0.006
  const maxLng = Math.max(...lngs) + 0.006
  const xAt = (lng: number) => PAD + ((lng - minLng) / Math.max(0.0001, maxLng - minLng)) * (W - PAD * 2)
  const yAt = (lat: number) => H - PAD - ((lat - minLat) / Math.max(0.0001, maxLat - minLat)) * (H - PAD * 2)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full rounded-xl bg-[#F8FAFC]" role="img" aria-label="실시간 위치 관제 지도">
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={`h${g}`} x1={PAD} x2={W - PAD} y1={H - PAD - g * (H - PAD * 2)} y2={H - PAD - g * (H - PAD * 2)} stroke="#E2E8F0" strokeDasharray="4 4" strokeWidth="1" />
        ))}
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={`v${g}`} y1={PAD} y2={H - PAD} x1={PAD + g * (W - PAD * 2)} x2={PAD + g * (W - PAD * 2)} stroke="#E2E8F0" strokeDasharray="4 4" strokeWidth="1" />
        ))}
        <rect x={PAD} y={PAD} width={W - PAD * 2} height={H - PAD * 2} fill="none" stroke="#CBD5E1" strokeWidth="1" />
        {users.map((u) =>
          u.lat != null && u.lng != null ? (
            <circle key={u.id} cx={xAt(u.lng)} cy={yAt(u.lat)} r="5" fill={u.role === 'partner' ? '#D97706' : '#4A82B8'} fillOpacity="0.75" stroke="#fff" strokeWidth="1.5" />
          ) : null,
        )}
        {drivers.map((d) => (
          <g key={d.id}>
            <circle cx={xAt(d.lng)} cy={yAt(d.lat)} r="7" fill={d.duty === 'busy' ? '#15803D' : '#0D9488'} stroke="#fff" strokeWidth="2" />
            <text x={xAt(d.lng)} y={yAt(d.lat) - 11} textAnchor="middle" fontSize="9" fontWeight="800" fill="#0F172A">
              {d.name}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex items-center gap-3 text-[10px] font-bold text-[#94A3B8]">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#0D9488]" />기사 대기</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#15803D]" />기사 운행</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#4A82B8]" />승객</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#D97706]" />파트너</span>
        <span className="ml-auto">위도 {minLat.toFixed(3)}~{maxLat.toFixed(3)} · 경도 {minLng.toFixed(3)}~{maxLng.toFixed(3)}</span>
      </div>
    </div>
  )
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

type SelectedPin = { kind: 'driver' | 'user'; id: string }

const PIN_STYLE: Record<string, { dot: string; ring: string }> = {
  driverIdle: { dot: '#0D9488', ring: 'rgba(13,148,136,0.25)' },
  driverBusy: { dot: '#15803D', ring: 'rgba(21,128,61,0.25)' },
  passenger: { dot: '#4A82B8', ring: 'rgba(74,130,184,0.25)' },
  partner: { dot: '#D97706', ring: 'rgba(217,119,6,0.25)' },
}

function pinElement(style: { dot: string; ring: string }, label?: string) {
  const el = document.createElement('div')
  el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:auto;cursor:pointer'
  const dot = document.createElement('div')
  dot.style.cssText = `width:16px;height:16px;border-radius:9999px;background:${style.dot};border:2.5px solid #fff;box-shadow:0 0 0 5px ${style.ring},0 2px 6px rgba(15,23,42,0.35)`
  el.appendChild(dot)
  if (label) {
    const tag = document.createElement('div')
    tag.style.cssText =
      'margin-top:2px;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:9999px;background:rgba(15,23,42,0.85);color:#fff;padding:1px 6px;font-size:9px;font-weight:800;line-height:14px'
    tag.textContent = label
    el.appendChild(tag)
  }
  return el
}

/** 실제 지도 기반 실시간 관제 — Naver Maps 위에 기사·승객 마커를 폴링 갱신한다. */
function TrackingMap({
  drivers,
  users,
  region,
  onRegionChange,
  areaOf,
}: {
  drivers: TrackedDriver[]
  users: TrackedUser[]
  region: RegionKey
  onRegionChange: (key: RegionKey) => void
  areaOf: (lat: number | null | undefined, lng: number | null | undefined) => string
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<NaverMapInstance | null>(null)
  const sdkRef = useRef<NaverMapsSdk | null>(null)
  const markersRef = useRef<Map<string, { marker: NaverMarker; el: HTMLElement }>>(new Map())
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<SelectedPin | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const sdk = await loadNaverMaps()
      if (!alive) return
      if (!sdk || !canvasRef.current) {
        setFailed(true)
        return
      }
      sdkRef.current = sdk
      const center = createNaverLatLng(sdk, BUSAN_CITY_HALL.lat, BUSAN_CITY_HALL.lng)
      mapRef.current = new sdk.Map(canvasRef.current, {
        center,
        zoom: 12,
        minZoom: 5,
        maxZoom: 19,
        scaleControl: false,
        mapDataControl: false,
        logoControlOptions: { position: 3 },
      })
      setReady(true)
    })()
    return () => {
      alive = false
      for (const { marker } of markersRef.current.values()) marker.setMap(null)
      markersRef.current.clear()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const sdk = sdkRef.current
    const map = mapRef.current
    if (!sdk || !map || !ready) return
    const markers = markersRef.current
    const seen = new Set<string>()
    const upsert = (key: string, lat: number, lng: number, kind: keyof typeof PIN_STYLE, label: string, sel: SelectedPin) => {
      seen.add(key)
      const position = createNaverLatLng(sdk, lat, lng)
      if (!position) return
      const existing = markers.get(key)
      if (existing) {
        existing.marker.setPosition(position)
        const dot = existing.el.firstElementChild as HTMLElement | null
        if (dot) {
          dot.style.background = PIN_STYLE[kind].dot
          dot.style.boxShadow = `0 0 0 5px ${PIN_STYLE[kind].ring},0 2px 6px rgba(15,23,42,0.35)`
        }
        return
      }
      const el = pinElement(PIN_STYLE[kind], label)
      const marker = new sdk.Marker({
        map,
        position,
        clickable: true,
        icon: { content: el },
        title: label,
      })
      sdk.Event.addListener(marker, 'click', () => setSelected(sel))
      markers.set(key, { marker, el })
    }
    for (const driver of drivers) {
      upsert(`d-${driver.id}`, driver.lat, driver.lng, driver.duty === 'busy' ? 'driverBusy' : 'driverIdle', driver.name, { kind: 'driver', id: driver.id })
    }
    for (const user of users) {
      if (user.lat == null || user.lng == null) continue
      upsert(`u-${user.role}-${user.id}`, user.lat, user.lng, user.role === 'partner' ? 'partner' : 'passenger', '', { kind: 'user', id: `${user.role}-${user.id}` })
    }
    for (const [key, item] of markers) {
      if (!seen.has(key)) {
        item.marker.setMap(null)
        markers.delete(key)
      }
    }
  }, [drivers, users, ready])

  const fitAll = () => {
    const sdk = sdkRef.current
    const map = mapRef.current
    if (!sdk || !map) return
    const pts = [
      ...drivers.map((d) => ({ lat: d.lat, lng: d.lng })),
      ...users.filter((u) => u.lat != null && u.lng != null).map((u) => ({ lat: u.lat as number, lng: u.lng as number })),
    ]
    if (!pts.length) return
    const sw = createNaverLatLng(sdk, Math.min(...pts.map((p) => p.lat)), Math.min(...pts.map((p) => p.lng)))
    const ne = createNaverLatLng(sdk, Math.max(...pts.map((p) => p.lat)), Math.max(...pts.map((p) => p.lng)))
    if (sw && ne && typeof sdk.LatLngBounds === 'function' && map.fitBounds) {
      map.fitBounds(new sdk.LatLngBounds(sw, ne), { top: 50, right: 50, bottom: 50, left: 50 })
      return
    }
    const center = createNaverLatLng(sdk, pts[0].lat, pts[0].lng)
    if (center) map.setCenter(center)
  }

  /** 권역 칩 클릭 — 해당 경계 상자로 fitBounds, '전체 보기'는 활성 마커 전체를 포함. */
  const panToRegion = (key: RegionKey) => {
    const sdk = sdkRef.current
    const map = mapRef.current
    if (!sdk || !map) return
    const b = regionBounds(key)
    if (!b) {
      fitAll()
      return
    }
    const sw = createNaverLatLng(sdk, b.minLat, b.minLng)
    const ne = createNaverLatLng(sdk, b.maxLat, b.maxLng)
    if (sw && ne && typeof sdk.LatLngBounds === 'function' && map.fitBounds) {
      map.fitBounds(new sdk.LatLngBounds(sw, ne), { top: 64, right: 30, bottom: 30, left: 30 })
      return
    }
    const center = createNaverLatLng(sdk, (b.minLat + b.maxLat) / 2, (b.minLng + b.maxLng) / 2)
    if (center) map.setCenter(center)
  }

  if (failed) return <TrackingScatter drivers={drivers} users={users} />

  const selectedDriver = selected?.kind === 'driver' ? drivers.find((d) => d.id === selected.id) : null
  const selectedUser = selected?.kind === 'user' ? users.find((u) => `${u.role}-${u.id}` === selected.id) : null
  const selectedArea = selectedDriver
    ? areaOf(selectedDriver.lat, selectedDriver.lng)
    : selectedUser
      ? areaOf(selectedUser.lat, selectedUser.lng)
      : ''

  return (
    <div>
      <div className="relative overflow-hidden rounded-xl border border-[#E2E8F0]">
        <div ref={canvasRef} className="h-72 w-full bg-[#F8FAFC] lg:h-[520px]" />
        {!ready ? (
          <p className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-[#94A3B8]">지도를 불러오는 중…</p>
        ) : null}
        <div className="absolute left-2 right-2 top-2 flex gap-1.5 overflow-x-auto pb-1">
          {REGIONS.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => {
                panToRegion(r.key)
                onRegionChange(r.key)
              }}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black shadow-md ${
                region === r.key ? 'bg-[#4A82B8] text-white' : 'bg-white/95 text-[#334155] hover:bg-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {selectedDriver || selectedUser ? (
          <div className="absolute bottom-2 left-2 right-2 rounded-xl bg-white/95 p-3 shadow-lg sm:right-auto sm:min-w-[240px]">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-black text-[#0F172A]">
                {selectedDriver ? `${selectedDriver.name} · 기사` : `${selectedUser?.role === 'partner' ? '파트너' : '승객'} ${selectedUser?.id}`}
              </p>
              <button type="button" onClick={() => setSelected(null)} className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-black text-[#64748B]">
                닫기
              </button>
            </div>
            <p className="mt-1 text-[10px] font-bold text-[#64748B]">
              {selectedArea ? `${selectedArea} · ` : ''}
              {selectedDriver
                ? `${selectedDriver.vehicle || '차량 미등록'}${selectedDriver.plate ? ` · ${selectedDriver.plate}` : ''} · ${
                    selectedDriver.rideStatus === 'offered' ? '호출 제안 중' : (DRIVER_STATUS[selectedDriver.duty] ?? DRIVER_STATUS.offline).label
                  } · ${selectedDriver.lat.toFixed(4)}, ${selectedDriver.lng.toFixed(4)} · ${fmtAgo(selectedDriver.lastSeenAt)}`
                : selectedUser
                  ? `${(selectedUser.rideStatus ? USER_STATUS[selectedUser.rideStatus]?.label : null) ?? '접속 중'} · ${
                      selectedUser.lat != null ? `${selectedUser.lat.toFixed(4)}, ${selectedUser.lng?.toFixed(4)}` : '위치 미보고'
                    } · ${fmtAgo(selectedUser.lastSeenAt)}`
                  : ''}
            </p>
          </div>
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-3 text-[10px] font-bold text-[#94A3B8]">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#0D9488]" />기사 대기</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#15803D]" />기사 운행</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#4A82B8]" />승객</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#D97706]" />파트너</span>
        <span className="ml-auto">지도 드래그·줌으로 이동/확대 · 마커 클릭 시 상세</span>
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

  const [region, setRegion] = useState<RegionKey>('all')
  const rb = regionBounds(region)
  const trackDrivers = (snap?.tracking?.drivers ?? []).filter((d) => inRegionBounds(d.lat, d.lng, rb))
  const trackUsers = (snap?.tracking?.users ?? []).filter((u) => inRegionBounds(u.lat, u.lng, rb))

  // 역지오코딩 주소 캐시 — 좌표를 100m 그리드로 묶어 중복 조회를 막는다.
  const [areas, setAreas] = useState<Record<string, string>>({})
  const areaPendingRef = useRef<Set<string>>(new Set())
  const trackingPoints = [
    ...(snap?.tracking?.drivers ?? []).map((d) => ({ lat: d.lat, lng: d.lng })),
    ...(snap?.tracking?.users ?? [])
      .filter((u) => u.lat != null && u.lng != null)
      .map((u) => ({ lat: u.lat as number, lng: u.lng as number })),
  ]
  const trackingPointsKey = trackingPoints.map((p) => coordKey(p.lat, p.lng)).join('|')
  const trackingPointsRef = useRef<{ lat: number; lng: number }[]>([])
  trackingPointsRef.current = trackingPoints

  useEffect(() => {
    const missing = new Map<string, { lat: number; lng: number }>()
    for (const p of trackingPointsRef.current) {
      const key = coordKey(p.lat, p.lng)
      if (!(key in areas) && !areaPendingRef.current.has(key)) missing.set(key, p)
    }
    if (!missing.size) return
    let alive = true
    const queue = [...missing.entries()]
    const worker = async () => {
      for (;;) {
        const next = queue.shift()
        if (!next || !alive) return
        const [key, p] = next
        areaPendingRef.current.add(key)
        try {
          const res = await fetch(`/api/geocode?lat=${p.lat}&lng=${p.lng}`, { cache: 'no-store' })
          const data = (await res.json().catch(() => null)) as { address?: string } | null
          const label = data?.address && !/찾을 수 없습니다/.test(data.address) ? shortenAddress(data.address) : ''
          setAreas((prev) => (key in prev ? prev : { ...prev, [key]: label }))
        } catch {
          setAreas((prev) => (key in prev ? prev : { ...prev, [key]: '' }))
        } finally {
          areaPendingRef.current.delete(key)
        }
      }
    }
    void Promise.all([worker(), worker(), worker()])
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingPointsKey])

  const areaLabel = (lat: number | null | undefined, lng: number | null | undefined) =>
    lat == null || lng == null ? '' : areas[coordKey(lat, lng)] || ''

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

          <section className="rounded-2xl border-2 border-[#0D9488] bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black text-[#334155]">실시간 위치 관제</h3>
              <span className="text-[10px] font-bold text-[#94A3B8]">
                {rb ? `${regionLabel(region)} · ` : ''}기사 {trackDrivers.length}명 · 승객/파트너 {trackUsers.length}명
              </span>
            </div>
            <div className="mt-2">
              <TrackingMap drivers={trackDrivers} users={trackUsers} region={region} onRegionChange={setRegion} areaOf={areaLabel} />
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-[11px] font-black text-[#0D9488]">접속 중인 기사</p>
                {trackDrivers.length ? (
                  trackDrivers.map((driver) => {
                    const status = DRIVER_STATUS[driver.duty] ?? DRIVER_STATUS.offline
                    return (
                      <div key={driver.id} className="rounded-xl border border-[#E2E8F0] px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-black text-[#0F172A]">
                            {driver.name}
                            {driver.plate ? <span className="font-bold text-[#64748B]"> · {driver.plate}</span> : null}
                          </p>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${status.cls}`}>
                            {driver.rideStatus === 'offered' ? '호출 제안 중' : status.label}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] font-bold text-[#64748B]">
                          {driver.vehicle ? `${driver.vehicle} · ` : ''}
                          {(() => {
                            const area = areaLabel(driver.lat, driver.lng)
                            return area ? `${area} · ` : ''
                          })()}
                          {driver.lat.toFixed(4)}, {driver.lng.toFixed(4)} · {fmtAgo(driver.lastSeenAt)}
                          {driver.rideStatus === 'assigned' ? ` · ${driver.rideKind === 'daeri' ? '대리운전' : '택시'} 운행` : ''}
                        </p>
                      </div>
                    )
                  })
                ) : (
                  <p className="rounded-xl bg-[#F8FAFC] px-3 py-4 text-center text-[11px] font-bold text-[#94A3B8]">
                    {rb ? '이 권역에 접속 중인 기사가 없습니다.' : '접속 중인 기사가 없습니다.'}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-black text-[#4A82B8]">접속 중인 승객 · 파트너</p>
                {trackUsers.length ? (
                  trackUsers.map((user) => {
                    const status = user.rideStatus ? USER_STATUS[user.rideStatus] : null
                    const role = USER_ROLE[user.role]
                    return (
                      <div key={`${user.role}-${user.id}`} className="rounded-xl border border-[#E2E8F0] px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${role.cls}`}>{role.label}</span>
                            <p className="truncate text-xs font-black text-[#0F172A]">{user.id}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${status?.cls ?? 'bg-[#F1F5F9] text-[#64748B]'}`}>
                            {status?.label ?? '접속 중'}
                          </span>
                        </div>
                        <p className="mt-1 text-[10px] font-bold text-[#64748B]">
                          {user.lat != null && user.lng != null
                            ? `${areaLabel(user.lat, user.lng) ? `${areaLabel(user.lat, user.lng)} · ` : ''}${user.lat.toFixed(4)}, ${user.lng.toFixed(4)}`
                            : '위치 미보고'}{' '}
                          · {fmtAgo(user.lastSeenAt)}
                          {user.rideKind ? ` · ${user.rideKind === 'daeri' ? '대리운전' : '택시'}` : ''}
                        </p>
                      </div>
                    )
                  })
                ) : (
                  <p className="rounded-xl bg-[#F8FAFC] px-3 py-4 text-center text-[11px] font-bold text-[#94A3B8]">
                    {rb ? '이 권역에 접속 중인 승객·파트너가 없습니다.' : '접속 중인 승객·파트너가 없습니다.'}
                  </p>
                )}
              </div>
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
