'use client'

import { useCallback, useEffect, useState } from 'react'
import { BarChart3, Briefcase, CircleAlert, FileSpreadsheet, Link2, MonitorSmartphone, RefreshCw, Store, Trash2 } from 'lucide-react'
import PartnerStatSheet from '@/components/partner-stat-sheet'
import PartnerInsightsSheet from '@/components/partner-insights-sheet'
import { MobilityDeviceFormModal } from '@/components/mobility-device-form'
import { PartnerFeedsPanel } from '@/components/partner-feeds-panel'
import { SafeBoundary } from '@/components/safe-boundary'
import {
  deleteMobilityDevice,
  fetchMyMobilityDevices,
  fetchMyPartnerFeeds,
  updateMyMobilityDevice,
  type MobilityDevice,
  type MobilityDeviceStatus,
  type PartnerFeedInfo,
} from '@/lib/mobility-devices'
import { useLocale } from '@/components/locale-provider'
import { localizeDynamic, translateDeviceKind, translateDeviceStatus } from '@/lib/i18n'
import PartnerProfileEditModal from '@/components/partner-profile-edit'
import PayoutRequestSheet from '@/components/payout-request-sheet'
import BroadcastBanner from '@/components/broadcast-banner'
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

/** 파트너 대시보드에 표시할 미수금 건 — /api/receivables?partner= 의 응답 행. */
type PartnerReceivable = {
  id: string
  userId: string
  wallet: string
  phone: string
  service: string
  deviceId: string
  place: string
  amount: number
  reason: string
  attempts: number
  createdAt: string
}

type ReceivableSummary = {
  openCount: number
  openTotal: number
  week: { count: number; total: number }
  month: { count: number; total: number }
  byUser: {
    userId: string
    wallet: string
    phone: string
    count: number
    amount: number
    latestAt: string
    penalty: { points: number; restrictedUntil: string | null } | null
  }[]
}

