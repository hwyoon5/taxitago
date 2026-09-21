'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BadgeCheck, Briefcase, Car, CircleUserRound, Copy, Gift, ShieldCheck, Store, ToggleRight, UserRound, WalletCards } from 'lucide-react'
import PartnerStatSheet from '@/components/partner-stat-sheet'
import { copyInviteCode, getOrCreateInviteCode, inviteShareLink } from '@/lib/invite-code'

const DRIVER_REG_KEY = 'taxitago-is-driver-registered'
const PARTNER_REG_KEY = 'taxitago-is-partner-registered'
const PI_ACCOUNT_KEY = 'taxitago-pi-account-linked'

const DEFAULT_BALANCE = 11.3

type InnerTab = 'profile' | 'history' | 'center'

type RideRow = {
  id: string
  route: string
  vehicle: string
  date: string
  fare: string
  status: '완료' | '진행'
}

const RIDES: RideRow[] = [
  { id: '1', route: '서울시청 → 강남역', vehicle: '택시', date: '오늘 · 09:20', fare: '3.2 Pi', status: '완료' },
  { id: '2', route: '홍대입구 → 합정', vehicle: '대리', date: '어제 · 18:40', fare: '4.8 Pi', status: '완료' },
  { id: '3', route: '여의도 → 공덕', vehicle: '택시', date: '9월 15일 · 14:10', fare: '5.1 Pi', status: '완료' },
  { id: '4', route: '성수 → 건대입구', vehicle: '택시', date: '9월 12일 · 21:05', fare: '2.9 Pi', status: '완료' },
]

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
  balance?: number
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
}

const tabs: { id: InnerTab; label: string }[] = [
  { id: 'profile', label: '내 프로필·역할' },
  { id: 'history', label: '이용 내역' },
  { id: 'center', label: '기사·파트너 센터' },
]

