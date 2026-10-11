'use client'

import { useCallback, useEffect, useState } from 'react'
import { Briefcase, FileSpreadsheet, Link2, MonitorSmartphone, RefreshCw, Store, Trash2 } from 'lucide-react'
import PartnerStatSheet from '@/components/partner-stat-sheet'
import { MobilityDeviceFormModal } from '@/components/mobility-device-form'
import { PartnerFeedsPanel } from '@/components/partner-feeds-panel'
import { SafeBoundary } from '@/components/safe-boundary'
import {
  deleteMobilityDevice,
  fetchMyMobilityDevices,
  fetchMyPartnerFeeds,
  MOBILITY_STATUS_LABEL,
  updateMyMobilityDevice,
  type MobilityDevice,
  type MobilityDeviceStatus,
  type PartnerFeedInfo,
} from '@/lib/mobility-devices'
import PartnerProfileEditModal from '@/components/partner-profile-edit'
import { loadPartnerProfile, loadPiIdentity, type PartnerProfile, type PiIdentity } from '@/lib/partner-account'

const statusTone = (status: MobilityDeviceStatus) =>
  status === 'available' ? 'bg-[#ECFDF5] text-[#047857]'
    : status === 'rented' ? 'bg-[#DBEAFE] text-[#1D4ED8]'
    : status === 'low_battery' ? 'bg-[#FEF3C7] text-[#B45309]'
    : 'bg-[#FFF1F2] text-[#BE123C]'

const batteryTone = (level: number) =>
  level >= 60 ? 'text-[#15803D]' : level >= 20 ? 'text-[#B45309]' : 'text-[#DC2626]'

