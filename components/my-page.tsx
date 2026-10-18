'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BadgeCheck, Briefcase, Building2, Car, ChevronRight, CircleUserRound, Copy, Gift, MonitorSmartphone, ShieldCheck, Store, ToggleRight, UserRound, WalletCards } from 'lucide-react'
import B2bPortal from '@/components/b2b-portal'
import PartnerStatSheet from '@/components/partner-stat-sheet'
import PartnerProfileEditModal from '@/components/partner-profile-edit'
import { InviteLaunchModal } from '@/components/invite-launch-modal'
import { PartnerDevicePanel } from '@/components/partner-device-panel'
import { PartnerDashboardSafe } from '@/components/partner-dashboard'
import { copyInviteCode, getOrCreateInviteCode, inviteShareLink } from '@/lib/invite-code'
import { loadPartnerProfile, loadPiIdentity, updatePartnerProfile, type PartnerProfile } from '@/lib/partner-account'
import { memberPhone, saveMemberPhone } from '@/lib/member-profile'
import PhoneVerifyForm from '@/components/phone-verify-form'
import { useLocale } from '@/components/locale-provider'
import type { MessageKey } from '@/lib/i18n'

const DRIVER_REG_KEY = 'taxitago-is-driver-registered'
const PARTNER_REG_KEY = 'taxitago-is-partner-registered'
const PI_ACCOUNT_KEY = 'taxitago-pi-account-linked'

type InnerTab = 'profile' | 'history' | 'center'

function readFlag(key: string) {
  try {
    return window.localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    if (value) window.localStorage.setItem(key, 'true')
    else window.localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export type MyPageProps = {
  username?: string
  embedded?: boolean
  driverMode?: boolean
  isDriverRegistered?: boolean
  isPartnerRegistered?: boolean
  piLinked?: boolean
  onOpenWallet?: () => void
  onToggleDriverMode?: () => void
  onOpenDriverSignup?: () => void
  onOpenPartnerSignup?: () => void
  onNotice?: (message: string) => void
  activities?: ActivityRow[]
  transactions?: TxRow[]
  /** 세션/UID 대조용 디버그 스트립 — 상단 카드 안에 안착된다. */
  debugInfo?: ReactNode
}

const tabs: { id: InnerTab; labelKey: MessageKey }[] = [
  { id: 'profile', labelKey: 'mypage.tabProfile' },
  { id: 'history', labelKey: 'mypage.tabHistory' },
  { id: 'center', labelKey: 'mypage.tabCenter' },
]

const ACTIVITY_LOG_KEY = 'taxitago-activity-log'
const WALLET_STORE_KEY = 'taxitago-pi-wallet'
const PAYMENT_DUP_LABELS = new Set(['결제 완료', '취소 수수료 결제', 'Pi 충전 완료', 'Pi 환불'])

type HistoryEntry = { id: string; label: string; detail: string; at: string; amount: number | null; ts: number; kind: 'payment' | 'activity' }
type ActivityRow = { id: string; at: string; label: string; detail: string; ts?: number }
type TxRow = { label: string; amount: number; detail: string; place: string; at: string; ts?: number }

type HistoryTimeFilter = 'all' | 'today' | 'week' | 'month'
type HistoryTypeFilter = 'all' | 'payment' | 'activity'

const HISTORY_TIME_FILTERS: { id: HistoryTimeFilter; labelKey: MessageKey }[] = [
  { id: 'all', labelKey: 'inbox.filterAll' },
  { id: 'today', labelKey: 'inbox.today' },
  { id: 'week', labelKey: 'inbox.week' },
  { id: 'month', labelKey: 'inbox.month' },
]
const HISTORY_TYPE_FILTERS: { id: HistoryTypeFilter; labelKey: MessageKey }[] = [
  { id: 'all', labelKey: 'inbox.filterAll' },
  { id: 'payment', labelKey: 'inbox.typePay' },
  { id: 'activity', labelKey: 'inbox.typeActivity' },
]

function storedActivities(): ActivityRow[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACTIVITY_LOG_KEY) || '[]') as ActivityRow[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function storedTransactions(): TxRow[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WALLET_STORE_KEY) || 'null') as { transactions?: TxRow[] } | null
    return Array.isArray(parsed?.transactions) ? parsed.transactions : []
  } catch {
    return []
  }
}