export default function MyPage({
  username = 'taxitago',
  balance,
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
}: MyPageProps) {
  const [innerTab, setInnerTab] = useState<InnerTab>('profile')
  const [localDriver, setLocalDriver] = useState(false)
  const [localPartner, setLocalPartner] = useState(false)
  const [localMode, setLocalMode] = useState(false)
  const [localPi, setLocalPi] = useState(true)
  const [localBalance, setLocalBalance] = useState(DEFAULT_BALANCE)
  const [partnerPending, setPartnerPending] = useState(false)
  const [toast, setToast] = useState('')
  const [statSheet, setStatSheet] = useState<'revenue' | 'trips' | null>(null)
  const [walletSheet, setWalletSheet] = useState(false)
  const [profileSheet, setProfileSheet] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setLocalDriver(readFlag(DRIVER_REG_KEY))
    setLocalPartner(readFlag(PARTNER_REG_KEY))
    setLocalPi(readFlag(PI_ACCOUNT_KEY) || true)
    setLocalBalance(DEFAULT_BALANCE)
    setInviteCode(getOrCreateInviteCode(username))
  }, [username])

  const notify = (message: string) => {
    onNotice?.(message)
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }

  const driverOk = isDriverRegistered ?? localDriver
  const partnerOk = isPartnerRegistered ?? localPartner
  const modeOn = driverMode ?? localMode
  const linked = piLinked ?? localPi
  const piBalance = balance ?? localBalance

  const registerDriver = () => {
    if (onOpenDriverSignup) {
      onOpenDriverSignup()
      return
    }
    writeFlag(DRIVER_REG_KEY, true)
    setLocalDriver(true)
    setLocalMode(true)
    notify('인증기사로 등록되었고 기사 모드로 전환했어요.')
  }

  const toggleMode = () => {
    if (onToggleDriverMode) {
      onToggleDriverMode()
      return
    }
    if (!driverOk) {
      notify('먼저 기사 등록을 완료해 주세요.')
      setInnerTab('center')
      return
    }
    setLocalMode((value) => {
      const next = !value
      notify(next ? '기사 모드로 전환했어요.' : '승객 모드로 전환했어요.')
      return next
    })
  }

  const applyPartner = () => {
    if (partnerOk) {
      notify('이미 파트너로 등록되어 있어요.')
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
      notify('파트너 신청이 승인되었어요.')
    }, 1200)
  }

  const openWallet = () => {
    if (onOpenWallet) onOpenWallet()
    else setWalletSheet(true)
  }

  const openProfile = () => {
    setProfileSheet(true)
  }

  const shareLink = inviteCode ? inviteShareLink(inviteCode) : ''

  const handleCopyInviteCode = async () => {
    if (!inviteCode) return
    try {
      await copyInviteCode(inviteCode)
      setCopied(true)
      notify('초대 코드가 복사되었어요.')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      notify('코드를 복사하지 못했어요. 다시 시도해 주세요.')
    }
  }

  return (
    <div className={`flex min-h-0 flex-col ${embedded ? 'h-full' : 'h-dvh bg-[#F4F1FA]'}`}>
      <div className="min-h-0 flex-1 overflow-y-auto pb-40">
      {!embedded ? (
        <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 pb-2 pt-5">
          <Link href="/" className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-[#4C1FB8] shadow-sm">
            홈
          </Link>
          <h1 className="text-lg font-black text-[#0F172A]">내 정보</h1>
          <span className="w-10" />
        </header>
      ) : (
        <h2 className="px-5 pt-1 text-2xl font-black text-[#0F172A]">내 정보</h2>
      )}

      <div className="mx-auto w-full max-w-md px-4">
        <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#1E1B4B] via-[#4C1FB8] to-[#0F172A] p-5 text-white shadow-[0_16px_32px_rgba(76,31,184,0.32)]">
          <button type="button" onClick={openWallet} className="flex w-full items-start justify-between gap-3 text-left">
            <div>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#FDE68A] px-2.5 py-1 text-[10px] font-black tracking-wide text-[#92400E]">
                <BadgeCheck className="h-3.5 w-3.5" />
                Pi Network Pioneer
              </span>
              <p className="mt-3 text-xs font-bold text-white/70">연동된 Pi 지갑</p>
              <p className="mt-0.5 text-sm font-black">@{username}</p>
            </div>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
              <WalletCards className="h-6 w-6" />
            </span>
          </button>
          <div className="mt-5 rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
            <p className="text-[11px] font-bold text-white/70">{linked ? '사용 가능 잔액' : 'Pi 계정 연동 필요'}</p>
            <p className="mt-1 text-3xl font-black tracking-tight">{piBalance.toFixed(2)} <span className="text-lg font-black text-[#FDE68A]">Pi</span></p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                openWallet()
              }}
              className="mt-4 w-full rounded-2xl bg-white py-3 text-sm font-black text-[#4C1FB8] shadow-[0_8px_16px_rgba(15,23,42,0.18)]"
            >
              지갑 관리
            </button>
          </div>
        </section>

        <section className="mt-3 rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.06)]">
          <p className="text-[11px] font-black tracking-wide text-[#64748B]">보유 권한</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EEF2FF] px-3 py-1.5 text-xs font-black text-[#3730A3]">
              <UserRound className="h-3.5 w-3.5" />
              승객
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${driverOk ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#F1F5F9] text-[#94A3B8]'}`}>
              <ShieldCheck className="h-3.5 w-3.5" />
              인증기사{driverOk ? '' : ' · 미등록'}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${partnerOk ? 'bg-[#FFF7ED] text-[#C2410C]' : 'bg-[#F1F5F9] text-[#94A3B8]'}`}>
              <Store className="h-3.5 w-3.5" />
              파트너{partnerOk ? '' : ' · 미신청'}
            </span>
          </div>
        </section>

        <section className="mt-3 overflow-hidden rounded-[24px] border-2 border-[#EDE5FF] bg-white p-4 shadow-[0_8px_20px_rgba(15,23,42,0.06)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black tracking-wide text-[#4C1FB8]">INVITE & SHARE</p>
              <h3 className="mt-1 text-base font-black text-[#0F172A]">친구 초대 및 코드 공유</h3>
            </div>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#F3E8FF] text-[#4C1FB8]">
              <Gift className="h-5 w-5" />
            </span>
          </div>
          <div className="mt-3 rounded-2xl border border-[#FCD34D] bg-[#FFFBEB] px-3.5 py-3">
            <p className="text-sm font-black leading-6 text-[#92400E]">친구 초대 시 각각 0.5 Pi가 지급됩니다</p>
            <p className="mt-0.5 text-[11px] font-bold leading-5 text-[#B45309]">초대한 친구와 회원님 모두 0.5 Pi를 받아요.</p>
          </div>
          <div className="mt-3 rounded-2xl bg-[#F8F5FF] px-4 py-3">
            <p className="text-[10px] font-black tracking-wide text-[#64748B]">내 초대 코드</p>
            <p className="mt-1 break-all font-mono text-lg font-black tracking-[0.18em] text-[#4C1FB8]">{inviteCode || '생성 중…'}</p>
            {shareLink ? <p className="mt-1 break-all text-[11px] font-bold leading-5 text-[#64748B]">{shareLink}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => void handleCopyInviteCode()}
            disabled={!inviteCode}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4C1FB8] py-3.5 text-sm font-black text-white shadow-[0_8px_16px_rgba(76,31,184,0.28)] disabled:opacity-50"
          >
            <Copy className="h-4 w-4" />
            {copied ? '복사됨' : '코드 복사하기'}
          </button>
        </section>

        <div className="mt-4">
          {innerTab === 'profile' ? (
            <div className="space-y-3">
              <button type="button" onClick={openProfile} className="w-full rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4 text-left">
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#F3E8FF] text-[#4C1FB8]">
                    <CircleUserRound className="h-7 w-7" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-base font-black text-[#0F172A]">{username}</p>
                    <p className="mt-0.5 text-xs font-bold leading-5 text-[#64748B]">파이 모빌리티 · Pioneer 회원 · 탭하여 설정</p>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-2xl bg-[#F8FAFC] p-3">
                    <dt className="text-[10px] font-black text-[#94A3B8]">현재 역할</dt>
                    <dd className="mt-1 font-black text-[#0F172A]">{modeOn ? '기사 모드' : '승객 모드'}</dd>
                  </div>
                  <div className="rounded-2xl bg-[#F8FAFC] p-3">
                    <dt className="text-[10px] font-black text-[#94A3B8]">Pi 연동</dt>
                    <dd className="mt-1 font-black text-[#0F172A]">{linked ? '연동됨' : '미연동'}</dd>
                  </div>
                </dl>
              </button>
              <p className="whitespace-normal break-keep px-1 text-xs font-bold leading-6 text-[#64748B]">
                승객은 기본 권한입니다. 기사·파트너 권한은 하단 [기사·파트너 센터] 탭에서 등록하면 배지에 바로 반영됩니다.
              </p>
            </div>
          ) : null}

          {innerTab === 'history' ? (
            <div className="space-y-2">
              {RIDES.map((ride) => (
                <article key={ride.id} className="rounded-[22px] border-2 border-[#E2E8F0] bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-[#0F172A]">{ride.route}</p>
                      <p className="mt-1 text-xs font-bold text-[#64748B]">{ride.vehicle} · {ride.date}</p>
                    </div>
                    <span className="text-sm font-black text-[#4C1FB8]">{ride.fare}</span>
                  </div>
                  <p className="mt-3 text-[11px] font-black text-[#10B981]">{ride.status}</p>
                </article>
              ))}
            </div>
          ) : null}

          {innerTab === 'center' ? (
            <div className="space-y-3 pb-4">
              <article className="rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4">
                <div className="flex items-center gap-2">
                  <Car className="h-5 w-5 text-[#4C1FB8]" />
                  <h3 className="font-black text-[#0F172A]">기사</h3>
                </div>
                <p className="mt-2 text-xs font-bold leading-6 text-[#64748B]">등록하면 인증기사 배지가 켜지고, 승객/기사 모드를 전환할 수 있어요.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={registerDriver}
                    disabled={driverOk}
                    className="rounded-2xl bg-[#4C1FB8] py-3 text-xs font-black text-white disabled:bg-[#CBD5E1] disabled:text-[#64748B]"
                  >
                    {driverOk ? '기사 등록 완료' : '기사 등록'}
                  </button>
                  <button
                    type="button"
                    onClick={toggleMode}
                    className="inline-flex items-center justify-center gap-1 rounded-2xl border-2 border-[#4C1FB8] py-3 text-xs font-black text-[#4C1FB8]"
                  >
                    <ToggleRight className="h-4 w-4" />
                    {modeOn ? '승객 모드' : '기사 모드'}
                  </button>
                </div>
              </article>

              <article className="rounded-[24px] border-2 border-[#E2E8F0] bg-white p-4">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-5 w-5 text-[#C2410C]" />
                  <h3 className="font-black text-[#0F172A]">파트너</h3>
                </div>
                <p className="mt-2 text-xs font-bold leading-6 text-[#64748B]">가맹점·업체로 신청하면 파트너 배지가 활성화되고 수익·운행을 관리할 수 있어요.</p>
                <button
                  type="button"
                  onClick={applyPartner}
                  disabled={partnerPending}
                  className="mt-3 w-full rounded-2xl bg-[#EA580C] py-3 text-xs font-black text-white disabled:opacity-60"
                >
                  {partnerPending ? '심사 중…' : partnerOk ? '추가 파트너 신청' : '파트너 신청'}
                </button>
                {partnerOk ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setStatSheet('revenue')} className="rounded-2xl bg-[#FFF7ED] py-3 text-xs font-black text-[#C2410C]">
                      수익 관리
                    </button>
                    <button type="button" onClick={() => setStatSheet('trips')} className="rounded-2xl bg-[#FFF7ED] py-3 text-xs font-black text-[#C2410C]">
                      운행 관리
                    </button>
                  </div>
                ) : null}
              </article>
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
                {item.label}
              </button>
            )
          })}
        </div>
      </nav>

      {toast && !onNotice ? (
        <p className="pointer-events-none fixed bottom-24 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-[#0F172A] px-4 py-2 text-xs font-black text-white">{toast}</p>
      ) : null}
      {statSheet ? <PartnerStatSheet kind={statSheet} onClose={() => setStatSheet(null)} /> : null}
      {mounted && walletSheet
        ? createPortal(
            <div className="fixed inset-0 z-[120] flex items-end justify-center bg-[#1e1033]/45 p-0 sm:items-center sm:p-4" onClick={() => setWalletSheet(false)}>
              <section className="w-full max-w-md rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px]" onClick={(event) => event.stopPropagation()}>
                <p className="text-xs font-black text-[#4C1FB8]">PI WALLET</p>
                <h3 className="mt-1 text-xl font-black text-[#0F172A]">Pi 월렛 관리</h3>
                <p className="mt-3 text-sm font-bold leading-6 text-[#64748B]">
                  {linked ? `@${username} 지갑이 연동되어 있습니다. 충전·출금은 이 화면에서 확인할 수 있어요.` : 'Pi 계정을 연동하면 잔액 충전과 출금을 사용할 수 있어요.'}
                </p>
                <div className="mt-4 rounded-2xl bg-[#F8F5FF] p-4">
                  <p className="text-[11px] font-black text-[#64748B]">사용 가능 잔액</p>
                  <p className="mt-1 text-2xl font-black text-[#4C1FB8]">{piBalance.toFixed(2)} Pi</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    writeFlag(PI_ACCOUNT_KEY, true)
                    setLocalPi(true)
                    notify(linked ? 'Pi 월렛 상세를 열었어요.' : 'Pi 계정 연동이 완료되었습니다.')
                    setWalletSheet(false)
                  }}
                  className="mt-4 w-full rounded-2xl bg-[#4C1FB8] py-3.5 text-sm font-black text-white"
                >
                  {linked ? '확인' : 'Pi 계정 연동하기'}
                </button>
                <button type="button" onClick={() => setWalletSheet(false)} className="mt-2 w-full py-2 text-sm font-black text-[#64748B]">
                  닫기
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
                <h3 className="mt-1 text-xl font-black text-[#0F172A]">프로필 · 계정 설정</h3>
                <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[#F8FAFC] p-4">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F3E8FF] text-[#4C1FB8]">
                    <CircleUserRound className="h-7 w-7" />
                  </span>
                  <div>
                    <p className="font-black text-[#0F172A]">{username}</p>
                    <p className="text-xs font-bold text-[#64748B]">{linked ? 'Pi Pioneer · 연동됨' : 'Pi Pioneer · 미연동'}</p>
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
                  지갑 관리 열기
                </button>
                <button type="button" onClick={() => setProfileSheet(false)} className="mt-2 w-full py-2 text-sm font-black text-[#64748B]">
                  닫기
                </button>
              </section>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