const agoLabel = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 0) return '—'
  if (diff < 60_000) return '방금 전'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`
  return `${Math.floor(diff / 86_400_000)}일 전`
}

const fmtSyncAt = (iso: string) => {
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return '—'
  return `${iso.slice(5, 16).replace('T', ' ')}`
}

const STATUS_ORDER: MobilityDeviceStatus[] = ['available', 'rented', 'maintenance', 'low_battery']

/**
 * 파트너 전용 대시보드 — 기기 현황 요약, 외부 API 연동 모니터링, 수익·정산,
 * 기기 목록·수정·삭제를 한 화면에서 제공한다. 기사 센터 카드 대신 '기사·파트너
 * 센터' 탭 최상단에 렌더된다.
 */
export function PartnerDashboard({
  ownerUid,
  ownerName = '',
  profile,
  onEditProfile,
  onNotice,
}: {
  ownerUid: string
  ownerName?: string
  profile?: PartnerProfile | null
  onEditProfile?: () => void
  onNotice?: (message: string) => void
}) {
  const uid = ownerUid.trim()
  const [devices, setDevices] = useState<MobilityDevice[]>([])
  const [feeds, setFeeds] = useState<PartnerFeedInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editDevice, setEditDevice] = useState<MobilityDevice | null>(null)
  const [statSheet, setStatSheet] = useState<'revenue' | 'trips' | null>(null)

  const reload = useCallback(() => {
    if (!uid) {
      setLoading(false)
      return
    }
    void Promise.allSettled([fetchMyMobilityDevices(uid), fetchMyPartnerFeeds(uid)])
      .then(([d, f]) => {
        if (d.status === 'fulfilled') setDevices(d.value)
        if (f.status === 'fulfilled') setFeeds(f.value)
      })
      .finally(() => setLoading(false))
  }, [uid])

  useEffect(() => {
    reload()
    const timer = window.setInterval(reload, 20_000)
    return () => window.clearInterval(timer)
  }, [reload])

  const counts: Record<MobilityDeviceStatus, number> = { available: 0, rented: 0, maintenance: 0, low_battery: 0 }
  for (const device of devices) {
    const key = STATUS_ORDER.includes(device.status) ? device.status : 'maintenance'
    counts[key] += 1
  }

  const feedOk = feeds.filter((feed) => feed.enabled && feed.lastSyncStatus === 'ok').length
  const feedErr = feeds.filter((feed) => feed.lastSyncStatus === 'error').length
  const lastSyncAt = feeds.map((feed) => feed.lastSyncAt).filter(Boolean).sort().at(-1) ?? ''

  const removeDevice = async (device: MobilityDevice) => {
    if (await deleteMobilityDevice(device.serial, uid)) {
      setDevices((list) => list.filter((item) => item.serial !== device.serial))
      onNotice?.(`${device.serial} 기기를 삭제했어요.`)
    }
  }

  const toggleRentable = async (device: MobilityDevice) => {
    const updated = await updateMyMobilityDevice(device.serial, uid, { rentable: !device.rentable })
    if (updated) {
      setDevices((list) => list.map((item) => (item.serial === device.serial ? updated : item)))
      onNotice?.(updated.rentable ? `${device.serial} 대여를 허용했어요.` : `${device.serial} 대여를 중지했어요.`)
    }
  }

  if (!uid) {
    return (
      <article className="rounded-[24px] border-2 border-dashed border-[#CBD5E1] bg-white p-5 text-center">
        <Store className="mx-auto h-6 w-6 text-[#94A3B8]" />
        <p className="mt-2 text-sm font-black text-[#0F172A]">파트너 대시보드</p>
        <p className="mt-1 text-xs font-bold leading-5 text-[#64748B]">Pi 계정으로 로그인하면 등록 기기와 외부 연동을 한눈에 관리할 수 있습니다.</p>
      </article>
    )
  }

  const company = profile?.name?.trim() || ownerName || '내 파트너'

  return (
    <div className="space-y-3">
      {/* 헤더 — 상호·권한 요약 */}
      <article className="overflow-hidden rounded-[24px] border-2 border-[#BFDBFE] bg-gradient-to-br from-[#E8F1FA] to-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-black tracking-wide text-[#4A82B8]">
              <Store className="h-3.5 w-3.5" />
              PARTNER DASHBOARD
            </p>
            <h3 className="mt-1 truncate text-lg font-black text-[#0F172A]">{company}</h3>
            <p className="mt-0.5 text-xs font-bold text-[#64748B]">
              {profile?.serviceType?.trim() || '자전거 · 킥보드 공유'} 파트너
              {profile?.region?.trim() ? ` · ${profile.region.trim()}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={reload}
            className="flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[11px] font-black text-[#4A82B8] shadow-sm"
            aria-label="대시보드 새로고침"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>
        {onEditProfile ? (
          <button
            type="button"
            onClick={onEditProfile}
            className="mt-3 w-full rounded-2xl border-2 border-[#BFDBFE] bg-white py-2.5 text-xs font-black text-[#4A82B8]"
          >
            파트너 정보 수정
          </button>
        ) : null}
      </article>

      {/* 기기 현황 요약 */}
      <article className="rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-black text-[#334155]">
            <MonitorSmartphone className="h-4 w-4 text-[#4A82B8]" />
            등록 기기 현황
          </p>
          <span className="text-lg font-black tabular-nums text-[#0F172A]">{devices.length}대</span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {STATUS_ORDER.map((status) => (
            <div key={status} className={`rounded-2xl px-1.5 py-2 text-center ${statusTone(status)}`}>
              <p className="text-base font-black tabular-nums">{counts[status]}</p>
              <p className="mt-0.5 text-[10px] font-black">{MOBILITY_STATUS_LABEL[status]}</p>
            </div>
          ))}
        </div>
      </article>

      {/* 외부 API 연동 모니터링 */}
      <article className="rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4">
        <p className="flex items-center gap-1.5 text-xs font-black text-[#334155]">
          <Link2 className="h-4 w-4 text-[#4A82B8]" />
          외부 API 연동 상태
        </p>
        {!feeds.length ? (
          <p className="mt-2 text-xs font-bold leading-5 text-[#64748B]">
            등록된 외부 연동이 없습니다. 업체 API 주소를 등록하면 기기 위치가 자동으로 취합됩니다.
          </p>
        ) : (
          <div className="mt-3 rounded-2xl bg-[#F8FAFC] px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-black">
              <span className="text-[#0F172A]">소스 {feeds.length}개</span>
              <span className="text-[#047857]">정상 {feedOk}</span>
              {feedErr ? <span className="text-[#BE123C]">오류 {feedErr}</span> : null}
            </div>
            <p className="mt-1.5 text-[11px] font-bold text-[#64748B]">
              최근 동기화 {lastSyncAt ? fmtSyncAt(lastSyncAt) : '—'} · 30초 간격으로 자동 갱신
            </p>
          </div>
        )}
        <div className="mt-3">
          <PartnerFeedsPanel ownerUid={uid} onNotice={onNotice} />
        </div>
      </article>

      {/* 수익·정산 요약 */}
      <article className="rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4">
        <p className="flex items-center gap-1.5 text-xs font-black text-[#334155]">
          <FileSpreadsheet className="h-4 w-4 text-[#4A82B8]" />
          기기 대여 수익 · 정산
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setStatSheet('revenue')}
            className="rounded-2xl bg-[#4A82B8] py-3 text-xs font-black text-white shadow-[0_8px_16px_rgba(74,130,184,0.28)]"
          >
            수익 관리
          </button>
          <button
            type="button"
            onClick={() => setStatSheet('trips')}
            className="rounded-2xl bg-[#E8F1FA] py-3 text-xs font-black text-[#4A82B8]"
          >
            운행 관리
          </button>
        </div>
      </article>

      {/* 내 기기 목록 */}
      <article className="rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-black text-[#334155]">
            <Briefcase className="h-4 w-4 text-[#4A82B8]" />
            내 기기 목록
          </p>
          <button
            type="button"
            onClick={() => {
              setEditDevice(null)
              setFormOpen(true)
            }}
            className="rounded-full bg-[#4A82B8] px-3 py-1.5 text-[11px] font-black text-white"
          >
            기기 추가
          </button>
        </div>
        {!loading && !devices.length ? (
          <p className="mt-3 rounded-2xl border-2 border-dashed border-[#CBD5E1] p-4 text-center text-xs font-bold leading-5 text-[#64748B]">
            등록된 기기가 없습니다. 직접 등록하거나 위에서 외부 API 연동을 추가하세요.
          </p>
        ) : null}
        <ul className="mt-3 space-y-2">
          {devices.map((device) => (
            <li key={device.serial} className="rounded-2xl border border-[#E2E8F0] bg-white px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-black text-[#0F172A]">
                  {device.serial}
                  {device.model ? <span className="font-bold text-[#64748B]"> · {device.model}</span> : null}
                </p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${statusTone(device.status)}`}>
                  {MOBILITY_STATUS_LABEL[device.status] ?? device.status}
                </span>
              </div>
              <p className="mt-1 text-[11px] font-bold text-[#64748B]">
                {device.kind} · <span className={batteryTone(device.battery)}>배터리 {device.battery}%</span> · {device.address || '위치 미등록'}
              </p>
              <p className="mt-0.5 text-[10px] font-bold text-[#94A3B8]">마지막 업데이트 {agoLabel(device.lastSeen)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditDevice(device)
                    setFormOpen(true)
                  }}
                  className="rounded-full border border-[#BFDBFE] px-3 py-1.5 text-[11px] font-black text-[#4A82B8]"
                >
                  정보 수정
                </button>
                <button
                  type="button"
                  onClick={() => void toggleRentable(device)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-black ${device.rentable ? 'bg-[#0F172A] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
                >
                  {device.rentable ? '대여 허용 중' : '대여 중지'}
                </button>
                <button
                  type="button"
                  onClick={() => void removeDevice(device)}
                  className="ml-auto rounded-full bg-[#FEF2F2] p-1.5 text-[#BE123C]"
                  aria-label={`${device.serial} 삭제`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </article>

      {formOpen ? (
        <MobilityDeviceFormModal
          ownerUid={uid}
          ownerName={ownerName}
          editDevice={editDevice ?? undefined}
          onClose={() => {
            setFormOpen(false)
            setEditDevice(null)
            reload()
          }}
        />
      ) : null}
      {statSheet ? <PartnerStatSheet kind={statSheet} onClose={() => setStatSheet(null)} /> : null}
    </div>
  )
}

/** 대시보드 루트 — 렌더 예외가 페이지 크래시로 번지지 않게 감싼다. */
export function PartnerDashboardSafe(props: Parameters<typeof PartnerDashboard>[0]) {
  return (
    <SafeBoundary label="파트너 대시보드를 불러오는 중 문제가 발생했어요.">
      <PartnerDashboard {...props} />
    </SafeBoundary>
  )
}

/**
 * 하단 '기사/파트너' 탭의 파트너 뷰 — 프로필·Pi 세션을 스스로 읽고,
 * 기사 겸업 유저에게는 기사 모드로 돌아가는 토글을 제공한다.
 */
export function PartnerTabScreen({
  dualRole = false,
  onSwitchToDriver,
  onNotice,
}: {
  /** 기사 권한도 보유한 복합 유저면 모드 전환 토글을 보인다. */
  dualRole?: boolean
  onSwitchToDriver?: () => void
  onNotice?: (message: string) => void
}) {
  const [profile, setProfile] = useState<PartnerProfile | null>(null)
  const [identity, setIdentity] = useState<PiIdentity | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  useEffect(() => {
    try {
      setProfile(loadPartnerProfile())
      setIdentity(loadPiIdentity())
    } catch {
      /* 손상된 로컬 데이터 — 빈 상태로 진행 */
    }
  }, [])

  const uid = profile?.uid || identity?.uid || ''
  const ownerName = profile?.name || identity?.username || ''

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-4" aria-label="파트너 대시보드">
      {dualRole && onSwitchToDriver ? (
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-[18px] bg-[#F1F5F9] p-1 ring-1 ring-[#E2E8F0]">
          <button type="button" onClick={onSwitchToDriver} className="rounded-[14px] py-2.5 text-xs font-black text-[#64748B]">
            기사 모드
          </button>
          <span className="rounded-[14px] bg-[#4A82B8] py-2.5 text-center text-xs font-black text-white shadow-[0_8px_16px_rgba(74,130,184,0.28)]">
            파트너 모드
          </span>
        </div>
      ) : null}
      <PartnerDashboardSafe
        ownerUid={uid}
        ownerName={ownerName}
        profile={profile}
        onEditProfile={profile ? () => setEditOpen(true) : undefined}
        onNotice={onNotice}
      />
      {editOpen && profile ? (
        <PartnerProfileEditModal
          profile={profile}
          onClose={() => setEditOpen(false)}
          onSaved={(next) => setProfile(next)}
          onDone={(message) => onNotice?.(message)}
        />
      ) : null}
    </main>
  )
}