function mergedHistory(activities: ActivityRow[], transactions: TxRow[]): HistoryEntry[] {
  // 로컬 저장본의 비정규 행(객체·숫자 필드)도 JSX 렌더에서 안전하도록 문자열로 수렴한다.
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const tsOf = (row: { ts?: unknown; at?: unknown }) => {
    const n = Number(row?.ts)
    if (Number.isFinite(n) && n > 0) return n
    const parsed = Date.parse(text(row?.at))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return [
    ...transactions.map((tx, index) => {
      const amount = Number(tx?.amount)
      return {
        id: `tx-${index}`,
        label: text(tx?.label),
        detail: text(tx?.detail) || text(tx?.place),
        at: text(tx?.at),
        amount: Number.isFinite(amount) ? amount : null,
        ts: tsOf(tx),
        kind: 'payment' as const,
      }
    }),
    ...activities
      .filter((entry) => entry && typeof entry === 'object' && !PAYMENT_DUP_LABELS.has(text(entry.label)))
      .map((entry, index) => ({
        id: text(entry.id) || `act-${index}`,
        label: text(entry.label),
        detail: text(entry.detail),
        at: text(entry.at),
        amount: null,
        ts: tsOf(entry),
        kind: 'activity' as const,
      })),
  ]
}

export default function MyPage({
  username = 'taxitago',
  embedded = false,
  driverMode,
  isDriverRegistered,
  isPartnerRegistered,
  piLinked,
  onOpenWallet,
  onToggleDriverMode,
  onOpenDriverSignup,
  onOpenPartnerSignup,
  onNotice,
  activities,
  transactions,
  debugInfo,
}: MyPageProps) {
  const { t } = useLocale()
  const [innerTab, setInnerTab] = useState<InnerTab>('profile')
  const [localDriver, setLocalDriver] = useState(false)
  const [localPartner, setLocalPartner] = useState(false)
  const [localMode, setLocalMode] = useState(false)
  const [localPi, setLocalPi] = useState(true)
  const [partnerPending, setPartnerPending] = useState(false)
  const [toast, setToast] = useState('')
  const [statSheet, setStatSheet] = useState<'revenue' | 'trips' | null>(null)
  const [walletSheet, setWalletSheet] = useState(false)
  const [profileSheet, setProfileSheet] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [inviteLaunchOpen, setInviteLaunchOpen] = useState(false)
  const [partnerProfile, setPartnerProfile] = useState<PartnerProfile | null>(null)
  const [piUid, setPiUid] = useState('')
  const [centerRole, setCenterRole] = useState<'driver' | 'partner'>('partner')
  const [devicePanelOpen, setDevicePanelOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [phoneSheetOpen, setPhoneSheetOpen] = useState(false)
  const [memberPhoneValue, setMemberPhoneValue] = useState('')
  const [b2bMember, setB2bMember] = useState(false)
  const [b2bOpen, setB2bOpen] = useState(false)
  const [historyRows, setHistoryRows] = useState<HistoryEntry[]>([])
  const [histTime, setHistTime] = useState<HistoryTimeFilter>('all')
  const [histType, setHistType] = useState<HistoryTypeFilter>('all')

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (innerTab !== 'history') return
    const load = () =>
      setHistoryRows(mergedHistory(activities ?? storedActivities(), transactions ?? storedTransactions()))
    load()
    const timer = window.setInterval(load, 5000)
    const wake = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
    }
  }, [innerTab, activities, transactions])

  useEffect(() => {
    setLocalDriver(readFlag(DRIVER_REG_KEY))
    setLocalPartner(readFlag(PARTNER_REG_KEY))
    setLocalPi(readFlag(PI_ACCOUNT_KEY) || true)
    setInviteCode(getOrCreateInviteCode(username))
    setPartnerProfile(loadPartnerProfile())
    setPiUid(loadPiIdentity()?.uid?.trim() || '')
    setMemberPhoneValue(memberPhone())
  }, [username])

  // B2B 법인 소속 여부 — 소속이면 '법인 포털' 카드를 노출한다.
  useEffect(() => {
    if (!piUid) {
      setB2bMember(false)
      return
    }
    let cancelled = false
    void fetch(`/api/b2b/portal?uid=${encodeURIComponent(piUid)}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: { member?: boolean } | null) => {
        if (!cancelled) setB2bMember(Boolean(data?.member))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [piUid])

  const notify = (message: string) => {
    onNotice?.(message)
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }

  // 등록 플래그가 빠져 있어도 저장된 프로필의 role을 권한으로 인정한다.
  const driverOk = (isDriverRegistered ?? localDriver) || partnerProfile?.role === '기사'
  const partnerOk = (isPartnerRegistered ?? localPartner) || partnerProfile?.role === '파트너'
  const modeOn = driverMode ?? localMode
  const linked = piLinked ?? localPi
  // 권한 플래그는 마운트 후 localStorage에서 읽히므로, prop이 없으면 마운트
  // 전까지 '비파트너'로 잘못 렌더되는 플래시를 막는다.
  const rolesReady = mounted || isDriverRegistered !== undefined || isPartnerRegistered !== undefined
  const dualRole = driverOk && partnerOk
  const partnerView = partnerOk && (!driverOk || centerRole === 'partner')
  // 현재 역할 — 파트너 권한이 활성화된 유저는 승객/기사보다 파트너 모드를 우선 표시한다.
  const roleLabel = !rolesReady
    ? t('mypage.roleChecking')
    : partnerView
      ? t('mypage.modePartner')
      : modeOn
        ? t('mypage.modeDriver')
        : t('mypage.modePassenger')

  // 시간 필터 — 오늘(로컬 날짜)/7일/30일. 타임스탬프가 없는 항목은 '전체'에서만 보인다.
  const withinHistTime = (ts: number) => {
    if (histTime === 'all') return true
    if (!Number.isFinite(ts) || ts <= 0) return false
    if (histTime === 'today') {
      const d = new Date(ts)
      const n = new Date()
      return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
    }
    return Date.now() - ts <= (histTime === 'week' ? 7 : 30) * 86_400_000
  }
  const visibleHistory = historyRows.filter((row) => withinHistTime(row.ts) && (histType === 'all' || row.kind === histType))

  /** 역할 표시 클릭 — 파트너는 파트너 대시보드로, 기사는 모드 전환, 무권한은 센터 탭으로 이동한다. */
  const openRoleMode = () => {
    if (partnerOk) {
      setCenterRole('partner')
      setInnerTab('center')
      return
    }
    if (driverOk) {
      toggleMode()
      return
    }
    setInnerTab('center')
  }

  const registerDriver = () => {
    if (onOpenDriverSignup) {
      onOpenDriverSignup()
      return
    }
    writeFlag(DRIVER_REG_KEY, true)
    setLocalDriver(true)
    setLocalMode(true)
    notify(t('mypage.toastDriverReg'))
  }

  const toggleMode = () => {
    if (onToggleDriverMode) {
      onToggleDriverMode()
      return
    }
    if (!driverOk) {
      notify(t('mypage.toastNeedDriver'))
      setInnerTab('center')
      return
    }
    setLocalMode((value) => {
      const next = !value
      notify(t(next ? 'mypage.toastDriverOn' : 'mypage.toastPassengerOn'))
      return next
    })
  }

  const applyPartner = () => {
    if (partnerOk) {
      notify(t('mypage.toastPartnerDup'))
      return
    }
    if (onOpenPartnerSignup) {
      onOpenPartnerSignup()
      return
    }
    setPartnerPending(true)
    window.setTimeout(() => {
      writeFlag(PARTNER_REG_KEY, true)
      setLocalPartner(true)
      setPartnerPending(false)
      notify(t('mypage.toastPartnerOk'))
    }, 1200)
  }

  const openWallet = () => {
    if (onOpenWallet) onOpenWallet()
    else setWalletSheet(true)
  }

  const openProfile = () => {
    setProfileSheet(true)
  }

  /** 인증 완료된 번호를 회원 프로필에 저장하고, 파트너 연락처도 같은 번호로 맞춘다. */
  const saveVerifiedPhone = (verified: string) => {
    saveMemberPhone(verified, piUid)
    setMemberPhoneValue(verified)
    if (partnerProfile) {
      void updatePartnerProfile({
        name: partnerProfile.name,
        phone: verified,
        region: partnerProfile.region,
        detail: partnerProfile.detail,
      })
        .then((next) => { if (next) setPartnerProfile(next) })
        .catch(() => undefined)
    }
    setPhoneSheetOpen(false)
    notify(t('mypage.phoneUpdated'))
  }

  const shareLink = inviteCode ? inviteShareLink(inviteCode) : ''

  const handleCopyInviteCode = async () => {
    if (!inviteCode) return
    try {
      await copyInviteCode(inviteCode)
      setCopied(true)
      notify(t('mypage.toastCopied'))
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      notify(t('mypage.toastCopyFail'))
    }
  }

  return (
    <div className={`flex min-h-0 flex-col ${embedded ? 'h-full' : 'h-dvh bg-[#F4F1FA]'}`}>
      <div className="min-h-0 flex-1 overflow-y-auto pb-40">
      {!embedded ? (
        <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 pb-2 pt-5">
          <Link href="/" className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-[#4C1FB8] shadow-sm">
            {t('mypage.home')}
          </Link>
          <h1 className="text-lg font-black text-[#0F172A]">{t('mypage.title')}</h1>
          <span className="w-10" />
        </header>
      ) : (
        <h2 className="px-5 pt-1 text-2xl font-black text-[#0F172A]">{t('mypage.title')}</h2>
      )}

      <div className="mx-auto w-full max-w-md px-4">
        <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#1E1B4B] via-[#4C1FB8] to-[#0F172A] p-5 text-white shadow-[0_16px_32px_rgba(76,31,184,0.32)]">
          {debugInfo ? <div className="mb-4">{debugInfo}</div> : null}
          <button type="button" onClick={openWallet} className="flex w-full items-start justify-between gap-3 text-left">
            <div>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#FDE68A] px-2.5 py-1 text-[10px] font-black tracking-wide text-[#92400E]">
                <BadgeCheck className="h-3.5 w-3.5" />
                Pi Network Pioneer
              </span>
              <p className="mt-3 text-xs font-bold text-white/70">{t('mypage.linkedWallet')}</p>
              <p className="mt-0.5 text-sm font-black">@{username}</p>
            </div>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
              <WalletCards className="h-6 w-6" />
            </span>
          </button>
          <div className="mt-5 rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
            <p className="text-[11px] font-bold text-white/70">{linked ? t('wallet.directPayNote') : t('mypage.needLink')}</p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                openWallet()
              }}
              className="mt-4 w-full rounded-2xl bg-white py-3 text-sm font-black text-[#4C1FB8] shadow-[0_8px_16px_rgba(15,23,42,0.18)]"
            >
              {t('wallet.payHistory')}
            </button>
          </div>
        </section>

        <section className="mt-3 rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.06)]">
          <p className="text-[11px] font-black tracking-wide text-[#64748B]">{t('mypage.perms')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EEF2FF] px-3 py-1.5 text-xs font-black text-[#3730A3]">
              <UserRound className="h-3.5 w-3.5" />
              {t('mypage.passenger')}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${driverOk ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#F1F5F9] text-[#94A3B8]'}`}>
              <ShieldCheck className="h-3.5 w-3.5" />
              {t('mypage.driver')}{driverOk ? '' : ` · ${t('mypage.notReg')}`}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${partnerOk ? 'bg-[#FFF7ED] text-[#C2410C]' : 'bg-[#F1F5F9] text-[#94A3B8]'}`}>
              <Store className="h-3.5 w-3.5" />
              {t('mypage.partner')}{partnerOk ? '' : ` · ${t('mypage.notApplied')}`}
            </span>
          </div>
        </section>

        {b2bMember ? (
          <section className="mt-3 rounded-[24px] border-2 border-[#BFDBFE] bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.06)]">
            <button type="button" onClick={() => setB2bOpen(true)} className="flex w-full items-center justify-between gap-3 text-left">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#E8F1FA] text-[#4A82B8]">
                  <Building2 className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-black text-[#0F172A]">법인 포털</span>
                  <span className="mt-0.5 block text-[11px] font-bold text-[#64748B]">B2B 이용 내역 · 합산 청구서 · 소속원</span>
                </span>
              </div>
              <ChevronRight className="h-4 w-4 text-[#4A82B8]" />
            </button>
          </section>
        ) : null}

        <section className="mt-3 overflow-hidden rounded-[24px] border-2 border-[#EDE5FF] bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.06)]">
          <button type="button" onClick={() => setInviteLaunchOpen(true)} className="flex w-full items-start justify-between gap-3 text-left">
            <div>
              <p className="text-[11px] font-black tracking-wide text-[#4C1FB8]">INVITE & SHARE</p>
              <h3 className="mt-1 text-base font-black text-[#0F172A]">{t('mypage.inviteTitle')}</h3>
            </div>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#F3E8FF] text-[#4C1FB8]">
              <Gift className="h-5 w-5" />
            </span>
          </button>
          <button
            type="button"
            onClick={() => setInviteLaunchOpen(true)}
            className="mt-3 w-full rounded-2xl border border-[#FCD34D] bg-[#FFFBEB] px-3.5 py-3 text-left"
          >
            <p className="text-sm font-black leading-6 text-[#92400E]">{t('mypage.inviteHead')}</p>
            <p className="mt-0.5 text-[11px] font-bold leading-5 text-[#B45309]">{t('mypage.inviteSub')}</p>
          </button>
          <div className="mt-3 rounded-2xl bg-[#F8F5FF] px-4 py-3">
            <p className="text-[10px] font-black tracking-wide text-[#64748B]">{t('mypage.myCode')}</p>
            <p className="mt-1 break-all font-mono text-lg font-black tracking-[0.18em] text-[#4C1FB8]">{inviteCode || t('mypage.generating')}</p>
            {shareLink ? <p className="mt-1 break-all text-[11px] font-bold leading-5 text-[#64748B]">{shareLink}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => void handleCopyInviteCode()}
            disabled={!inviteCode}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4C1FB8] py-3.5 text-sm font-black text-white shadow-[0_8px_16px_rgba(76,31,184,0.28)] disabled:opacity-50"
          >
            <Copy className="h-4 w-4" />
            {copied ? t('mypage.copied') : t('mypage.copy')}
          </button>
        </section>

        <div className="mt-4">
          {innerTab === 'profile' ? (
            <div className="space-y-3">
              <article className="w-full rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4 text-left">
                <button type="button" onClick={openProfile} className="flex w-full items-center gap-3 text-left">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#F3E8FF] text-[#4C1FB8]">
                    <CircleUserRound className="h-7 w-7" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-base font-black text-[#0F172A]">{username}</span>
                    <span className="mt-0.5 block text-xs font-bold leading-5 text-[#64748B]">{t('mypage.member')}</span>
                  </span>
                </button>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <dt className="sr-only">현재 역할</dt>
                  <dd className="m-0">
                    <button
                      type="button"
                      onClick={openRoleMode}
                      className="w-full rounded-2xl bg-[#F8FAFC] p-3 text-left transition hover:bg-[#E8F1FA]"
                    >
                      <span className="block text-[10px] font-black text-[#94A3B8]">{t('mypage.curRole')}</span>
                      <span className="mt-1 flex items-center justify-between font-black text-[#0F172A]">
                        {roleLabel}
                        {partnerOk ? <ChevronRight className="h-3.5 w-3.5 text-[#4A82B8]" /> : null}
                      </span>
                    </button>
                  </dd>
                  <dt className="sr-only">Pi 연동</dt>
                  <dd className="m-0 rounded-2xl bg-[#F8FAFC] p-3">
                    <span className="block text-[10px] font-black text-[#94A3B8]">{t('mypage.piLink')}</span>
                    <span className="mt-1 block font-black text-[#0F172A]">{linked ? t('mypage.linked') : t('mypage.unlinked')}</span>
                  </dd>
                  <dt className="sr-only">{t('mypage.phone')}</dt>
                  <dd className="col-span-2 m-0">
                    <button
                      type="button"
                      onClick={() => setPhoneSheetOpen(true)}
                      className="w-full rounded-2xl bg-[#F8FAFC] p-3 text-left transition hover:bg-[#E8F1FA]"
                    >
                      <span className="block text-[10px] font-black text-[#94A3B8]">{t('mypage.phone')}</span>
                      <span className="mt-1 flex items-center justify-between font-black text-[#0F172A]">
                        {memberPhoneValue || t('mypage.phoneNone')}
                        <span className="shrink-0 text-[11px] font-black text-[#4A82B8]">
                          {memberPhoneValue ? t('mypage.phoneEdit') : t('mypage.phoneRegister')}
                        </span>
                      </span>
                    </button>
                  </dd>
                </dl>
              </article>
              <p className="whitespace-normal break-keep px-1 text-xs font-bold leading-6 text-[#64748B]">
                {t('mypage.permsNote')}
              </p>
            </div>
          ) : null}

          {innerTab === 'history' ? (
            <div className="space-y-2">
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {HISTORY_TIME_FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setHistTime(filter.id)}
                    aria-pressed={histTime === filter.id}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black transition active:scale-95 ${histTime === filter.id ? 'bg-[#4A82B8] text-white shadow-[0_4px_10px_rgba(74,130,184,0.28)]' : 'bg-[#F1F5F9] text-[#64748B]'}`}
                  >
                    {t(filter.labelKey)}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {HISTORY_TYPE_FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setHistType(filter.id)}
                    aria-pressed={histType === filter.id}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black transition active:scale-95 ${histType === filter.id ? 'bg-[#4A82B8] text-white shadow-[0_4px_10px_rgba(74,130,184,0.28)]' : 'bg-[#F1F5F9] text-[#64748B]'}`}
                  >
                    {t(filter.labelKey)}
                  </button>
                ))}
              </div>
              {visibleHistory.map((row) => (
                <article key={row.id} className="rounded-[22px] border-2 border-[#E2E8F0] bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-black text-[#0F172A]">{row.label}</p>
                      <p className="mt-1 break-all text-xs font-bold text-[#64748B]">{row.detail}</p>
                    </div>
                    {row.amount != null ? (
                      <span className={`shrink-0 text-sm font-black tabular-nums ${row.amount < 0 ? 'text-[#0F172A]' : 'text-[#047857]'}`}>
                        {row.amount > 0 ? '+' : ''}{row.amount.toFixed(7)} Pi
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-[11px] font-bold text-[#94A3B8]">{row.at}</p>
                </article>
              ))}
              {!visibleHistory.length ? (
                <p className="rounded-[22px] border-2 border-dashed border-[#CBD5E1] bg-white p-5 text-center text-sm font-bold text-[#64748B]">
                  {!historyRows.length ? t('mypage.empty') : t('inbox.emptyFiltered')}
                </p>
              ) : null}
            </div>
          ) : null}

          {innerTab === 'center' ? (
            <div className="space-y-3 pb-4">
              {!rolesReady ? (
                <p className="rounded-[24px] border-2 border-[#E2E8F0] bg-white p-5 text-center text-xs font-bold text-[#64748B]">
                  {t('mypage.checking')}
                </p>
              ) : null}
              {rolesReady && dualRole ? (
                <div className="grid grid-cols-2 gap-1 rounded-[18px] bg-[#F1F5F9] p-1 ring-1 ring-[#E2E8F0]">
                  {([{ id: 'driver', labelKey: 'mypage.modeDriver' }, { id: 'partner', labelKey: 'mypage.modePartner' }] as const).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setCenterRole(item.id)}
                      className={`rounded-[14px] py-2.5 text-xs font-black ${centerRole === item.id ? 'bg-[#4A82B8] text-white shadow-[0_8px_16px_rgba(74,130,184,0.28)]' : 'text-[#64748B]'}`}
                    >
                      {t(item.labelKey)}
                    </button>
                  ))}
                </div>
              ) : null}
              {rolesReady && partnerView ? (
                <PartnerDashboardSafe
                  ownerUid={piUid}
                  ownerName={username}
                  profile={partnerProfile}
                  onEditProfile={partnerProfile ? () => setEditOpen(true) : undefined}
                  onNotice={notify}
                />
              ) : null}
              {rolesReady && !partnerView ? (
              <>
              <article className="rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4">
                <div className="flex items-center gap-2">
                  <Car className="h-5 w-5 text-[#4C1FB8]" />
                  <h3 className="font-black text-[#0F172A]">{t('mypage.driverCard')}</h3>
                </div>
                <p className="mt-2 text-xs font-bold leading-6 text-[#64748B]">{t('mypage.driverDesc')}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={registerDriver}
                    disabled={driverOk}
                    className="rounded-2xl bg-[#4C1FB8] py-3 text-xs font-black text-white disabled:bg-[#CBD5E1] disabled:text-[#64748B]"
                  >
                    {driverOk ? t('mypage.driverDone') : t('mypage.driverReg')}
                  </button>
                  <button
                    type="button"
                    onClick={toggleMode}
                    className="inline-flex items-center justify-center gap-1 rounded-2xl border-2 border-[#4C1FB8] py-3 text-xs font-black text-[#4C1FB8]"
                  >
                    <ToggleRight className="h-4 w-4" />
                    {modeOn ? t('mypage.modePassenger') : t('mypage.modeDriver')}
                  </button>
                </div>
                {driverOk && partnerProfile ? (
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] py-3 text-xs font-black text-[#4A82B8]"
                  >
                    {t('mypage.carEdit')}
                  </button>
                ) : null}
              </article>

              <article className="rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-5 w-5 text-[#C2410C]" />
                  <h3 className="font-black text-[#0F172A]">{t('mypage.partnerCard')}</h3>
                </div>
                <p className="mt-2 text-xs font-bold leading-6 text-[#64748B]">{t('mypage.partnerDesc')}</p>
                <button
                  type="button"
                  onClick={applyPartner}
                  disabled={partnerPending}
                  className="mt-3 w-full rounded-2xl bg-[#EA580C] py-3 text-xs font-black text-white disabled:opacity-60"
                >
                  {partnerPending ? t('mypage.reviewing') : partnerOk ? t('mypage.partnerMore') : t('mypage.partnerApply')}
                </button>
                {partnerOk ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setStatSheet('revenue')} className="rounded-2xl bg-[#FFF7ED] py-3 text-xs font-black text-[#C2410C]">
                      {t('mypage.revenue')}
                    </button>
                    <button type="button" onClick={() => setStatSheet('trips')} className="rounded-2xl bg-[#FFF7ED] py-3 text-xs font-black text-[#C2410C]">
                      {t('mypage.ops')}
                    </button>
                  </div>
                ) : null}
                {partnerOk && partnerProfile ? (
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="mt-2 w-full rounded-2xl border-2 border-[#FED7AA] bg-[#FFF7ED] py-3 text-xs font-black text-[#C2410C]"
                  >
                    {t('mypage.partnerEdit')}
                  </button>
                ) : null}
              </article>

              <article className="rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4">
                <button
                  type="button"
                  onClick={() => setDevicePanelOpen(!devicePanelOpen)}
                  className="flex w-full items-center justify-between gap-2 text-left"
                >
                  <span className="flex items-center gap-2">
                    <MonitorSmartphone className="h-5 w-5 text-[#4A82B8]" />
                    <h3 className="font-black text-[#0F172A]">{t('mypage.devices')}</h3>
                  </span>
                  <span className="text-[11px] font-black text-[#4A82B8]">{devicePanelOpen ? t('mypage.fold') : t('mypage.open')}</span>
                </button>
                <p className="mt-2 text-xs font-bold leading-6 text-[#64748B]">
                  {t('mypage.devicesDesc')}
                </p>
                {devicePanelOpen ? (
                  <div className="mt-3">
                    <PartnerDevicePanel ownerUid={piUid} ownerName={username} onNotice={notify} />
                  </div>
                ) : null}
              </article>
              </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      </div>

      <nav className="shrink-0 border-t border-[#E2E8F0] bg-[#f7f7fb] px-4 pb-3 pt-2">
        <div className="mx-auto grid max-w-md grid-cols-3 gap-1 rounded-[22px] bg-white p-1 shadow-[0_8px_24px_rgba(15,23,42,0.12)] ring-1 ring-[#E2E8F0]">
          {tabs.map((item) => {
            const active = innerTab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setInnerTab(item.id)}
                className={`rounded-[18px] px-1.5 py-2.5 text-[11px] font-black leading-4 ${active ? 'bg-[#4C1FB8] text-white shadow-[0_8px_16px_rgba(76,31,184,0.28)]' : 'text-[#64748B]'}`}
              >
                {t(item.labelKey)}
              </button>
            )
          })}
        </div>
      </nav>

      {toast && !onNotice ? (
        <p className="pointer-events-none fixed bottom-24 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-[#0F172A] px-4 py-2 text-xs font-black text-white">{toast}</p>
      ) : null}
      {statSheet ? <PartnerStatSheet kind={statSheet} onClose={() => setStatSheet(null)} /> : null}
      {inviteLaunchOpen ? <InviteLaunchModal onClose={() => setInviteLaunchOpen(false)} /> : null}
      {b2bOpen && piUid ? <B2bPortal uid={piUid} onClose={() => setB2bOpen(false)} onNotice={notify} /> : null}
      {editOpen && partnerProfile ? (
        <PartnerProfileEditModal
          profile={partnerProfile}
          onClose={() => setEditOpen(false)}
          onSaved={(next) => setPartnerProfile(next)}
          onDone={notify}
        />
      ) : null}
      {mounted && walletSheet
        ? createPortal(
            <div className="fixed inset-0 z-[120] flex items-end justify-center bg-[#1e1033]/45 p-0 sm:items-center sm:p-4" onClick={() => setWalletSheet(false)}>
              <section className="w-full max-w-md rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px]" onClick={(event) => event.stopPropagation()}>
                <p className="text-xs font-black text-[#4A82B8]">PI DIRECT PAY</p>
                <h3 className="mt-1 text-xl font-black text-[#0F172A]">{t('wallet.payHistory')}</h3>
                <p className="mt-3 text-sm font-bold leading-6 text-[#64748B]">
                  {linked ? t('wallet.directPayNote') : t('mypage.walletUnlinkedDesc')}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    writeFlag(PI_ACCOUNT_KEY, true)
                    setLocalPi(true)
                    notify(t(linked ? 'mypage.toastWalletOpen' : 'mypage.toastPiLinked'))
                    setWalletSheet(false)
                  }}
                  className="mt-4 w-full rounded-2xl bg-[#4C1FB8] py-3.5 text-sm font-black text-white"
                >
                  {linked ? t('common.ok') : t('mypage.linkPi')}
                </button>
                <button type="button" onClick={() => setWalletSheet(false)} className="mt-2 w-full py-2 text-sm font-black text-[#64748B]">
                  {t('common.close')}
                </button>
              </section>
            </div>,
            document.body,
          )
        : null}
      {mounted && profileSheet
        ? createPortal(
            <div className="fixed inset-0 z-[120] flex items-end justify-center bg-[#1e1033]/45 p-0 sm:items-center sm:p-4" onClick={() => setProfileSheet(false)}>
              <section className="w-full max-w-md rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px]" onClick={(event) => event.stopPropagation()}>
                <p className="text-xs font-black text-[#4C1FB8]">PROFILE</p>
                <h3 className="mt-1 text-xl font-black text-[#0F172A]">{t('mypage.profileTitle')}</h3>
                <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[#F8FAFC] p-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F3E8FF] text-[#4C1FB8]">
                    <CircleUserRound className="h-7 w-7" />
                  </span>
                  <div>
                    <p className="font-black text-[#0F172A]">{username}</p>
                    <p className="text-xs font-bold text-[#64748B]">{linked ? t('mypage.pioneerLinked') : t('mypage.pioneerUnlinked')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setProfileSheet(false)
                    openWallet()
                  }}
                  className="mt-4 w-full rounded-2xl bg-[#4C1FB8] py-3.5 text-sm font-black text-white"
                >
                  {t('mypage.openWallet')}
                </button>
                {partnerProfile ? (
                  <button
                    type="button"
                    onClick={() => {
                      setProfileSheet(false)
                      setEditOpen(true)
                    }}
                    className="mt-2 w-full rounded-2xl border-2 border-[#4C1FB8] py-3.5 text-sm font-black text-[#4C1FB8]"
                  >
                    {t('mypage.partnerEdit')}
                  </button>
                ) : null}
                <button type="button" onClick={() => setProfileSheet(false)} className="mt-2 w-full py-2 text-sm font-black text-[#64748B]">
                  {t('common.close')}
                </button>
              </section>
            </div>,
            document.body,
          )
        : null}
      {mounted && phoneSheetOpen
        ? createPortal(
            <div className="fixed inset-0 z-[120] flex items-end justify-center bg-[#1e1033]/45 p-0 sm:items-center sm:p-4" onClick={() => setPhoneSheetOpen(false)}>
              <section className="w-full max-w-md rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px]" onClick={(event) => event.stopPropagation()}>
                <p className="text-xs font-black text-[#4A82B8]">{t('mypage.phone')}</p>
                <h3 className="mt-1 text-xl font-black text-[#0F172A]">
                  {memberPhoneValue ? t('mypage.phoneEditTitle') : t('acct.phoneTitle')}
                </h3>
                <p className="mt-2 text-xs font-bold leading-5 text-[#64748B]">{t('acct.phoneDesc')}</p>
                <div className="mt-4">
                  <PhoneVerifyForm initialPhone={memberPhoneValue} onVerified={saveVerifiedPhone} />
                </div>
                <button type="button" onClick={() => setPhoneSheetOpen(false)} className="mt-3 w-full py-2 text-sm font-black text-[#64748B]">
                  {t('common.close')}
                </button>
              </section>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