async function fetchPartnerReceivables(uid: string): Promise<{ items: PartnerReceivable[]; summary: ReceivableSummary | null }> {
  const res = await fetch(`/api/receivables?partner=${encodeURIComponent(uid)}&status=open`, { cache: 'no-store' })
  const data = (await res.json().catch(() => null)) as { items?: PartnerReceivable[]; summary?: ReceivableSummary } | null
  if (!res.ok || !Array.isArray(data?.items)) return { items: [], summary: null }
  return { items: data.items, summary: data.summary ?? null }
}

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
  const { t, locale } = useLocale()
  const [devices, setDevices] = useState<MobilityDevice[]>([])
  const [feeds, setFeeds] = useState<PartnerFeedInfo[]>([])
  const [receivables, setReceivables] = useState<PartnerReceivable[]>([])
  const [recvSummary, setRecvSummary] = useState<ReceivableSummary | null>(null)
  const [recvBusy, setRecvBusy] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [dataVersion, setDataVersion] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [editDevice, setEditDevice] = useState<MobilityDevice | null>(null)
  const [statSheet, setStatSheet] = useState<'revenue' | 'trips' | null>(null)
  const [payoutOpen, setPayoutOpen] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [driverAlias, setDriverAlias] = useState('')

  // uid 로그인 이전 단말기 발급 기사 id — 수익 장부가 두 id에 나뉘어 쌓였을 수
  // 있으므로 인사이트 조회 시 별칭으로 함께 넘긴다.
  useEffect(() => {
    try {
      const legacy = window.localStorage.getItem('taxitago-driver-id')?.trim() || ''
      setDriverAlias(legacy && legacy !== uid ? legacy : '')
    } catch {
      setDriverAlias('')
    }
  }, [uid])

  const fetchData = useCallback(async () => {
    const [d, f, r] = await Promise.allSettled([fetchMyMobilityDevices(uid), fetchMyPartnerFeeds(uid), fetchPartnerReceivables(uid)])
    if (d.status === 'fulfilled') setDevices(d.value)
    if (f.status === 'fulfilled') setFeeds(f.value)
    if (r.status === 'fulfilled') {
      setReceivables(r.value.items)
      setRecvSummary(r.value.summary)
    }
  }, [uid])

  const reload = useCallback(() => {
    if (!uid) {
      setLoading(false)
      return
    }
    void fetchData().finally(() => setLoading(false))
  }, [uid, fetchData])

  /** 수동 새로고침 — 스피너·안내 피드백을 주고, 열려 있는 정산 시트도 재조회한다. */
  const refresh = useCallback(() => {
    if (!uid || refreshing) return
    setRefreshing(true)
    void fetchData()
      .then(() => {
        setDataVersion((v) => v + 1)
        onNotice?.('기기 상태와 외부 연동을 새로 불러왔어요.')
      })
      .finally(() => setRefreshing(false))
  }, [uid, refreshing, fetchData, onNotice])

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

  /** 제공자 수동 정산 — Pi 송금을 확인한 미수금을 정산 완료로 처리한다. */
  const settleReceivable = async (row: PartnerReceivable) => {
    if (recvBusy) return
    const note = window.prompt(`${row.amount} Pi 미수금을 정산 완료 처리합니다.\nPi 송금 확인 메모를 입력해 주세요.`, '')
    if (note === null) return
    setRecvBusy(row.id)
    try {
      const res = await fetch('/api/receivables', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner: uid, id: row.id, action: 'settle', note }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null
      if (!res.ok || !data?.ok) throw new Error('failed')
      setReceivables((prev) => prev.filter((item) => item.id !== row.id))
      setRecvSummary((prev) =>
        prev
          ? { ...prev, openCount: prev.openCount - 1, openTotal: Math.max(0, prev.openTotal - row.amount) }
          : prev,
      )
      onNotice?.('미수금을 정산 완료 처리했어요. 해당 이용자의 페널티도 자동 감면됩니다.')
      void fetchData()
    } catch {
      onNotice?.('정산 처리에 실패했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setRecvBusy('')
    }
  }

  /** 제공자 페널티 감면 — 자사 미수 이용자에 한해 포인트를 깎거나 제한을 해제한다. */
  const relieveUserPenalty = async (userId: string, action: 'waive-penalty' | 'clear-restriction') => {
    if (recvBusy) return
    setRecvBusy(userId)
    try {
      const res = await fetch('/api/receivables', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner: uid, userId, action, points: 10 }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null
      if (!res.ok || !data?.ok) throw new Error('failed')
      onNotice?.(action === 'clear-restriction' ? '이용 제한을 해제했어요.' : '페널티 10점을 감면했어요.')
      void fetchData()
    } catch {
      onNotice?.('페널티 처리에 실패했어요.')
    } finally {
      setRecvBusy('')
    }
  }

  /** 이용자에게 보낼 Pi 송금 안내 문구 — 지갑 주소·미수 총액을 담아 복사한다. */
  const copyRemittanceGuide = (row: ReceivableSummary['byUser'][number]) => {
    const text = [
      '[택시타고 미수금 정산 안내]',
      `Pi 지갑 주소: ${row.wallet || '(미확인)'}`,
      `미수 이용료: ${row.amount.toFixed(7)} Pi (${row.count}건)`,
      `최근 이용: ${agoLabel(row.latestAt)}`,
      '',
      'Pi Browser에서 해당 지갑으로 미수금을 송금하신 뒤 고객센터로 알려 주시면 정산 완료 처리됩니다.',
    ].join('\n')
    void navigator.clipboard?.writeText(text).then(
      () => onNotice?.('송금 안내 문구를 복사했어요. 이용자에게 전달해 주세요.'),
      () => onNotice?.('복사에 실패했어요.'),
    )
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

  // 상호명은 파트너 입력 동적 데이터 — LocalizedText 확장 구조를 거쳐 표시한다.
  const company = localizeDynamic(profile?.name, locale) || ownerName || '내 파트너'

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
            onClick={refresh}
            disabled={refreshing}
            aria-busy={refreshing}
            className="flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[11px] font-black text-[#4A82B8] shadow-sm transition disabled:opacity-70"
            aria-label="대시보드 새로고침"
          >
            <RefreshCw className={`h-3 w-3 ${loading || refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? t('common.loading') : t('common.refresh')}
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

      <BroadcastBanner audience="partner" />

      {/* 기기 현황 요약 */}
      <article className="rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-black text-[#334155]">
            <MonitorSmartphone className="h-4 w-4 text-[#4A82B8]" />
            {t('device.manage')}
          </p>
          <span className="text-lg font-black tabular-nums text-[#0F172A]">{devices.length}대</span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {STATUS_ORDER.map((status) => (
            <div key={status} className={`rounded-2xl px-1.5 py-2 text-center ${statusTone(status)}`}>
              <p className="text-base font-black tabular-nums">{counts[status]}</p>
              <p className="mt-0.5 text-[10px] font-black">{translateDeviceStatus(locale, status)}</p>
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
            {t('partner.revenue')}
          </button>
          <button
            type="button"
            onClick={() => setStatSheet('trips')}
            className="rounded-2xl bg-[#E8F1FA] py-3 text-xs font-black text-[#4A82B8]"
          >
            {t('partner.operations')}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setInsightsOpen(true)}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-[#BFDBFE] bg-white py-2.5 text-xs font-black text-[#4A82B8]"
        >
          <BarChart3 className="h-3.5 w-3.5" />
          {t('insights.open')}
        </button>
        <button
          type="button"
          onClick={() => setPayoutOpen(true)}
          className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-white py-2.5 text-xs font-black text-[#4A82B8]"
        >
          수익 출금 신청
        </button>
      </article>

      {/* 미수금 — 이용 종료 시점 결제 실패 건이 20초 주기 폴링으로 실시간 노출된다 */}
      <article className="rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-black text-[#334155]">
            <CircleAlert className="h-4 w-4 text-[#B45309]" />
            미수금 현황
          </p>
          <span className={`text-lg font-black tabular-nums ${receivables.length ? 'text-[#B45309]' : 'text-[#0F172A]'}`}>
            {receivables.length}건
          </span>
        </div>
        {!receivables.length ? (
          <p className="mt-2 text-xs font-bold leading-5 text-[#64748B]">
            미결제로 남은 이용 요금이 없습니다.
          </p>
        ) : (
          <>
            {/* 주간·월간 미수 집계 — Pi 송금 정산 유도의 기준 */}
            {recvSummary ? (
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                <div className="rounded-2xl bg-[#F8FAFC] px-2 py-2 text-center">
                  <p className="text-sm font-black tabular-nums text-[#0F172A]">{recvSummary.openTotal.toFixed(4)}</p>
                  <p className="mt-0.5 text-[9px] font-black text-[#64748B]">전체 미수 (Pi)</p>
                </div>
                <div className="rounded-2xl bg-[#F8FAFC] px-2 py-2 text-center">
                  <p className="text-sm font-black tabular-nums text-[#B45309]">{recvSummary.week.total.toFixed(4)}</p>
                  <p className="mt-0.5 text-[9px] font-black text-[#64748B]">최근 7일 ({recvSummary.week.count}건)</p>
                </div>
                <div className="rounded-2xl bg-[#F8FAFC] px-2 py-2 text-center">
                  <p className="text-sm font-black tabular-nums text-[#B45309]">{recvSummary.month.total.toFixed(4)}</p>
                  <p className="mt-0.5 text-[9px] font-black text-[#64748B]">최근 30일 ({recvSummary.month.count}건)</p>
                </div>
              </div>
            ) : null}

            {/* 이용자별 미수 집계 — 지갑 주소·연락처·페널티와 송금 안내 */}
            {recvSummary?.byUser.length ? (
              <ul className="mt-3 space-y-2">
                {recvSummary.byUser.map((row) => (
                  <li key={row.userId || row.wallet || row.phone} className="rounded-2xl border border-[#BFDBFE] bg-[#F8FAFC] px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-[12px] font-black text-[#0F172A]">
                        이용자 {row.userId || '—'}
                        {row.penalty ? (
                          <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-black ${row.penalty.restrictedUntil && Date.parse(row.penalty.restrictedUntil) > Date.now() ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#FEF3C7] text-[#B45309]'}`}>
                            {row.penalty.restrictedUntil && Date.parse(row.penalty.restrictedUntil) > Date.now() ? '이용 제한 중' : `페널티 ${row.penalty.points}점`}
                          </span>
                        ) : null}
                      </p>
                      <span className="shrink-0 text-[12px] font-black tabular-nums text-[#B45309]">{row.amount.toFixed(4)} Pi</span>
                    </div>
                    <p className="mt-1 truncate text-[10px] font-bold text-[#64748B]">
                      {row.count}건 · 최근 이용 {agoLabel(row.latestAt)}
                    </p>
                    {row.phone ? (
                      <a href={`tel:${row.phone}`} className="mt-0.5 block truncate text-[11px] font-black text-[#4A82B8]">
                        📞 {row.phone}
                      </a>
                    ) : null}
                    {row.wallet ? (
                      <p className="mt-0.5 truncate font-mono text-[9px] font-bold text-[#94A3B8]" title={row.wallet}>
                        지갑 {row.wallet}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => copyRemittanceGuide(row)}
                        className="rounded-full border border-[#BFDBFE] bg-white px-2.5 py-1 text-[10px] font-black text-[#4A82B8]"
                      >
                        송금 안내 복사
                      </button>
                      {row.penalty && row.penalty.points > 0 ? (
                        <button
                          type="button"
                          disabled={recvBusy === row.userId}
                          onClick={() => void relieveUserPenalty(row.userId, 'waive-penalty')}
                          className="rounded-full bg-[#FEF3C7] px-2.5 py-1 text-[10px] font-black text-[#B45309] disabled:opacity-50"
                        >
                          페널티 -10점
                        </button>
                      ) : null}
                      {row.penalty?.restrictedUntil && Date.parse(row.penalty.restrictedUntil) > Date.now() ? (
                        <button
                          type="button"
                          disabled={recvBusy === row.userId}
                          onClick={() => void relieveUserPenalty(row.userId, 'clear-restriction')}
                          className="rounded-full bg-[#FEE2E2] px-2.5 py-1 text-[10px] font-black text-[#B91C1C] disabled:opacity-50"
                        >
                          제한 해제
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {/* 미수 건 목록 — 건별 정산 완료 처리 */}
            <ul className="mt-3 space-y-2">
              {receivables.map((row) => (
                <li key={row.id} className="rounded-2xl border border-[#F59E0B] bg-[#FFFBEB] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-[12px] font-black text-[#0F172A]">
                      {row.service}
                      {row.deviceId ? <span className="font-bold text-[#64748B]"> · {row.deviceId}</span> : null}
                    </p>
                    <span className="shrink-0 text-[12px] font-black tabular-nums text-[#B45309]">{row.amount.toFixed(4)} Pi</span>
                  </div>
                  <p className="mt-1 truncate text-[10px] font-bold text-[#64748B]">
                    {agoLabel(row.createdAt)} · 이용자 {row.userId || '—'}
                    {row.attempts > 1 ? ` · 실패 ${row.attempts}회` : ''}
                  </p>
                  {row.phone ? (
                    <a href={`tel:${row.phone}`} className="mt-1 block truncate text-[11px] font-black text-[#4A82B8]">
                      📞 {row.phone}
                    </a>
                  ) : null}
                  {row.wallet ? (
                    <p className="mt-0.5 truncate font-mono text-[9px] font-bold text-[#94A3B8]" title={row.wallet}>
                      지갑 {row.wallet}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={recvBusy === row.id}
                    onClick={() => void settleReceivable(row)}
                    className="mt-2 w-full rounded-xl bg-[#15803D] py-2 text-[11px] font-black text-white disabled:opacity-50"
                  >
                    Pi 송금 확인 · 정산 완료
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </article>

      {/* 내 기기 목록 */}
      <article className="rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-black text-[#334155]">
            <Briefcase className="h-4 w-4 text-[#4A82B8]" />
            {t('device.list')}
          </p>
          <button
            type="button"
            onClick={() => {
              setEditDevice(null)
              setFormOpen(true)
            }}
            className="rounded-full bg-[#4A82B8] px-3 py-1.5 text-[11px] font-black text-white"
          >
            {t('device.add')}
          </button>
        </div>
        {!loading && !devices.length ? (
          <p className="mt-3 rounded-2xl border-2 border-dashed border-[#CBD5E1] p-4 text-center text-xs font-bold leading-5 text-[#64748B]">
            등록된 기기가 없습니다. 직접 등록하거나 위에서 외부 API 연동을 추가하세요.
          </p>
        ) : null}
        <ul className="mt-3 space-y-2">
          {devices.map((device) => (
            <li
              key={device.serial}
              onClick={() => {
                try {
                  setEditDevice(device)
                  setFormOpen(true)
                } catch {
                  onNotice?.('기기 정보를 열지 못했어요. 목록을 새로고침한 뒤 다시 시도해 주세요.')
                }
              }}
              className="cursor-pointer rounded-2xl border border-[#E2E8F0] bg-white px-3 py-3 transition hover:border-[#BFDBFE] hover:bg-[#F8FAFC]"
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setEditDevice(device)
                  setFormOpen(true)
                }
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-black text-[#0F172A]">
                  {device.serial}
                  {device.model ? <span className="font-bold text-[#64748B]"> · {device.model}</span> : null}
                </p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${statusTone(device.status)}`}>
                  {translateDeviceStatus(locale, device.status)}
                </span>
              </div>
              <p className="mt-1 text-[11px] font-bold text-[#64748B]">
                {translateDeviceKind(locale, device.kind)} · <span className={batteryTone(device.battery)}>{t('device.battery')} {device.battery}%</span> · {device.address || '위치 미등록'}
              </p>
              <p className="mt-0.5 text-[10px] font-bold text-[#94A3B8]">마지막 업데이트 {agoLabel(device.lastSeen)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => {
                    setEditDevice(device)
                    setFormOpen(true)
                  }}
                  className="rounded-full border border-[#BFDBFE] px-3 py-1.5 text-[11px] font-black text-[#4A82B8]"
                >
                  {t('partner.editInfo')}
                </button>
                <button
                  type="button"
                  onClick={() => void toggleRentable(device)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-black ${device.rentable ? 'bg-[#0F172A] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
                >
                  {device.rentable ? `${t('device.rentable')} ON` : t('device.rentable')}
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
      {statSheet ? <PartnerStatSheet key={`${statSheet}-${dataVersion}`} kind={statSheet} onClose={() => setStatSheet(null)} /> : null}
      {insightsOpen ? (
        <PartnerInsightsSheet driverId={uid} altDriverId={driverAlias} onClose={() => setInsightsOpen(false)} />
      ) : null}
      {payoutOpen ? (
        <PayoutRequestSheet
          applicantId={uid}
          role="partner"
          name={company}
          wallet={profile?.wallet ?? ''}
          onClose={() => setPayoutOpen(false)}
          onNotice={onNotice}
        />
      ) : null}
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
