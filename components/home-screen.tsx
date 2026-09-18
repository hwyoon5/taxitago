'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Bell, Bike, Briefcase, Building2, Camera, Car, Check, ChevronLeft, ChevronUp, CircleUserRound, Clock, Copy, FileSpreadsheet, House, LayoutGrid, LoaderCircle, LocateFixed, MapPin, MessageCircle, Minus, Phone, PhoneOff, Plus, Search, Share2, Star, ToggleRight, UserRound, WalletCards, X } from 'lucide-react'
import { notices, type Notice } from '@/lib/notices'
import MoreMenu, { type MoreItemId } from '@/components/more/more-menu'
import { FaresView, NoticeDetailView, NoticeListView, SettingsView, SupportView } from '@/components/more/more-pages'
import { PaymentHandler, QrScanModal } from '@/components/PaymentHandler'
import { serviceIllustrations } from '@/components/service-illustrations'
import { LocationTileMap, SEOUL_CITY_HALL, TaxiLiveMap, toTaxiLivePhase, type TaxiMatchPhase } from '@/components/app-map'
import { getPaymentPolicy } from '@/lib/payment-policy'
import { isRidePayLabel, settleRideFare } from '@/lib/ride-fare'
import { startPiCheckout, PiCheckoutButton, describePiUserMessage, chargePiWallet, PI_SANDBOX } from '@/components/pi-checkout'
import MyPage from '@/components/my-page'

const LOCAL_TEST_USER = { username: 'taxitago' }

type ServiceLabel = keyof typeof serviceIllustrations
type Service = { label: ServiceLabel }

const navItems = [
  { id: '전체보기', label: '전체보기', icon: LayoutGrid },
  { id: '비즈니스', label: '비즈니스', icon: Briefcase },
  { id: '홈', label: '홈', icon: House },
  { id: '이용/알림', label: '이용/알림', icon: Bell },
  { id: '내 정보', label: '내 정보', icon: CircleUserRound },
] as const

const services: Service[] = [
  { label: '택시' },
  { label: '대리운전' },
  { label: '주차' },
  { label: '자전거' },
  { label: '킥보드' },
  { label: 'EV 충전' },
  { label: '택배' },
  { label: '더보기' },
]

function ServiceIconButton({
  service,
  onClick,
  compact = false,
}: {
  service: Service
  onClick: () => void
  compact?: boolean
}) {
  const Illustration = serviceIllustrations[service.label]
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      aria-label={`${service.label} 서비스 열기`}
      className="group flex flex-col items-center"
    >
      <span className={`flex items-center justify-center bg-white shadow-[0_8px_22px_rgba(15,23,42,0.10)] ring-1 ring-black/[0.04] transition group-hover:-translate-y-0.5 group-active:scale-95 ${compact ? 'h-12 w-12 rounded-[16px]' : 'h-16 w-16 rounded-[22px]'}`}>
        <Illustration />
      </span>
      <span className={`whitespace-nowrap font-black tracking-tight text-[#0F172A] ${compact ? 'mt-1 text-[11px]' : 'mt-2 text-[13px]'}`}>
        {service.label}
      </span>
    </button>
  )
}


const SUGGESTED_DESTINATIONS = [
  { name: '부산역', address: '부산광역시 동구 중앙대로 206' },
  { name: '서면 롯데백화점', address: '부산광역시 부산진구 가야대로 772' },
  { name: '해운대 해수욕장', address: '부산광역시 해운대구 해운대해변로 264' },
  { name: '김해공항', address: '부산광역시 강서구 공항진입로 108' },
] as const

type GpsFix = {
  status: 'pending' | 'ready' | 'denied'
  address: string
  lat: number
  lng: number
}

type PickupPlace = {
  address: string
  lat: number
  lng: number
  source: 'gps' | 'map'
}

const VIRTUAL_AREAS = [
  { name: '서울특별시 중구 태평로', lat: 37.5665, lng: 126.978 },
  { name: '서울특별시 강남구 역삼동', lat: 37.501, lng: 127.037 },
  { name: '서울특별시 마포구 서교동', lat: 37.555, lng: 126.923 },
  { name: '부산광역시 북구 구포동', lat: 35.194, lng: 129.004 },
  { name: '부산광역시 해운대구 우동', lat: 35.163, lng: 129.163 },
  { name: '인천광역시 남동구 구월동', lat: 37.449, lng: 126.731 },
  { name: '대구광역시 중구 동성로', lat: 35.869, lng: 128.595 },
  { name: '대전광역시 서구 둔산동', lat: 36.351, lng: 127.385 },
  { name: '광주광역시 동구 충장로', lat: 35.15, lng: 126.917 },
  { name: '경기도 성남시 분당구 정자동', lat: 37.36, lng: 127.108 },
]

function virtualPickupAddress(lat: number, lng: number) {
  const nearest = VIRTUAL_AREAS.reduce((best, area) => {
    const distance = (area.lat - lat) ** 2 + (area.lng - lng) ** 2
    return distance < best.distance ? { area, distance } : best
  }, { area: VIRTUAL_AREAS[0], distance: Number.POSITIVE_INFINITY })
  const street = Math.abs(Math.round((lat + lng) * 8000)) % 120 + 1
  return `${nearest.area.name} ${street} 인근 선택지점`
}

function formatMapAddress(data: {
  display_name?: string
  address?: {
    city?: string
    province?: string
    county?: string
    borough?: string
    suburb?: string
    town?: string
    village?: string
    road?: string
    neighbourhood?: string
    quarter?: string
    city_district?: string
  }
}) {
  const detail = data.address
  if (detail) {
    const region = detail.province || detail.city || detail.county || ''
    const district = detail.borough || detail.city_district || detail.suburb || detail.town || detail.village || ''
    const road = detail.road || detail.neighbourhood || detail.quarter || ''
    const parts = [region, district, road].filter(Boolean)
    if (parts.length) return parts.join(' ')
  }
  return data.display_name?.split(',').slice(0, 3).join(' ').replace(/\s+/g, ' ').trim() || ''
}

async function lookupMapAddress(lat: number, lng: number) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ko`,
      { headers: { Accept: 'application/json' } },
    )
    if (!response.ok) return virtualPickupAddress(lat, lng)
    const data = (await response.json()) as Parameters<typeof formatMapAddress>[0]
    return formatMapAddress(data) || virtualPickupAddress(lat, lng)
  } catch {
    return virtualPickupAddress(lat, lng)
  }
}

function FullscreenMapView({
  lat,
  lng,
  address,
  pickupLat,
  pickupLng,
  onClose,
  onConfirmPickup,
}: {
  lat: number
  lng: number
  address: string
  pickupLat: number
  pickupLng: number
  onClose: () => void
  onConfirmPickup: (place: { lat: number; lng: number; address: string }) => void
}) {
  const [pin, setPin] = useState({ lat: pickupLat, lng: pickupLng })
  const [pickedAddress, setPickedAddress] = useState<string | null>(null)
  const [addressPending, setAddressPending] = useState(false)
  const [askConfirm, setAskConfirm] = useState(false)
  const lookupSeq = useRef(0)

  const resetToGps = () => {
    lookupSeq.current += 1
    setPin({ lat, lng })
    setPickedAddress(null)
    setAskConfirm(false)
    setAddressPending(false)
  }

  const handlePick = (nextLat: number, nextLng: number) => {
    const seq = lookupSeq.current + 1
    lookupSeq.current = seq
    setPin({ lat: nextLat, lng: nextLng })
    setAskConfirm(false)
    setAddressPending(true)
    const fallback = virtualPickupAddress(nextLat, nextLng)
    setPickedAddress(fallback)
    const settle = (nextAddress: string) => {
      if (lookupSeq.current !== seq) return
      setPickedAddress(nextAddress)
      setAddressPending(false)
    }
    const timer = window.setTimeout(() => settle(fallback), 2500)
    void lookupMapAddress(nextLat, nextLng).then((nextAddress) => {
      window.clearTimeout(timer)
      settle(nextAddress)
    })
  }

  const confirmPickup = () => {
    if (!pickedAddress) return
    onConfirmPickup({ lat: pin.lat, lng: pin.lng, address: pickedAddress })
  }

  const handlePopup = () => {
    if (!pickedAddress) return
    if (!askConfirm) {
      setAskConfirm(true)
      return
    }
    confirmPickup()
  }

  return (
    <div className="fixed inset-0 z-[100] bg-[#E2E8F0]" role="dialog" aria-modal="true" aria-label="전체화면 지도">
      <LocationTileMap
        lat={lat}
        lng={lng}
        pinLat={pin.lat}
        pinLng={pin.lng}
        className="h-full min-h-0 w-full touch-none"
        interactive
        showZoom
        pulsePin
        locatePlacement="bottom"
        onPick={handlePick}
        onLocate={resetToGps}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute left-4 top-[max(0.9rem,env(safe-area-inset-top))] z-30 inline-flex min-h-10 items-center gap-0.5 rounded-full bg-white/95 px-3.5 pr-4 text-[13px] font-black text-[#0F172A] shadow-[0_8px_20px_rgba(15,23,42,0.18)]"
        aria-label="뒤로가기"
      >
        <ChevronLeft className="h-5 w-5" />
        뒤로가기
      </button>
      {!pickedAddress ? (
        <div className="pointer-events-none absolute inset-x-4 top-[max(4.2rem,calc(env(safe-area-inset-top)+3.3rem))] z-30">
          <p className="rounded-2xl bg-white/95 px-3.5 py-2.5 text-[12px] font-bold leading-snug text-[#334155] shadow-[0_8px_18px_rgba(15,23,42,0.12)]">
            현재 위치 · {address}
          </p>
        </div>
      ) : (
        <div className="absolute inset-x-4 top-[max(4.2rem,calc(env(safe-area-inset-top)+3.3rem))] z-30 flex justify-center">
          <div className="w-full max-w-sm rounded-2xl border border-[#E2E8F0] bg-white px-4 py-3 text-left shadow-[0_12px_28px_rgba(15,23,42,0.18)]">
            {askConfirm ? (
              <button type="button" onClick={confirmPickup} className="w-full text-left">
                <span className="block text-[11px] font-bold text-[#7C3AED]">출발지 지정</span>
                <span className="mt-1 block text-[15px] font-black leading-snug text-[#4C1FB8]">출발지로 할까요?</span>
                <span className="mt-1 block text-[12px] font-bold leading-snug text-[#64748B]">{pickedAddress}</span>
              </button>
            ) : (
              <button type="button" onClick={handlePopup} className="w-full text-left">
                <span className="block text-[11px] font-bold text-[#7C3AED]">선택한 위치</span>
                <span className="mt-1 block text-[14px] font-black leading-snug text-[#0F172A]">
                  {addressPending ? `${pickedAddress}` : pickedAddress}
                </span>
                <span className="mt-1 block text-[11px] font-bold text-[#94A3B8]">주소를 눌러 출발지로 지정</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function LocationMapModal({ onClose }: { onClose: () => void }) {
  const [gpsPending, setGpsPending] = useState(true)
  const [addressPending, setAddressPending] = useState(true)
  const [mapCenter, setMapCenter] = useState(SEOUL_CITY_HALL)
  const [pin, setPin] = useState({ lat: SEOUL_CITY_HALL.lat, lng: SEOUL_CITY_HALL.lng })
  const [address, setAddress] = useState(virtualPickupAddress(SEOUL_CITY_HALL.lat, SEOUL_CITY_HALL.lng))
  const [source, setSource] = useState<'fallback' | 'gps' | 'pick'>('fallback')
  const lookupSeq = useRef(0)

  const applyPoint = (lat: number, lng: number, nextSource: 'fallback' | 'gps' | 'pick', recenter = false) => {
    const seq = lookupSeq.current + 1
    lookupSeq.current = seq
    setPin({ lat, lng })
    if (recenter) setMapCenter({ lat, lng, label: nextSource === 'gps' ? '현재 위치' : '선택 위치' })
    setSource(nextSource)
    setAddressPending(true)
    setAddress(virtualPickupAddress(lat, lng))
    void lookupMapAddress(lat, lng).then((nextAddress) => {
      if (lookupSeq.current !== seq) return
      setAddress(nextAddress)
      setAddressPending(false)
    })
  }

  useEffect(() => {
    applyPoint(SEOUL_CITY_HALL.lat, SEOUL_CITY_HALL.lng, 'fallback', true)
    if (!navigator.geolocation) {
      setGpsPending(false)
      return
    }
    const timer = window.setTimeout(() => setGpsPending(false), 6000)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timer)
        applyPoint(position.coords.latitude, position.coords.longitude, 'gps', true)
        setGpsPending(false)
      },
      () => {
        window.clearTimeout(timer)
        setGpsPending(false)
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60_000 },
    )
    return () => window.clearTimeout(timer)
  }, [])

  const statusLabel = gpsPending
    ? 'GPS로 현재 위치를 확인하는 중이에요.'
    : source === 'pick'
      ? '지도를 터치한 지점의 주소입니다.'
      : source === 'gps'
        ? '스마트폰 GPS 기준 현재 위치입니다.'
        : '위치 권한이 없어 서울시청을 기준으로 표시했어요.'

  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-[#1e293b]/45 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto w-full max-w-md overflow-hidden rounded-t-[30px] bg-white shadow-2xl sm:rounded-[30px]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.14em] text-[#3b1d8f]">MY LOCATION</p>
            <h2 className="mt-1 text-[26px] font-semibold leading-tight text-[#0f172a]">내 위치</h2>
            <p className="mt-1.5 text-sm font-medium leading-relaxed text-[#334155]">{statusLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-full bg-[#F1F5F9] p-2 text-[#0f172a]" aria-label="지도 닫기">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 pb-3">
          <div className="rounded-2xl border-2 border-[#334155] bg-[#f8fafc] px-3.5 py-3">
            <p className="text-xs font-semibold text-[#3b1d8f]">{source === 'pick' ? '선택한 주소' : '현재 위치 주소'}</p>
            <p className="mt-1 text-base font-semibold leading-snug text-[#0f172a]">
              {addressPending ? '주소를 불러오는 중…' : address}
            </p>
          </div>
        </div>
        <div className="relative mx-4 overflow-hidden rounded-[24px] border-2 border-[#334155] bg-[#E2E8F0]">
          <LocationTileMap
            lat={mapCenter.lat}
            lng={mapCenter.lng}
            pinLat={pin.lat}
            pinLng={pin.lng}
            className="h-[340px]"
            interactive
            onPick={(lat, lng) => applyPoint(lat, lng, 'pick')}
          />
          <div className="pointer-events-none absolute inset-x-3 top-3">
            <div className="rounded-2xl bg-white/95 px-3 py-2.5 shadow-[0_8px_18px_rgba(15,23,42,0.14)]">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-[#3b1d8f]">
                <MapPin className="h-3.5 w-3.5" />
                {source === 'pick' ? '터치한 위치' : '현재 위치'}
              </p>
              <p className="mt-1 text-sm font-semibold leading-snug text-[#0f172a]">
                {addressPending ? '주소를 불러오는 중…' : address}
              </p>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-3 bottom-8">
            <p className="rounded-xl bg-[#0f172a]/90 px-3 py-2 text-center text-sm font-medium leading-snug text-white">
              지도를 터치하면 핀이 이동하고 주소가 바뀝니다
            </p>
          </div>
        </div>
        <div className="px-5 pb-6 pt-4">
          <button type="button" onClick={onClose} className="w-full rounded-2xl bg-[#3b1d8f] py-3.5 text-base font-semibold text-white">
            닫기
          </button>
        </div>
      </section>
    </div>
  )
}

const FAVORITES_KEY = 'taxitago-favorite-places'
const WALLET_KEY = 'taxitago-pi-wallet'
const DRIVER_REG_KEY = 'taxitago-is-driver-registered'
const PARTNER_REG_KEY = 'taxitago-is-partner-registered'
const PI_ACCOUNT_KEY = 'taxitago-pi-account-linked'
const READ_NOTICES_KEY = 'taxitago-read-notices'
const RECENT_DEST_KEY = 'taxitago-recent-destinations'
const PICKUP_KEY = 'taxitago-pickup-place'

type FavoritePlace = { id: string; name: string; address: string }
type RecentPlace = { id: string; name: string; address: string }
type PiTransaction = { label: string; amount: number; detail: string; place: string; at: string; estimated?: number }
type RideReceipt = {
  route: string
  origin: string
  dest: string
  fare: string
  estimatedFare?: string
  vehicle: string
  date: string
  distance: string
  duration: string
  driver: string
  car: string
  plate: string
  transactionId: string
  method: string
}

const SAMPLE_RIDES: RideReceipt[] = [
  {
    route: '서울시청 → 강남역',
    origin: '서울시청',
    dest: '강남역',
    fare: '3.2 Pi',
    vehicle: '택시',
    date: '오늘 · 09:20',
    distance: '5.2 km',
    duration: '18분',
    driver: '김민수',
    car: '현대 아슬란',
    plate: '서울 31바 1842',
    transactionId: 'TX-240618-0920',
    method: 'Pi 월렛',
  },
  {
    route: '인천공항 → 홍대입구',
    origin: '인천공항',
    dest: '홍대입구',
    fare: '12.5 Pi',
    vehicle: '프리미엄',
    date: '어제 · 18:40',
    distance: '54.8 km',
    duration: '72분',
    driver: '이준호',
    car: '제네시스 G80',
    plate: '서울 12아 5521',
    transactionId: 'TX-240617-1840',
    method: 'Pi 월렛',
  },
  {
    route: '홍대입구 → 서울역',
    origin: '홍대입구',
    dest: '서울역',
    fare: '2.1 Pi',
    vehicle: '택시',
    date: '6월 12일 · 14:10',
    distance: '3.4 km',
    duration: '14분',
    driver: '박서연',
    car: '현대 소나타',
    plate: '서울 33바 9081',
    transactionId: 'TX-240612-1410',
    method: 'Pi 월렛',
  },
]

function receiptFromTransaction(tx: PiTransaction, index: number): RideReceipt {
  const matched = SAMPLE_RIDES.find((ride) => ride.route === tx.place)
  const estimatedFare = tx.estimated != null ? `${tx.estimated.toFixed(2)} Pi` : undefined
  if (matched) {
    return { ...matched, fare: `${Math.abs(tx.amount).toFixed(2)} Pi`, estimatedFare, date: tx.at, vehicle: tx.label }
  }
  const isRoute = tx.place.includes('→')
  const [origin, dest] = isRoute ? tx.place.split(' → ') : [tx.place, '']
  const rideLike = isRoute || (tx.amount < 0 && /택시|대리|호출/.test(tx.label))
  return {
    route: isRoute ? tx.place : `${tx.label}`,
    origin: origin.trim() || tx.label,
    dest: (dest || (rideLike ? '목적지' : 'Pi 월렛')).trim(),
    fare: `${Math.abs(tx.amount).toFixed(2)} Pi`,
    estimatedFare,
    vehicle: tx.label,
    date: tx.at,
    distance: rideLike ? '5.2 km' : '-',
    duration: rideLike ? '18분' : '-',
    driver: rideLike ? '김민수' : '-',
    car: rideLike ? '현대 아슬란' : '-',
    plate: rideLike ? '서울 31바 1842' : '-',
    transactionId: `TX-${String(index + 1).padStart(4, '0')}-${tx.at.replace(/[^0-9]/g, '').slice(0, 8) || '000000'}`,
    method: 'Pi 월렛',
  }
}

const DEFAULT_PI_TX: PiTransaction[] = [
  { label: '택시 이용', amount: -3.2, detail: '어제 18:40', place: '서울시청 → 강남역', at: '어제 18:40' },
  { label: 'Pi 충전', amount: 10, detail: '어제 12:00', place: 'Pi 월렛', at: '어제 12:00' },
]

function formatPiTime() {
  const now = new Date()
  const month = now.getMonth() + 1
  const day = now.getDate()
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  return `${month}월 ${day}일 ${hours}:${minutes}`
}

function readPiWallet(): { balance: number; transactions: PiTransaction[] } {
  try {
    const raw = window.localStorage.getItem(WALLET_KEY)
    if (!raw) return { balance: 18.4, transactions: DEFAULT_PI_TX }
    const parsed = JSON.parse(raw) as { balance?: number; transactions?: PiTransaction[] }
    return {
      balance: typeof parsed.balance === 'number' ? parsed.balance : 18.4,
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : DEFAULT_PI_TX,
    }
  } catch {
    return { balance: 18.4, transactions: DEFAULT_PI_TX }
  }
}

function writePiWallet(balance: number, transactions: PiTransaction[]) {
  window.localStorage.setItem(WALLET_KEY, JSON.stringify({ balance, transactions }))
}

function loadIsDriverRegistered() {
  try {
    return window.localStorage.getItem(DRIVER_REG_KEY) === 'true'
  } catch {
    return false
  }
}

function saveIsDriverRegistered(value: boolean) {
  if (value) {
    window.localStorage.setItem(DRIVER_REG_KEY, 'true')
    return
  }
  window.localStorage.removeItem(DRIVER_REG_KEY)
}

function loadIsPartnerRegistered() {
  try {
    return window.localStorage.getItem(PARTNER_REG_KEY) === 'true'
  } catch {
    return false
  }
}

function saveIsPartnerRegistered(value: boolean) {
  if (value) {
    window.localStorage.setItem(PARTNER_REG_KEY, 'true')
    return
  }
  window.localStorage.removeItem(PARTNER_REG_KEY)
}

function loadIsPiLinked() {
  try {
    return window.localStorage.getItem(PI_ACCOUNT_KEY) === 'true'
  } catch {
    return false
  }
}

function saveIsPiLinked(value: boolean) {
  if (value) {
    window.localStorage.setItem(PI_ACCOUNT_KEY, 'true')
    return
  }
  window.localStorage.removeItem(PI_ACCOUNT_KEY)
}

function loadReadNoticeIds(): string[] {
  try {
    const raw = window.localStorage.getItem(READ_NOTICES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as string[]
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

function saveReadNoticeIds(ids: string[]) {
  window.localStorage.setItem(READ_NOTICES_KEY, JSON.stringify(ids))
}

function readPickupPlace(): PickupPlace | null {
  try {
    const raw = window.localStorage.getItem(PICKUP_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PickupPlace>
    if (typeof parsed.address !== 'string' || typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null
    if (parsed.source !== 'gps' && parsed.source !== 'map') return null
    return { address: parsed.address, lat: parsed.lat, lng: parsed.lng, source: parsed.source }
  } catch {
    return null
  }
}

function writePickupPlace(place: PickupPlace) {
  window.localStorage.setItem(PICKUP_KEY, JSON.stringify(place))
}

function readFavoritePlaces(): FavoritePlace[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as FavoritePlace[]
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.name) : []
  } catch {
    return []
  }
}

function writeFavoritePlaces(places: FavoritePlace[]) {
  window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(places))
}

const DEFAULT_RECENT_PLACES: RecentPlace[] = [
  { id: 'r1', name: '강남역', address: '서울 강남구 강남대로 396' },
  { id: 'r2', name: '홍대입구역', address: '서울 마포구 양화로 188' },
  { id: 'r3', name: '서울역', address: '서울 중구 한강대로 405' },
]

const PLACE_CATALOG = [
  { name: '강남역 2번 출구', address: '서울 강남구 강남대로 396', hint: '지하철 2호선' },
  { name: '강남역 카카오T 정류장', address: '서울 강남구 테헤란로 152', hint: '택시 승하차' },
  { name: '선릉역', address: '서울 강남구 테헤란로 340', hint: '지하철 2호선' },
  { name: '삼성역 코엑스', address: '서울 강남구 영동대로 513', hint: '코엑스몰' },
  { name: '홍대입구역 9번 출구', address: '서울 마포구 양화로 188', hint: '지하철 2호선' },
  { name: '합정역', address: '서울 마포구 양화로 45', hint: '지하철 2·6호선' },
  { name: '서울역 서부역', address: '서울 중구 한강대로 405', hint: 'KTX · 지하철' },
  { name: '광화문광장', address: '서울 종로구 세종대로 172', hint: '광화문' },
  { name: '여의도역', address: '서울 영등포구 여의나루로 40', hint: '지하철 5·9호선' },
  { name: '잠실역 롯데월드', address: '서울 송파구 올림픽로 240', hint: '롯데월드' },
  { name: '인천국제공항 T1', address: '인천 중구 공항로 272', hint: '제1여객터미널' },
  { name: '김포공항 국내선', address: '서울 강서구 하늘길 38', hint: '국내선' },
  { name: '성수역 카페거리', address: '서울 성동구 아차산로 100', hint: '성수동' },
  { name: '이태원역', address: '서울 용산구 이태원로 177', hint: '지하철 6호선' },
  { name: '서면역 2번 출구', address: '부산 부산진구 중앙대로 672', hint: '부산 추천 · 1·2호선' },
  { name: '부산역 KTX', address: '부산 동구 중앙대로 206', hint: '고속철도' },
  { name: '해운대해수욕장', address: '부산 해운대구 해운대해변로 264', hint: '해운대' },
  { name: '센텀시티역', address: '부산 해운대구 센텀동로 99', hint: '신세계 센텀' },
  { name: '광안리해수욕장', address: '부산 수영구 광안해변로 219', hint: '광안대교' },
  { name: '남포동 자갈치시장', address: '부산 중구 자갈치해안로 52', hint: '자갈치' },
  { name: '사상역 서부터미널', address: '부산 사상구 사상로 201', hint: '서부시외버스터미널' },
  { name: '주례역', address: '부산 사상구 백양대로 500', hint: '지하철 2호선' },
  { name: '백양대로1050번길 26', address: '부산 사상구 백양대로1050번길 26', hint: '도로명 주소 · 사상구' },
  { name: '백양대로1050번길 20', address: '부산 사상구 백양대로1050번길 20', hint: '인근 도로명' },
  { name: '백양대로1050번길 32', address: '부산 사상구 백양대로1050번길 32', hint: '인근 도로명' },
  { name: '백양대로 942', address: '부산 사상구 백양대로 942', hint: '주례동 일대' },
  { name: '백양대로 1008', address: '부산 사상구 백양대로 1008', hint: '도로명 주소' },
  { name: '주례동 주례사거리', address: '부산 사상구 주례동 3-15', hint: '지번 주소' },
  { name: '주례동 119-8', address: '부산 사상구 주례동 119-8', hint: '지번 주소' },
  { name: '사상구청', address: '부산 사상구 학감대로 242', hint: '행정복지센터' },
  { name: '학장동 학장사거리', address: '부산 사상구 학장동 573-3', hint: '지번 주소' },
  { name: '하단역', address: '부산 사하구 낙동대로 550', hint: '지하철 1호선' },
  { name: '동래역', address: '부산 동래구 충렬대로 237', hint: '지하철 1·4호선' },
  { name: '연산역', address: '부산 연제구 중앙대로 1001', hint: '시청 · 연산' },
  { name: '김해국제공항', address: '부산 강서구 공항진입로 108', hint: '국내선' },
] as const

type PlaceItem = (typeof PLACE_CATALOG)[number] | { name: string; address: string; hint: string }

const BUSAN_RECOMMENDED: PlaceItem[] = [
  { name: '서면역 2번 출구', address: '부산 부산진구 중앙대로 672', hint: '부산 대표 장소' },
  { name: '부산역 KTX', address: '부산 동구 중앙대로 206', hint: '부산 대표 장소' },
  { name: '해운대해수욕장', address: '부산 해운대구 해운대해변로 264', hint: '부산 대표 장소' },
  { name: '사상역 서부터미널', address: '부산 사상구 사상로 201', hint: '부산 대표 장소' },
  { name: '주례역', address: '부산 사상구 백양대로 500', hint: '백양대로 인근' },
  { name: '센텀시티역', address: '부산 해운대구 센텀동로 99', hint: '부산 대표 장소' },
]

function compactAddress(value: string) {
  return value
    .toLowerCase()
    .replace(/서울특별시/g, '서울')
    .replace(/부산광역시/g, '부산')
    .replace(/인천광역시/g, '인천')
    .replace(/\s+/g, '')
    .replace(/번\s*길/g, '번길')
    .replace(/[()[\].,·'"“”]/g, '')
}

function uniquePlaces(places: PlaceItem[]) {
  const seen = new Set<string>()
  return places.filter((place) => {
    const key = compactAddress(`${place.name}|${place.address}`)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function queryTokens(raw: string) {
  const spaced = raw
    .replace(/([가-힣]+)(\d+)/g, '$1 $2')
    .replace(/(\d+)([가-힣]+)/g, '$1 $2')
    .trim()
  const parts = spaced.split(/[\s,/]+/).filter(Boolean)
  const compact = compactAddress(raw)
  const extras = [
    ...(compact.match(/[가-힣]+(?:대로|로|길)/g) ?? []),
    ...(compact.match(/\d+번길\d*/g) ?? []),
    ...(compact.match(/[가-힣]+동/g) ?? []),
  ]
  return [...new Set([compact, ...parts.map(compactAddress), ...extras].filter((token) => token.length >= 2))]
}

function scorePlace(place: PlaceItem, compact: string, tokens: string[]) {
  const hay = compactAddress(`${place.name} ${place.address} ${place.hint}`)
  let score = 0
  if (hay.includes(compact)) score += compact.length >= 6 ? 140 : 90
  if (compact.includes(hay) && hay.length >= 4) score += 40
  for (const token of tokens) {
    if (hay.includes(token)) score += token.length >= 4 ? 28 : 14
  }
  if (compact.length >= 3) {
    let cursor = 0
    for (const ch of hay) {
      if (ch === compact[cursor]) cursor += 1
      if (cursor === compact.length) {
        score += 10
        break
      }
    }
  }
  return score
}

function synthesizeFromQuery(raw: string): PlaceItem[] {
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  const compact = compactAddress(cleaned)
  if (compact.length < 2) return []
  const road = compact.match(/[가-힣0-9]+(?:대로|로|길).*/)?.[0] ?? compact
  const prettyRoad = cleaned
  return [
    { name: prettyRoad, address: `부산 사상구 ${road}`, hint: '입력한 도로명 주소' },
    { name: `${prettyRoad} 인근`, address: `부산 사상구 ${road} 일대`, hint: '주변 지역' },
    { name: '주례동 인근 지번', address: '부산 사상구 주례동 119-8', hint: '가까운 지번 주소' },
    { name: '학장동 인근 지번', address: '부산 사상구 학장동 573-3', hint: '가까운 지번 주소' },
  ]
}

function searchDestinationPlaces(raw: string) {
  const keyword = raw.trim()
  const compact = compactAddress(keyword)
  if (!compact) return { items: [] as PlaceItem[], recommended: false }
  const tokens = queryTokens(keyword)
  const ranked = PLACE_CATALOG
    .map((place) => ({ place, score: scorePlace(place, compact, tokens) }))
    .filter((row) => row.score >= 14)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((row) => row.place)
  const looksAddress = /대로|로|길|동|번지|번길|\d/.test(compact)
  if (ranked.length > 0) {
    const extras = looksAddress ? synthesizeFromQuery(keyword).slice(0, 2) : []
    return { items: uniquePlaces([...ranked, ...extras]).slice(0, 12), recommended: false }
  }
  return {
    items: uniquePlaces([...synthesizeFromQuery(keyword), ...BUSAN_RECOMMENDED]).slice(0, 10),
    recommended: true,
  }
}

function readRecentPlaces(): RecentPlace[] {
  try {
    const raw = window.localStorage.getItem(RECENT_DEST_KEY)
    if (!raw) return DEFAULT_RECENT_PLACES
    const parsed = JSON.parse(raw) as RecentPlace[]
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.name) : DEFAULT_RECENT_PLACES
  } catch {
    return DEFAULT_RECENT_PLACES
  }
}

function writeRecentPlaces(places: RecentPlace[]) {
  window.localStorage.setItem(RECENT_DEST_KEY, JSON.stringify(places.slice(0, 8)))
}

function FavoritePlaceModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (place: { name: string; address: string }) => void
}) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const canSave = name.trim().length > 0 && address.trim().length > 0
  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-[#1e293b]/45 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto w-full max-w-md rounded-t-[30px] bg-white p-5 shadow-2xl sm:rounded-[30px]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-black text-[#4C1FB8]">FAVORITE PLACE</p>
            <h2 className="mt-1 text-xl font-black text-[#0F172A]">즐겨찾기 추가</h2>
            <p className="mt-1 text-xs font-bold text-[#475569]">장소 이름과 주소를 입력해 주세요.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="닫기">
            <X className="h-5 w-5" />
          </button>
        </div>
        <label className="mt-5 block">
          <span className="text-xs font-black text-[#334155]">장소 이름</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 헬스장, 부모님댁" className="mt-2 w-full rounded-2xl border-2 border-[#CBD5E1] bg-[#F8FAFC] px-4 py-3 text-sm font-bold text-[#0F172A] outline-none focus:border-[#4C1FB8]" />
        </label>
        <label className="mt-3 block">
          <span className="text-xs font-black text-[#334155]">주소</span>
          <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="예: 서울시 강남구 테헤란로 123" className="mt-2 w-full rounded-2xl border-2 border-[#CBD5E1] bg-[#F8FAFC] px-4 py-3 text-sm font-bold text-[#0F172A] outline-none focus:border-[#4C1FB8]" />
        </label>
        <button type="button" disabled={!canSave} onClick={() => onSave({ name: name.trim(), address: address.trim() })} className="mt-5 w-full rounded-2xl bg-[#4C1FB8] py-3.5 font-black text-white shadow-[0_10px_22px_rgba(76,31,184,0.35)] disabled:cursor-not-allowed disabled:opacity-40">
          즐겨찾기 등록
        </button>
      </section>
    </div>
  )
}

function DestinationSearchModal({
  destination,
  favorites,
  recents,
  onClose,
  onSelect,
  onAddFavorite,
  onRemoveFavorite,
  onRemoveRecent,
  onOpenMap,
}: {
  destination: string
  favorites: FavoritePlace[]
  recents: RecentPlace[]
  onClose: () => void
  onSelect: (name: string, address?: string) => void
  onAddFavorite: () => void
  onRemoveFavorite: (id: string) => void
  onRemoveRecent: (id: string) => void
  onOpenMap: () => void
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(timer)
  }, [])
  const keyword = query.trim()
  const { items: results, recommended } = keyword ? searchDestinationPlaces(keyword) : { items: [], recommended: false }

  const pick = (name: string, address?: string) => {
    onSelect(name, address)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[88] flex justify-center bg-[#E2E8F0]">
      <section className="flex h-full w-full max-w-md flex-col bg-[#F4F0FB]">
        <header className="border-b border-[#E0D4FF] bg-white px-4 pb-3 pt-5">
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="검색 닫기">
              <X className="h-5 w-5" />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border-2 border-[#4C1FB8] bg-[#F8F5FF] px-3 py-3">
              <Search className="h-5 w-5 shrink-0 text-[#4C1FB8]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="목적지를 검색해 주세요"
                className="w-full bg-transparent text-sm font-extrabold text-[#0F172A] outline-none placeholder:text-[#64748B]"
                aria-label="목적지 검색"
              />
              {query ? (
                <button type="button" onClick={() => setQuery('')} className="text-[11px] font-black text-[#4C1FB8]" aria-label="검색어 지우기">
                  지우기
                </button>
              ) : null}
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-8">
          {keyword ? (
            <div>
              <p className="text-xs font-black text-[#4C1FB8]">{recommended ? '가까운 추천 장소' : `검색 결과 ${results.length}곳`}</p>
              {recommended ? (
                <p className="mt-1 text-[11px] font-bold text-[#64748B]">입력하신 주소와 비슷한 도로명·지번·부산 대표 장소를 보여드려요.</p>
              ) : null}
              <div className="mt-3 space-y-2">
                {results.map((place) => (
                  <button key={`${place.name}-${place.address}`} type="button" onClick={() => pick(place.name, place.address)} className="flex w-full items-start gap-3 rounded-[22px] border-2 border-[#E0D4FF] bg-white p-4 text-left shadow-[0_8px_18px_rgba(15,23,42,0.06)] active:scale-[0.99]">
                    <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#EDE5FF] text-[#4C1FB8]">
                      <MapPin className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <strong className="block text-sm font-black text-[#0F172A]">{place.name}</strong>
                      <span className="mt-1 block text-xs font-bold text-[#64748B]">{place.address}</span>
                      <span className="mt-1 block text-[11px] font-black text-[#4C1FB8]">{place.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <section>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black text-[#4C1FB8]">즐겨찾는 장소</p>
                  <button type="button" onClick={onAddFavorite} className="text-[11px] font-black text-[#4C1FB8]">
                    + 추가
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => pick('집')} className={`rounded-[22px] border-2 bg-white p-4 text-left shadow-[0_8px_16px_rgba(15,23,42,0.06)] ${destination === '집' ? 'border-[#4C1FB8]' : 'border-[#E0D4FF]'}`}>
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#EDE5FF] text-[#4C1FB8]">
                      <House className="h-5 w-5" />
                    </span>
                    <strong className="mt-3 block text-sm font-black">집</strong>
                    <span className="mt-1 block text-[11px] font-bold text-[#64748B]">등록된 집으로 이동</span>
                  </button>
                  <button type="button" onClick={() => pick('회사')} className={`rounded-[22px] border-2 bg-white p-4 text-left shadow-[0_8px_16px_rgba(15,23,42,0.06)] ${destination === '회사' ? 'border-[#4C1FB8]' : 'border-[#E0D4FF]'}`}>
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#EDE5FF] text-[#4C1FB8]">
                      <Building2 className="h-5 w-5" />
                    </span>
                    <strong className="mt-3 block text-sm font-black">회사</strong>
                    <span className="mt-1 block text-[11px] font-bold text-[#64748B]">등록된 회사로 이동</span>
                  </button>
                  {favorites.map((place) => (
                    <div key={place.id} className="relative rounded-[22px] border-2 border-[#E0D4FF] bg-white p-4 shadow-[0_8px_16px_rgba(15,23,42,0.06)]">
                      <button type="button" onClick={() => pick(place.name, place.address)} className="w-full text-left">
                        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#EDE5FF] text-[#4C1FB8]">
                          <Star className="h-5 w-5" />
                        </span>
                        <strong className="mt-3 block truncate text-sm font-black">{place.name}</strong>
                        <span className="mt-1 block truncate text-[11px] font-bold text-[#64748B]">{place.address}</span>
                      </button>
                      <button type="button" onClick={() => onRemoveFavorite(place.id)} className="absolute right-3 top-3 rounded-full bg-[#F1F5F9] p-1 text-[#64748B]" aria-label={`${place.name} 즐겨찾기 삭제`}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={onOpenMap} className="rounded-[22px] border-2 border-dashed border-[#4C1FB8] bg-[#F8F5FF] p-4 text-left">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-[#4C1FB8]">
                      <LocateFixed className="h-5 w-5" />
                    </span>
                    <strong className="mt-3 block text-sm font-black text-[#4C1FB8]">내 위치</strong>
                    <span className="mt-1 block text-[11px] font-bold text-[#64748B]">현재 위치 지도 보기</span>
                  </button>
                </div>
              </section>
              <section className="mt-6">
                <p className="text-xs font-black text-[#4C1FB8]">최근 목적지</p>
                <div className="mt-3 space-y-2">
                  {recents.length === 0 ? (
                    <p className="rounded-[22px] bg-white p-4 text-xs font-bold text-[#64748B]">아직 최근 목적지가 없어요.</p>
                  ) : (
                    recents.map((place) => (
                      <div key={place.id} className="flex items-center gap-2 rounded-[22px] border-2 border-[#E0D4FF] bg-white p-3 shadow-[0_8px_16px_rgba(15,23,42,0.06)]">
                        <button type="button" onClick={() => pick(place.name, place.address)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#F1F5F9] text-[#4C1FB8]">
                            <Clock className="h-5 w-5" />
                          </span>
                          <span className="min-w-0">
                            <strong className="block truncate text-sm font-black text-[#0F172A]">{place.name}</strong>
                            <span className="mt-0.5 block truncate text-xs font-bold text-[#64748B]">{place.address}</span>
                          </span>
                        </button>
                        <button type="button" onClick={() => onRemoveRecent(place.id)} className="rounded-full bg-[#F1F5F9] p-2 text-[#64748B]" aria-label={`${place.name} 최근 목적지 삭제`}>
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

function DestinationTaxiLoop({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, '')
  return (
    <span className={`pointer-events-none relative isolate overflow-hidden ${className ?? ''}`} aria-hidden>
      <style>{`
        @-webkit-keyframes ttTaxiLoopV18 {
          0% { left: 0; -webkit-transform: translateX(-100%); transform: translateX(-100%); }
          88% { left: 100%; -webkit-transform: translateX(0); transform: translateX(0); }
          88.01%, 100% { left: 0; -webkit-transform: translateX(-100%); transform: translateX(-100%); }
        }
        @keyframes ttTaxiLoopV18 {
          0% { left: 0; transform: translateX(-100%); }
          88% { left: 100%; transform: translateX(0); }
          88.01%, 100% { left: 0; transform: translateX(-100%); }
        }
        @keyframes ttTaxiDashV18 {
          to { stroke-dashoffset: -28; }
        }
      `}</style>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 160 56" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`tt-search-sky-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F0FDFF" />
            <stop offset="32%" stopColor="#CFFAFE" />
            <stop offset="62%" stopColor="#A5F3FC" />
            <stop offset="100%" stopColor="#99F6E4" />
          </linearGradient>
          <linearGradient id={`tt-search-hill-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6EE7B7" />
            <stop offset="100%" stopColor="#2DD4BF" />
          </linearGradient>
          <linearGradient id={`tt-search-road-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#64748B" />
            <stop offset="42%" stopColor="#475569" />
            <stop offset="100%" stopColor="#1E293B" />
          </linearGradient>
          <linearGradient id={`tt-search-curb-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFF7ED" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#FDBA74" stopOpacity="0.32" />
          </linearGradient>
          <radialGradient id={`tt-search-sun-${uid}`} cx="0.72" cy="0.18" r="0.28">
            <stop offset="0%" stopColor="#FEF08A" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#FEF08A" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`tt-search-shade-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#F8FAFC" stopOpacity="0.82" />
            <stop offset="18%" stopColor="#ECFEFF" stopOpacity="0" />
            <stop offset="82%" stopColor="#0F766E" stopOpacity="0" />
            <stop offset="100%" stopColor="#0F766E" stopOpacity="0.12" />
          </linearGradient>
        </defs>
        <rect width="160" height="56" fill={`url(#tt-search-sky-${uid})`} />
        <circle cx="118" cy="12" r="18" fill={`url(#tt-search-sun-${uid})`} />
        <ellipse cx="26" cy="12" rx="11" ry="4.2" fill="#FFFFFF" opacity="0.9" />
        <ellipse cx="34" cy="12.8" rx="8" ry="3.4" fill="#F8FAFC" opacity="0.9" />
        <ellipse cx="92" cy="9.5" rx="9" ry="3.4" fill="#FFFFFF" opacity="0.72" />
        <ellipse cx="28" cy="30" rx="34" ry="11" fill={`url(#tt-search-hill-${uid})`} opacity="0.5" />
        <ellipse cx="122" cy="27" rx="40" ry="12" fill="#67E8F9" opacity="0.42" />
        <ellipse cx="84" cy="32" rx="20" ry="6.5" fill="#FDE68A" opacity="0.36" />
        <path d="M0 31.5C36 27.5 86 27.5 160 32.5V56H0Z" fill={`url(#tt-search-road-${uid})`} />
        <path d="M0 31.5C36 27.5 86 27.5 160 32.5V36.2C86 31.4 36 31.4 0 35.2Z" fill={`url(#tt-search-curb-${uid})`} />
        <path d="M0 47H160" stroke="#FDE68A" strokeOpacity="0.95" strokeWidth="2.1" strokeDasharray="8 6" strokeLinecap="round" style={{ animation: 'ttTaxiDashV18 0.55s linear infinite' }} />
        <path d="M0 52H160" stroke="#0F172A" strokeOpacity="0.32" strokeWidth="3" />
        <rect width="160" height="56" fill={`url(#tt-search-shade-${uid})`} />
      </svg>
      <span className="absolute inset-y-0 left-0 z-[1] w-4 bg-gradient-to-r from-white to-transparent" />
      <span
        className="absolute bottom-0 left-0 z-10 h-full w-[76%] max-w-[4.75rem]"
        style={{
          aspectRatio: '76 / 44',
          animation: 'ttTaxiLoopV18 3.6s linear infinite',
          WebkitAnimation: 'ttTaxiLoopV18 3.6s linear infinite',
          willChange: 'transform',
        }}
      >
        <svg viewBox="0 0 76 44" preserveAspectRatio="xMidYMid meet" className="block h-full w-full" style={{ filter: 'drop-shadow(0 3px 4px rgba(15,23,42,0.32))' }} fill="none">
          <ellipse cx="38" cy="41.4" rx="22" ry="1.7" fill="#0F172A" opacity="0.26" />
          <polygon points="62,22 76,19.2 76,28.4 62,26.2" fill="#FEF9C3" opacity="0.42" />
          <polygon points="10,27 16,20 28,15 48,15 62,21 68,21 70,24 70,32 62,32 56,27 20,27 14,32 8,32 8,29" fill="#CA8A04" />
          <polygon points="12,26.2 17.5,20.2 28.5,15.8 47.5,15.8 61,21.2 66.6,21.2 68.4,23.8 68.4,30.6 61.5,30.6 55.5,26.2" fill="#FACC15" stroke="#A16207" strokeWidth="1.05" strokeLinejoin="miter" strokeMiterlimit="8" />
          <polygon points="29,16.2 33.2,10.2 46.8,10.2 54.6,16.2 47.2,16.2 33.4,16.2" fill="#CA8A04" />
          <polygon points="30.2,16 33.8,11 46.2,11 53.4,16" fill="#0EA5E9" stroke="#0F172A" strokeWidth="0.7" strokeLinejoin="miter" />
          <polygon points="34.2,11.4 34.2,15.6 39.4,15.6 39.4,11.4" fill="#38BDF8" opacity="0.9" />
          <polygon points="40.2,11.4 40.2,15.6 51.6,15.6 46.4,11.4" fill="#7DD3FC" opacity="0.88" />
          <path d="M39.8 11.2V16" stroke="#F8FAFC" strokeWidth="0.85" />
          <polygon points="35.6,4.6 41.8,4.6 44.2,7.2 44.2,9.8 33.2,9.8 33.2,7.2" fill="#FACC15" stroke="#A16207" strokeWidth="0.85" strokeLinejoin="miter" />
          <polygon points="34.6,5.4 42.6,5.4 43.4,6.4 34.2,6.4" fill="#FEF08A" />
          <polygon points="34.4,7.4 43.4,7.4 43.6,8.8 34.2,8.8" fill="#A16207" />
          <polygon points="63.2,22.2 68.8,22.2 70.2,24.4 70.2,26.8 63.2,25.4" fill="#F8FAFC" stroke="#0F172A" strokeWidth="0.55" strokeLinejoin="miter" />
          <polygon points="11.6,22.4 16.4,22.4 16.4,24.6 11.2,24.6" fill="#F8FAFC" />
          <path d="M20 26.4H55.6" stroke="#A16207" strokeWidth="1.15" />
          <path d="M39.6 16.2V26.4" stroke="#A16207" strokeWidth="0.9" />
          <polygon points="55.8,16.6 59.6,19.8 57.4,21.6 54.2,18.2" fill="#F8FAFC" opacity="0.85" />
          <circle cx="22" cy="31.6" r="6.15" fill="#0F172A" />
          <circle cx="22" cy="31.6" r="4.55" fill="#27272A" />
          <polygon points="22,28.2 24.9,30.3 23.8,33.7 20.2,33.7 19.1,30.3" fill="#E4E4E7" />
          <polygon points="22,29.6 23.6,31.1 22.9,33 21.1,33 20.4,31.1" fill="#71717A" />
          <circle cx="54" cy="31.6" r="6.15" fill="#0F172A" />
          <circle cx="54" cy="31.6" r="4.55" fill="#27272A" />
          <polygon points="54,28.2 56.9,30.3 55.8,33.7 52.2,33.7 51.1,30.3" fill="#E4E4E7" />
          <polygon points="54,29.6 55.6,31.1 54.9,33 53.1,33 52.4,31.1" fill="#71717A" />
        </svg>
      </span>
    </span>
  )
}

function SearchCard({ destination, onSelect }: { destination: string; onSelect: (value: string) => void }) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [favorites, setFavorites] = useState<FavoritePlace[]>([])
  const [recents, setRecents] = useState<RecentPlace[]>([])
  useEffect(() => {
    setFavorites(readFavoritePlaces())
    setRecents(readRecentPlaces())
  }, [])
  const rememberRecent = (name: string, address?: string) => {
    const next = [{ id: `${Date.now()}`, name, address: address || name }, ...recents.filter((place) => place.name !== name && place.address !== address)]
    setRecents(next)
    writeRecentPlaces(next)
  }
  const select = (name: string, address?: string) => {
    rememberRecent(name, address)
    onSelect(address || name)
  }
  const addFavorite = (place: { name: string; address: string }) => {
    const next = [...favorites, { id: `${Date.now()}`, ...place }]
    setFavorites(next)
    writeFavoritePlaces(next)
    setFormOpen(false)
  }
  const removeFavorite = (id: string) => {
    const next = favorites.filter((place) => place.id !== id)
    setFavorites(next)
    writeFavoritePlaces(next)
  }
  const removeRecent = (id: string) => {
    const next = recents.filter((place) => place.id !== id)
    setRecents(next)
    writeRecentPlaces(next)
  }
  const chipClass = (active: boolean) =>
    `inline-flex shrink-0 items-center rounded-full border-2 px-4 py-2 text-xs font-black transition active:scale-95 ${active ? 'border-[#4C1FB8] bg-[#4C1FB8] text-white shadow-[0_8px_16px_rgba(76,31,184,0.35)]' : 'border-[#94A3B8] bg-white text-[#1E293B] hover:bg-[#F1F5F9]'}`

  return (
    <section className="relative overflow-visible rounded-[26px] border-2 border-[#CBD5E1] bg-white p-4 shadow-[0_14px_32px_rgba(15,23,42,0.14)]">
      <div className="mb-3 flex items-end justify-between gap-3">
        <p className="text-[22px] font-bold leading-tight text-[#0f172a]">어디로 갈까요?</p>
        <span className="shrink-0 pb-0.5 text-xs font-semibold text-[#334155]">목적지 검색</span>
      </div>
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="group relative z-10 flex w-full items-stretch overflow-hidden rounded-2xl border-2 border-[#94A3B8] bg-[#F8FAFC] text-left transition hover:border-[#4C1FB8] hover:bg-white"
        aria-label="목적지 검색 열기"
      >
        <span className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-l-[14px] px-4 py-3.5">
          <Search className="h-5 w-5 shrink-0 text-[#4C1FB8]" />
          <span className={`min-w-0 flex-1 truncate text-sm font-extrabold ${destination ? 'text-[#0F172A]' : 'text-[#64748B]'}`}>{destination || '목적지를 입력해 주세요'}</span>
        </span>
        <DestinationTaxiLoop className="w-[10.25rem] shrink-0 self-stretch rounded-r-[14px]" />
      </button>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        <button type="button" onClick={() => select('집')} className={chipClass(destination === '집')}>
          집
        </button>
        <button type="button" onClick={() => select('회사')} className={chipClass(destination === '회사')}>
          회사
        </button>
        {favorites.map((place) => {
          const active = destination === place.address || destination === place.name
          return (
            <span key={place.id} className="inline-flex shrink-0 items-center">
              <button type="button" onClick={() => select(place.name, place.address)} className={`${chipClass(active)} pr-2`}>
                {place.name}
              </button>
              <button type="button" onClick={() => removeFavorite(place.id)} className="-ml-2 mr-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#F1F5F9] text-[#64748B]" aria-label={`${place.name} 즐겨찾기 삭제`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          )
        })}
        <button type="button" onClick={() => setFormOpen(true)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-[#4C1FB8] bg-white text-[#4C1FB8] transition hover:bg-[#EDE5FF] active:scale-95" aria-label="즐겨찾기 장소 추가">
          <Plus className="h-4 w-4" strokeWidth={3} />
        </button>
        <button type="button" onClick={() => setMapOpen(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border-2 border-[#4C1FB8] bg-[#EDE5FF] px-4 py-2 text-xs font-black text-[#3B16A8] shadow-[0_6px_14px_rgba(76,31,184,0.18)] transition hover:bg-[#E0D4FF] active:scale-95">
          <LocateFixed className="h-3.5 w-3.5" />
          내 위치
        </button>
      </div>
      {searchOpen ? (
        <DestinationSearchModal
          destination={destination}
          favorites={favorites}
          recents={recents}
          onClose={() => setSearchOpen(false)}
          onSelect={select}
          onAddFavorite={() => setFormOpen(true)}
          onRemoveFavorite={removeFavorite}
          onRemoveRecent={removeRecent}
          onOpenMap={() => setMapOpen(true)}
        />
      ) : null}
      {mapOpen ? <LocationMapModal onClose={() => setMapOpen(false)} /> : null}
      {formOpen ? <FavoritePlaceModal onClose={() => setFormOpen(false)} onSave={addFavorite} /> : null}
    </section>
  )
}

function PiPayPanel({
  amount,
  balance,
  onPay,
}: {
  amount: number
  balance: number
  onPay: () => void
}) {
  const enough = balance >= amount
  return (
    <div className="space-y-3">
      <div className="rounded-[22px] border-2 border-[#4C1FB8] bg-[#EDE5FF] p-4">
        <p className="text-xs font-black text-[#4C1FB8]">결제 수단</p>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm font-black text-[#0F172A]">Pi 코인</span>
          <span className="rounded-full bg-[#4C1FB8] px-2.5 py-1 text-[10px] font-black text-white">선택됨</span>
        </div>
        <div className="mt-3 flex items-end justify-between">
          <p className="text-xs font-bold text-[#475569]">보유 잔액 {balance.toFixed(2)} Pi</p>
          <p className="text-lg font-black text-[#4C1FB8]">{amount.toFixed(2)} Pi</p>
        </div>
        {!enough ? <p className="mt-2 text-xs font-black text-[#BE123C]">잔액이 부족합니다. 충전 후 결제해 주세요.</p> : null}
      </div>
      {enough ? (
        <PiCheckoutButton
          amount={amount}
          memo={`TaxiTago ${amount} Pi 결제`}
          metadata={{ kind: 'service-pay' }}
          className="w-full rounded-2xl bg-[#4C1FB8] py-4 font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)]"
          onPaid={() => onPay()}
        >
          {`Pi로 ${amount.toFixed(2)} 결제하기`}
        </PiCheckoutButton>
      ) : (
        <button type="button" onClick={onPay} className="w-full rounded-2xl bg-[#4C1FB8] py-4 font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)]">
          잔액 충전하기
        </button>
      )}
    </div>
  )
}

function InsufficientBalanceModal({ onConfirm }: { onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[96] flex items-end bg-[#1e293b]/50 sm:items-center sm:p-4">
      <section className="mx-auto w-full max-w-md rounded-t-[30px] bg-white p-5 text-center shadow-2xl sm:rounded-[30px]" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#FEF2F2] text-[#BE123C]">
          <WalletCards className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-2xl font-bold text-[#0F172A]">잔액 부족</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-[#334155]">보유 잔액이 부족합니다. Pi 충전 후 다시 결제해 주세요.</p>
        <button type="button" onClick={onConfirm} className="mt-6 w-full rounded-2xl bg-[#4A82B8] py-3.5 font-bold text-white">
          확인
        </button>
      </section>
    </div>
  )
}

function PaymentDoneModal({
  amount,
  place,
  remaining,
  estimated,
  onClose,
}: {
  amount: number
  place: string
  remaining: number
  estimated?: number
  onClose: () => void
}) {
  const adjusted = estimated != null && Math.round(estimated * 100) !== Math.round(amount * 100)
  return (
    <div className="fixed inset-0 z-[95] flex items-end bg-[#1e293b]/45 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto w-full max-w-md rounded-t-[30px] bg-white p-5 text-center shadow-2xl sm:rounded-[30px]" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#4A82B8] text-white">
          <Check className="h-7 w-7" strokeWidth={3} />
        </div>
        <h2 className="mt-4 text-2xl font-bold text-[#0F172A]">Pi 결제 완료 및 영수증 확인</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#334155]">정상적으로 후결제가 완료되었습니다</p>
        <div className="mt-5 rounded-[22px] border-2 border-[#CBD5E1] bg-[#F8FAFC] p-4 text-left">
          <p className="text-xs font-bold text-[#4A82B8]">영수증</p>
          <p className="mt-2 text-sm font-semibold text-[#475569]">{place}</p>
          {adjusted ? (
            <>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs font-medium text-[#64748B]">호출 시 예상 요금</span>
                <span className="text-sm font-semibold text-[#64748B] line-through">{estimated.toFixed(2)} Pi</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs font-bold text-[#0F172A]">실제 이용 요금</span>
                <span className="text-xl font-bold text-[#0F172A]">{amount.toFixed(2)} Pi</span>
              </div>
              <div className="mt-3 rounded-2xl bg-white px-3 py-3">
                <p className="text-[11px] font-semibold leading-5 text-[#334155]">실시간 주행 거리/시간에 따라 최종 요금이 산정되었습니다</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A82B8]">최종 청구 금액</span>
                  <span className="text-lg font-bold text-[#4A82B8]">{amount.toFixed(2)} Pi</span>
                </div>
              </div>
            </>
          ) : (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs font-medium text-[#64748B]">결제 금액</span>
              <span className="text-xl font-bold text-[#0F172A]">{amount.toFixed(2)} Pi</span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[#64748B]">결제 수단</span>
            <span className="text-sm font-bold text-[#0F172A]">Pi Network</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[#64748B]">남은 잔액</span>
            <span className="text-sm font-bold text-[#334155]">{remaining.toFixed(2)} Pi</span>
          </div>
        </div>
        <button type="button" onClick={onClose} className="mt-5 w-full rounded-2xl bg-[#4A82B8] py-3.5 font-bold text-white">
          확인
        </button>
      </section>
    </div>
  )
}

const PRAISE_TAGS = ['친절해요', '응대가 부드러워요', '설명이 명확해요', '배려가 좋아요', '운전이 안전해요', '차가 깨끗해요']

function DriverReviewModal({
  driver,
  onClose,
  onSubmit,
}: {
  driver: { name: string; vehicle: string; plate: string; kind?: 'driver' | 'service' }
  onClose: () => void
  onSubmit: (rating: number) => void
}) {
  const [rating, setRating] = useState(5)
  const [tags, setTags] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [done, setDone] = useState(false)
  const ratingLabel = ['', '아쉬워요', '보통이에요', '좋아요', '만족해요', '최고예요'][rating]
  const toggleTag = (tag: string) => {
    setTags((items) => (items.includes(tag) ? items.filter((item) => item !== tag) : [...items, tag]))
  }
  const submit = () => {
    setDone(true)
    window.setTimeout(() => onSubmit(rating), 1400)
  }
  return (
    <div className="fixed inset-0 z-[99] flex items-end bg-[#1e1033]/55 p-0 sm:items-center sm:p-4">
      <section className="mx-auto max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-white p-5 shadow-2xl sm:rounded-[32px]">
        {done ? (
          <div className="py-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#4C1FB8] text-white">
              <Check className="h-8 w-8" strokeWidth={3} />
            </div>
            <h2 className="mt-4 text-2xl font-black text-[#0F172A]">감사합니다</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-[#475569]">소중한 평가가 반영되었습니다. 리뷰 감사 포인트 0.1 Pi가 적립됩니다.</p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-black text-[#4C1FB8]">{driver.kind === 'service' ? '이용 완료 · 서비스 평가' : '이용 완료 · 기사 평가'}</p>
                <h2 className="mt-1 text-xl font-black leading-7 text-[#0F172A]">{driver.kind === 'service' ? '이용은 어떠셨나요?' : '기사님과의 이동은 어떠셨나요?'}</h2>
                <p className="mt-1 text-sm font-bold text-[#64748B]">{driver.kind === 'service' ? '별점과 후기를 남겨주세요' : '친절도와 평점을 남겨주세요'}</p>
              </div>
              <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="닫기">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 flex items-center gap-3 rounded-[22px] border-2 border-[#E0D4FF] bg-[#F8F5FF] p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#4C1FB8] font-black text-white">{driver.name.slice(0, 1)}</div>
              <div>
                <p className="font-black text-[#0F172A]">{driver.kind === 'service' ? driver.name : `${driver.name} 기사님`}</p>
                <p className="mt-1 text-xs font-bold text-[#475569]">{driver.vehicle}{driver.plate ? ` · ${driver.plate}` : ''}</p>
              </div>
            </div>
            <div className="mt-5 text-center">
              <p className="text-xs font-black text-[#334155]">평점 · 1점부터 5점</p>
              <div className="mt-2 flex justify-center gap-1.5">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRating(value)}
                    aria-label={`${value}점`}
                    className={`rounded-2xl p-1.5 transition ${value <= rating ? 'text-[#4C1FB8]' : 'text-[#D8CCF5]'}`}
                  >
                    <Star className="h-8 w-8" fill="currentColor" strokeWidth={0} />
                  </button>
                ))}
              </div>
              <p className="mt-2 text-sm font-black text-[#4C1FB8]">{rating}점 · {ratingLabel}</p>
            </div>
            <p className="mt-5 text-xs font-black text-[#334155]">친절도 태그 · 여러 개 선택 가능</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {PRAISE_TAGS.map((tag) => {
                const selected = tags.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full px-3 py-2 text-xs font-black ${selected ? 'bg-[#4C1FB8] text-white shadow-[0_8px_16px_rgba(76,31,184,0.28)]' : 'border border-[#D8CCF5] bg-[#F8F5FF] text-[#4C1FB8]'}`}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
            <label className="mt-4 block">
              <span className="text-xs font-black text-[#334155]">한줄 후기</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                placeholder="기사님께 전하고 싶은 말을 남겨 주세요"
                className="mt-2 w-full resize-none rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] px-4 py-3 text-sm font-bold text-[#0F172A] outline-none focus:border-[#4C1FB8]"
              />
            </label>
            <button type="button" onClick={submit} className="mt-4 w-full rounded-2xl bg-[#4C1FB8] py-4 text-base font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.35)]">
              평가 제출
            </button>
          </>
        )}
      </section>
    </div>
  )
}

function DestinationSheet({
  destination,
  onClose,
  onNotice,
  balance,
  onPay,
  onSettle,
  onNeedCharge,
  onAskReview,
}: {
  destination: string
  onClose: () => void
  onNotice: (message: string) => void
  balance: number
  onPay: (amount: number, place: string, label: string, estimated?: number) => boolean | Promise<boolean>
  onSettle: (amount: number, place: string, label: string, estimated: number | undefined, proof: { paymentId: string; txid: string }) => void
  onNeedCharge: () => void
  onAskReview: (driver: { name: string; vehicle: string; plate: string }) => void
}) {
  const [selectedService, setSelectedService] = useState('')
  const [matchState, setMatchState] = useState<'select' | 'matching' | 'matched'>('select')
  const [callOpen, setCallOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const finishedRef = useRef(false)
  const options = [['택시예약', '2.5'], ['일반택시', '2.1'], ['프리미엄', '3.5'], ['대리운전', '3.0'], ['기타', '1.8']]
  const selectedPrice = options.find(([name]) => name === selectedService)?.[1] ?? '0'
  const fare = Number(selectedPrice)
  const place = `서울시청 → ${destination}`
  const billed = isRidePayLabel(selectedService) ? settleRideFare(fare, `dest:${selectedService}:${place}`) : { estimate: fare, actual: fare }
  const callSelected = () => {
    if (!selectedService) return
    setMatchState('matching')
    window.setTimeout(() => {
      setMatchState('matched')
      onNotice('기사 매칭이 완료되었습니다.')
    }, 2000)
  }
  const cancelMatching = () => {
    setMatchState('select')
    onNotice('기사 호출을 취소했어요.')
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[#241d35]/35">
      <div className="w-full max-w-md rounded-t-[30px] bg-white px-5 pb-8 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-[#8b8495]">추천 경로</p>
            <h2 className="mt-1 text-2xl font-black">{place}</h2>
          </div>
          <button onClick={onClose} aria-label="닫기" className="rounded-full bg-[#f4f1f8] p-2">
            <X className="h-5 w-5" />
          </button>
        </div>
        {matchState === 'select' && (
          <>
            <div className="mt-5 rounded-3xl bg-[#f7f3ff] p-4">
              <div className="flex items-center justify-between">
                <span className="font-black">예상 시간 18분</span>
                <span className="text-sm font-bold text-[#77717f]">약 5.2 km</span>
              </div>
              <p className="mt-1 text-xs font-bold text-[#8b8495]">이동 서비스를 선택해 주세요.</p>
            </div>
            <div className="mt-4 grid grid-cols-5 gap-2">
              {options.map(([name, price]) => (
                <button
                  key={name}
                  onClick={() => setSelectedService(name)}
                  className={`min-h-[92px] rounded-2xl border p-2 text-center transition active:scale-95 ${selectedService === name ? 'border-[#7046dc] bg-[#7046dc] text-white shadow-lg shadow-[#7046dc]/20' : 'border-[#e2ddec] bg-white text-[#40365a] hover:border-[#bda9f5]'}`}
                >
                  <span className="block text-[11px] font-black leading-tight">{name}</span>
                  <strong className={`mt-3 block text-xs ${selectedService === name ? 'text-white' : 'text-[#7046dc]'}`}>{price} Pi</strong>
                </button>
              ))}
            </div>
            <button disabled={!selectedService} onClick={callSelected} className="mt-4 w-full rounded-2xl bg-[#4C1FB8] py-4 font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)] transition disabled:cursor-not-allowed disabled:opacity-40">
              {selectedService ? `${selectedService} 선택 서비스 호출하기` : '서비스를 선택해 주세요'}
            </button>
          </>
        )}
        {matchState === 'matching' && (
          <div className="mt-5 rounded-[26px] bg-[#f7f3ff] p-6 text-center">
            <div className="mx-auto flex h-24 w-24 animate-pulse items-center justify-center rounded-full border-2 border-[#7046dc]">
              <div className="h-12 w-12 rounded-full bg-[#7046dc]/15" />
            </div>
            <h3 className="mt-5 text-xl font-black">기사 매칭 중...</h3>
            <p className="mt-2 text-sm font-bold text-[#8b8495]">주변 기사님을 찾고 있어요.</p>
            <button onClick={cancelMatching} className="mt-5 w-full rounded-2xl border border-[#d8d1e5] bg-white py-3.5 font-black text-[#5f566d]">
              호출 취소
            </button>
          </div>
        )}
        {matchState === 'matched' && (
          <div className="mt-5 space-y-3">
            <div className="rounded-[26px] bg-[#effbf3] p-5">
              <p className="text-sm font-black text-[#2d9a5e]">매칭 완료!</p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#eadfff] font-black text-[#7046dc]">김</div>
                <div>
                  <p className="font-black">김파이 기사님</p>
                  <p className="text-xs font-bold text-[#64748B]">서울34바 1234 · 카카오 T {selectedService === '프리미엄' ? '모범' : '일반'}</p>
                </div>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="text-xs font-bold text-[#64748B]">예상 도착</p>
                  <p className="text-lg font-black text-[#7046dc]">3분 후 도착 예정</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-[#64748B]">결제 금액</p>
                  <p className="text-lg font-black">{selectedPrice} Pi</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setCallOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#4C1FB8] py-3 text-sm font-black text-white">
                <Phone className="h-4 w-4" />
                전화하기
              </button>
              <button type="button" onClick={() => setChatOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-[#4C1FB8] bg-white py-3 text-sm font-black text-[#4C1FB8]">
                <MessageCircle className="h-4 w-4" />
                채팅하기
              </button>
            </div>
            <PiCheckoutButton
              amount={billed.actual}
              memo={`${selectedService} ${billed.actual} Pi`}
              metadata={{ kind: 'service-pay', place, label: selectedService }}
              className="w-full rounded-2xl bg-[#4C1FB8] py-4 text-lg font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)]"
              onPaid={(result) => {
                if (!result.paymentId || !result.txid) return
                onSettle(billed.actual, place, selectedService, isRidePayLabel(selectedService) ? billed.estimate : undefined, result)
                onAskReview({
                  name: '김파이',
                  vehicle: selectedService === '프리미엄' ? '카카오 T 모범' : '카카오 T 일반',
                  plate: '서울34바 1234',
                })
                onClose()
              }}
              onFailed={(error) => onNotice(describePiUserMessage(error))}
            >
              이용 완료
            </PiCheckoutButton>
            <p className="text-center text-[11px] font-bold text-[#8b8495]">목적지 도착 후 눌러 주세요 · 하차 완료</p>
            <button onClick={cancelMatching} className="w-full rounded-2xl border border-[#d8d1e5] bg-white py-3.5 font-black text-[#5f566d]">
              호출 취소
            </button>
          </div>
        )}
      </div>
      {callOpen ? <SafeCallModal driverName="김파이" onHangup={() => setCallOpen(false)} /> : null}
      {chatOpen ? <DriverChatModal driverName="김파이" onClose={() => setChatOpen(false)} /> : null}
    </div>
  )
}

function SafeCallModal({ driverName, onHangup }: { driverName: string; onHangup: () => void }) {
  const [status, setStatus] = useState<'connecting' | 'talking'>('connecting')
  useEffect(() => {
    const timer = window.setTimeout(() => setStatus('talking'), 1600)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <div className="fixed inset-0 z-[97] flex items-center justify-center bg-[#1e1033]/70 p-6">
      <section className="w-full max-w-sm rounded-[32px] bg-white p-6 text-center shadow-2xl">
        <p className="text-xs font-black text-[#4C1FB8]">안심 통화</p>
        <div className="relative mx-auto mt-5 flex h-28 w-28 items-center justify-center">
          <span className={`absolute inset-0 rounded-full border-2 border-[#C4B5FD] ${status === 'connecting' ? 'animate-ping' : 'animate-pulse'}`} />
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#4C1FB8] text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)]">
            <Phone className="h-8 w-8" />
          </span>
        </div>
        <h3 className="mt-5 text-xl font-black text-[#0F172A]">{driverName} 기사님</h3>
        <p className="mt-1 font-mono text-sm font-black text-[#4C1FB8]">050-****-1842</p>
        <p className="mt-2 text-sm font-bold text-[#64748B]">{status === 'connecting' ? '안심번호로 연결 중입니다...' : '통화 중 · 개인정보는 보호됩니다'}</p>
        <button type="button" onClick={onHangup} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#BE123C] py-3.5 font-black text-white">
          <PhoneOff className="h-5 w-5" />
          끊기
        </button>
      </section>
    </div>
  )
}

function DriverChatModal({ driverName, onClose }: { driverName: string; onClose: () => void }) {
  const quickReplies = ['문 앞에 도착했습니다', '안전하게 이동 중입니다', '빨리 와주세요', '짐이 있어요']
  const [messages, setMessages] = useState<{ from: 'me' | 'driver'; text: string }[]>([
    { from: 'driver', text: '안녕하세요. 배차된 기사입니다. 곧 도착할게요.' },
  ])
  const [draft, setDraft] = useState('')
  const send = (text: string) => {
    const value = text.trim()
    if (!value) return
    setDraft('')
    setMessages((items) => [...items, { from: 'me', text: value }])
    const reply =
      value.includes('문 앞') ? '네, 곧 내리겠습니다.' :
      value.includes('안전') ? '네, 안전 운전하겠습니다.' :
      value.includes('빨리') ? '최대한 빠르게 갈게요.' :
      value.includes('짐') ? '트렁크 열어둘게요.' :
      '네, 확인했습니다.'
    window.setTimeout(() => {
      setMessages((items) => [...items, { from: 'driver', text: reply }])
    }, 800)
  }
  return (
    <div className="fixed inset-0 z-[97] flex items-end bg-[#1e1033]/55 sm:items-center sm:p-4">
      <section className="mx-auto flex h-[78vh] w-full max-w-md flex-col rounded-t-[32px] bg-white shadow-2xl sm:rounded-[32px]">
        <header className="flex items-center justify-between border-b border-[#EDE5FF] px-4 py-3">
          <div>
            <p className="text-xs font-black text-[#4C1FB8]">안심 채팅</p>
            <h3 className="text-base font-black text-[#0F172A]">{driverName} 기사님</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2" aria-label="채팅 닫기">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 space-y-2 overflow-y-auto bg-[#F8F5FF] px-4 py-4">
          {messages.map((message, index) => (
            <div key={`${message.text}-${index}`} className={`flex ${message.from === 'me' ? 'justify-end' : 'justify-start'}`}>
              <p className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm font-bold ${message.from === 'me' ? 'bg-[#4C1FB8] text-white' : 'bg-white text-[#0F172A] shadow-sm'}`}>
                {message.text}
              </p>
            </div>
          ))}
        </div>
        <div className="border-t border-[#EDE5FF] bg-white px-3 pb-4 pt-3">
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {quickReplies.map((reply) => (
              <button key={reply} type="button" onClick={() => send(reply)} className="shrink-0 rounded-full border border-[#D8CCF5] bg-[#F8F5FF] px-3 py-1.5 text-[11px] font-black text-[#4C1FB8]">
                {reply}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              send(draft)
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="메시지를 입력해 주세요"
              className="min-w-0 flex-1 rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] px-4 py-3 text-sm font-bold outline-none focus:border-[#4C1FB8]"
            />
            <button type="submit" className="rounded-2xl bg-[#4C1FB8] px-4 font-black text-white">
              전송
            </button>
          </form>
        </div>
      </section>
    </div>
  )
}


function TaxiMatchingSheet({
  destination,
  onClose,
  onNotice,
  balance,
  onPay,
  onSettle,
  onNeedCharge,
  onAskReview,
}: {
  destination: string
  onClose: () => void
  onNotice: (message: string) => void
  balance: number
  onPay: (amount: number, place: string, label: string, estimated?: number) => boolean | Promise<boolean>
  onSettle: (amount: number, place: string, label: string, estimated: number | undefined, proof: { paymentId: string; txid: string }) => void
  onNeedCharge: () => void
  onAskReview: (driver: { name: string; vehicle: string; plate: string }) => void
}) {
  const [phase, setPhase] = useState<TaxiMatchPhase>('searching')
  const [callOpen, setCallOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const finishedRef = useRef(false)
  const dest = destination.trim() || '강남역'
  const route = `서울시청 → ${dest}`
  const fare = 2.34
  const billed = { estimate: 2.1, actual: 2.34, adjusted: true }
  const [piPaying, setPiPaying] = useState(false)
  const driver = {
    name: '김민수',
    vehicle: dest === '회사' ? '현대 소나타' : '현대 아슬란',
    plate: '서울 31바 1842',
    rating: '4.97',
    eta: '3분',
  }
  const statusLabel = phase === 'arriving' ? '기사 이동 중' : phase === 'boarding' ? '탑승 중' : '이동 중'
  const statusCaption =
    phase === 'arriving'
      ? `기사님이 ${driver.eta} 뒤 도착 예정이에요.`
      : phase === 'boarding'
        ? '탑승을 확인하고 목적지로 출발할 준비를 하고 있어요.'
        : `${dest}까지 안전하게 이동 중이에요.`

  useEffect(() => {
    const timer = window.setTimeout(() => setPhase('arriving'), 2500)
    return () => window.clearTimeout(timer)
  }, [])

  const cancelRide = () => {
    onNotice(phase === 'searching' ? '택시 호출을 취소했어요.' : '배차를 취소했어요.')
    onClose()
  }

  const handleTaxiPostpay = () => {
    if (piPaying) return
    setPiPaying(true)
    try {
      void startPiCheckout({
        amount: 2.34,
        memo: '택시비 결제',
        metadata: { kind: 'taxi-postpay', route },
      })
        .then((proof) => {
          onSettle(2.34, route, '택시 호출', billed.estimate, proof)
          onAskReview({ name: driver.name, vehicle: driver.vehicle, plate: driver.plate })
          onClose()
        })
        .catch((error) => {
          console.error('[Pi] taxi postpay failed', error)
          onNotice(describePiUserMessage(error))
        })
        .finally(() => setPiPaying(false))
    } catch (error) {
      setPiPaying(false)
      console.error('[Pi] taxi postpay threw', error)
      onNotice(describePiUserMessage(error))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[#241d35]/50 p-0 sm:items-center sm:p-4">
      <section className="mx-auto max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-white px-5 pb-7 pt-3 shadow-[0_-18px_40px_rgba(36,27,56,0.22)] sm:rounded-[32px]">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#ddd7e7]" />
        {phase === 'searching' ? (
          <div className="pb-4 pt-2 text-center">
            <p className="text-xs font-black text-[#4C1FB8]">LIVE MATCHING</p>
            <h2 className="mt-2 text-2xl font-black text-[#0F172A]">기사님을 찾는 중입니다...</h2>
            <p className="mt-2 text-sm font-bold text-[#64748B]">{route}</p>
            <div className="relative mx-auto mt-8 flex h-36 w-36 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full border-2 border-[#C4B5FD]" />
              <span className="absolute inset-4 animate-pulse rounded-full border-2 border-[#4C1FB8]/40" />
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#4C1FB8] text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)]">
                <Car className="h-7 w-7" />
              </span>
            </div>
            <p className="mt-6 text-xs font-bold text-[#8b8495]">주변 기사님에게 호출을 보내고 있어요.</p>
            <button type="button" onClick={cancelRide} className="mt-6 w-full rounded-2xl border-2 border-[#CBD5E1] bg-white py-3.5 font-black text-[#475569]">
              호출 취소
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-black text-[#4C1FB8]">배차 완료</p>
                <h2 className="mt-1 text-2xl font-black text-[#0F172A]">{statusLabel}</h2>
                <p className="mt-1 text-xs font-bold text-[#64748B]">{statusCaption}</p>
              </div>
              <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="닫기">
                <X className="h-5 w-5" />
              </button>
            </div>
            <TaxiLiveMap kind="taxi" phase={toTaxiLivePhase(phase)} routeLabel={route} statusLabel={statusLabel} />
            <div className="mt-4 rounded-[24px] border-2 border-[#E0D4FF] bg-[#F8F5FF] p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#4C1FB8] font-black text-white">{driver.name.slice(0, 1)}</div>
                <div className="min-w-0 flex-1">
                  <p className="font-black text-[#0F172A]">
                    {driver.name} 기사님 <span className="ml-1 text-xs text-[#CA8A04]">★ {driver.rating}</span>
                  </p>
                  <p className="mt-1 text-xs font-bold text-[#475569]">
                    {driver.vehicle} · {driver.plate}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">예상 도착</p>
                  <p className="mt-1 text-sm font-black text-[#4C1FB8]">{phase === 'arriving' ? `${driver.eta} 후` : phase === 'boarding' ? '탑승 확인' : '이동 중'}</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">{phase === 'moving' ? '실제 이용 요금' : '예상 요금'}</p>
                  <p className="mt-1 text-sm font-black text-[#0F172A]">{(phase === 'moving' ? billed.actual : fare).toFixed(2)} Pi</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setCallOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#4C1FB8] py-3 text-sm font-black text-white">
                  <Phone className="h-4 w-4" />
                  전화하기
                </button>
                <button type="button" onClick={() => setChatOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-[#4C1FB8] bg-white py-3 text-sm font-black text-[#4C1FB8]">
                  <MessageCircle className="h-4 w-4" />
                  채팅하기
                </button>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {phase === 'arriving' && (
                <button type="button" onClick={() => setPhase('boarding')} className="w-full rounded-2xl border-2 border-[#4C1FB8] bg-white py-3 font-black text-[#4C1FB8]">
                  탑승 시작
                </button>
              )}
              {phase === 'boarding' && (
                <button type="button" onClick={() => setPhase('moving')} className="w-full rounded-2xl border-2 border-[#4C1FB8] bg-white py-3 font-black text-[#4C1FB8]">
                  이동 시작
                </button>
              )}
              <PaymentHandler
                service="택시"
                amount={phase === 'moving' ? billed.actual : fare}
                balance={balance}
                place={route}
                qrScanned={false}
                parkingOption="postpaid"
                prepaidSettled={false}
                mode="notice"
                onParkingOption={() => undefined}
                onRequestQr={() => undefined}
                onPay={onPay}
                onNeedCharge={onNeedCharge}
                onContinue={() => undefined}
                onPrepaidSettled={() => undefined}
              />
              <button
                type="button"
                onClick={handleTaxiPostpay}
                disabled={piPaying}
                className="w-full rounded-2xl bg-[#4A82B8] py-4 text-lg font-bold text-white shadow-[0_10px_22px_rgba(74,130,184,0.28)] disabled:opacity-60"
              >
                {piPaying ? 'Pi 결제 진행 중…' : '이용 완료 · 후결제'}
              </button>
              <p className="text-center text-[11px] font-bold text-[#64748B]">목적지 도착 후 눌러 주세요 · 하차 완료</p>
              <button type="button" onClick={cancelRide} className="w-full rounded-2xl border-2 border-[#CBD5E1] bg-white py-3.5 font-black text-[#475569]">
                {phase === 'moving' ? '운행 취소' : '호출 취소'}
              </button>
            </div>
          </div>
        )}
      </section>
      {callOpen ? <SafeCallModal driverName={driver.name} onHangup={() => setCallOpen(false)} /> : null}
      {chatOpen ? <DriverChatModal driverName={driver.name} onClose={() => setChatOpen(false)} /> : null}
    </div>
  )
}

function MoreHubSheet({
  onClose,
  onNotice,
  onSelectService,
}: {
  onClose: () => void
  onNotice: (message: string) => void
  onSelectService: (label: string) => void
}) {
  const [view, setView] = useState<MoreItemId | 'menu' | `notice:${string}`>('menu')
  return (
    <div className="fixed inset-0 z-[96] flex items-end bg-[#241d35]/45" onClick={onClose}>
      <section
        className="mx-auto flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-[32px] bg-white px-5 pb-8 pt-3 shadow-[0_-16px_40px_rgba(36,27,56,0.2)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 shrink-0 rounded-full bg-[#ddd7e7]" />
        {view === 'menu' ? (
          <>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-black text-[#4C1FB8]">TAXITAGO SERVICE</p>
                <h2 className="mt-1 text-2xl font-black">더보기</h2>
              </div>
              <button type="button" onClick={onClose} className="rounded-full bg-[#f4f1f8] p-2 text-[#5f566d]" aria-label="닫기">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
              <p className="mb-2 mt-4 text-xs font-black text-[#8b8495]">안내 · 설정</p>
              <div className="-mt-5">
                <MoreMenu onOpen={setView} />
              </div>
              <p className="mb-2 mt-5 text-xs font-black text-[#475569]">이동 서비스</p>
              <div className="rounded-[22px] bg-[#E2E8F0] p-3">
                <div className="grid grid-cols-4 gap-x-2 gap-y-4">
                  {services
                    .filter((item) => item.label !== '더보기')
                    .map((item) => (
                      <ServiceIconButton key={item.label} service={item} onClick={() => onSelectService(item.label)} />
                    ))}
                </div>
              </div>
            </div>
          </>
        ) : view === 'notice' ? (
          <NoticeListView onBack={() => setView('menu')} onOpen={(id) => setView(`notice:${id}`)} />
        ) : view.startsWith('notice:') ? (
          <NoticeDetailView id={view.slice(7)} onBack={() => setView('notice')} />
        ) : view === 'fares' ? (
          <FaresView onBack={() => setView('menu')} />
        ) : view === 'support' ? (
          <SupportView onBack={() => setView('menu')} onNotice={onNotice} />
        ) : (
          <SettingsView onBack={() => setView('menu')} onNotice={onNotice} />
        )}
      </section>
    </div>
  )
}

function ServiceSheet({
  service,
  onClose,
  onNotice,
  balance,
  onPay,
  onSettle,
  onNeedCharge,
  onAskReview,
  initialPhase = 'idle',
  daeriTrip,
  onSelectService,
}: {
  service: string
  onClose: () => void
  onNotice: (message: string) => void
  balance: number
  onPay: (amount: number, place: string, label: string, estimated?: number) => boolean | Promise<boolean>
  onSettle: (amount: number, place: string, label: string, estimated: number | undefined, proof: { paymentId: string; txid: string }) => void
  onNeedCharge: () => void
  onAskReview: (driver: { name: string; vehicle: string; plate: string }) => void
  initialPhase?: 'idle' | 'matching' | 'assigned'
  daeriTrip?: { pickup: string; dest: string; plan: string; fare: number } | null
  onSelectService?: (label: string) => void
}) {
  const [phase, setPhase] = useState<'idle' | 'matching' | 'assigned'>(initialPhase)
  const [deliveryVehicle, setDeliveryVehicle] = useState('오토바이')
  const [packageSize, setPackageSize] = useState('소형')
  const [selectedItem, setSelectedItem] = useState('')
  const [qrOpen, setQrOpen] = useState(false)
  const [qrScanned, setQrScanned] = useState(false)
  const [parkingOption, setParkingOption] = useState<'prepaid' | 'postpaid'>('prepaid')
  const [prepaidSettled, setPrepaidSettled] = useState(false)
  const [rideStage, setRideStage] = useState<'arriving' | 'moving'>('arriving')
  const finishedRef = useRef(false)
  const paymentPolicy = getPaymentPolicy(service)
  const ride = service === '대리운전'
  const vehicle = service === '자전거' || service === '킥보드'
  const more = service === '더보기'
  const selfServe = service === '주차' || service === '자전거' || service === '킥보드' || service === 'EV 충전'
  const parkingSpots = [
    { name: '서울시청 주차장', distance: '220m', extra: '잔여 24자리', rate: '2 Pi / 시간' },
    { name: '세종로 공영주차장', distance: '380m', extra: '잔여 8자리', rate: '1.5 Pi / 시간' },
    { name: '광화문 주차타워', distance: '510m', extra: '잔여 3자리', rate: '2.4 Pi / 시간' },
    { name: '시청역 민간주차장', distance: '690m', extra: '잔여 12자리', rate: '3 Pi / 시간' },
  ]
  const evStations = [
    { name: '시청역 EV 스테이션', distance: '180m', extra: '잔여 전력 78%', rate: '0.4 Pi / kWh' },
    { name: '덕수궁 EV 충전소', distance: '340m', extra: '잔여 전력 62%', rate: '0.45 Pi / kWh' },
    { name: '서울광장 충전 허브', distance: '490m', extra: '잔여 전력 91%', rate: '0.38 Pi / kWh' },
    { name: '을지로 급속 충전소', distance: '720m', extra: '잔여 전력 44%', rate: '0.5 Pi / kWh' },
  ]
  const bikes = [
    { name: 'BIKE-2048', distance: '180m', extra: '배터리 85%', rate: '0.2 Pi' },
    { name: 'BIKE-1176', distance: '260m', extra: '배터리 72%', rate: '0.2 Pi' },
    { name: 'BIKE-3901', distance: '340m', extra: '배터리 94%', rate: '0.2 Pi' },
    { name: 'BIKE-5520', distance: '480m', extra: '배터리 61%', rate: '0.2 Pi' },
  ]
  const scooters = [
    { name: 'SCOOT-7312', distance: '120m', extra: '배터리 85%', rate: '0.3 Pi' },
    { name: 'SCOOT-2104', distance: '230m', extra: '배터리 68%', rate: '0.3 Pi' },
    { name: 'SCOOT-8870', distance: '390m', extra: '배터리 91%', rate: '0.3 Pi' },
    { name: 'SCOOT-6402', distance: '520m', extra: '배터리 77%', rate: '0.3 Pi' },
  ]
  const catalog = service === '주차' ? parkingSpots : service === 'EV 충전' ? evStations : service === '자전거' ? bikes : scooters
  const selectedUsage = catalog.find((item) => item.name === selectedItem) ?? catalog[0]
  const deliveryFare = deliveryVehicle === '오토바이' ? (packageSize === '소형' ? 1.2 : 1.8) : deliveryVehicle === '다마스' ? 2.6 : 4.2
  const fare = ride ? (daeriTrip?.fare ?? 2.1) : service === '주차' ? 2 : service === 'EV 충전' ? 4 : vehicle ? 0.3 : deliveryFare
  const settleTiming = service === '주차' ? parkingOption : paymentPolicy?.timing
  const place = ride && daeriTrip ? `${daeriTrip.pickup} → ${daeriTrip.dest}` : selectedItem || `서울시청 → ${service} 이용`
  const billed = ride ? settleRideFare(fare, `daeri:${place}`) : { estimate: fare, actual: fare, adjusted: false }
  const chargeAmount = ride ? billed.actual : fare
  const partner =
    ride
      ? { name: '김민수', vehicle: '대리운전', plate: '파이 모빌리티' as string, kind: 'driver' as const }
      : service === '택배'
        ? { name: '최배송', vehicle: `${deliveryVehicle} 택배`, plate: '서울 88바 2201', kind: 'driver' as const }
        : { name: selectedUsage.name, vehicle: service, plate: selectedUsage.rate, kind: 'service' as const }
  const canStart = more || ride || service === '택배' || Boolean(selectedItem)
  const action = (message: string) => {
    onNotice(message)
    onClose()
  }
  const startService = (scanned?: boolean) => {
    const didScan = scanned ?? qrScanned
    if (!canStart) return
    if (paymentPolicy?.requiresQr && !didScan) {
      setQrOpen(true)
      return
    }
    setPhase('matching')
    onNotice(selfServe ? `${service} 이용을 시작했어요.` : `${service} 호출을 시작했어요.`)
  }
  useEffect(() => {
    if (phase !== 'matching') return
    const timer = window.setTimeout(() => {
      setPhase('assigned')
      if (ride) setRideStage('arriving')
      onNotice(selfServe ? `${service} 이용이 시작되었습니다.` : `${service} 배정이 완료되었습니다.`)
    }, 2200)
    return () => window.clearTimeout(timer)
  }, [phase, service, onNotice])
  return (
    <div className="fixed inset-0 z-[90] flex items-end bg-[#241d35]/45 p-0 sm:p-4">
      <div className="mx-auto max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-white px-5 pb-8 pt-3 shadow-[0_-16px_40px_rgba(36,27,56,0.2)] sm:rounded-[32px]">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#ddd7e7]" />
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-black text-[#4C1FB8]">
              {phase === 'matching' ? (selfServe ? 'READY' : 'CALLING') : phase === 'assigned' ? (ride ? (rideStage === 'moving' ? '운행 중' : '배차 완료') : selfServe ? '이용 중' : '배정 완료') : 'TAXITAGO SERVICE'}
            </p>
            <h2 className="mt-1 text-2xl font-black">
              {ride && phase === 'assigned' ? (rideStage === 'moving' ? '목적지 이동 중' : '기사 이동 중') : `${service} ${phase === 'matching' ? (selfServe ? '준비 중' : '호출 중') : phase === 'assigned' ? '이용 중' : '이용하기'}`}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-full bg-[#f4f1f8] p-2 text-[#5f566d]" aria-label="닫기">
            <X className="h-5 w-5" />
          </button>
        </div>
        {!more && phase === 'matching' && (
          <div className="mt-5 rounded-[26px] bg-[#F8F5FF] p-6 text-center">
            <div className="relative mx-auto flex h-28 w-28 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full border-2 border-[#C4B5FD]" />
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#4C1FB8] text-white">
                {selfServe ? <MapPin className="h-7 w-7" /> : <Car className="h-7 w-7" />}
              </span>
            </div>
            <h3 className="mt-5 text-xl font-black">{selfServe ? '이용을 준비하고 있어요' : '배정 중입니다...'}</h3>
            <p className="mt-2 text-sm font-bold text-[#8b8495]">
              {ride && daeriTrip ? `${daeriTrip.pickup} → ${daeriTrip.dest}` : selfServe ? `${service} 정보를 확인하고 있습니다.` : `${service} 담당자를 찾고 있어요.`}
            </p>
            <button type="button" onClick={onClose} className="mt-5 w-full rounded-2xl border-2 border-[#CBD5E1] bg-white py-3.5 font-black text-[#475569]">
              {selfServe ? '이용 취소' : '호출 취소'}
            </button>
          </div>
        )}
        {!more && phase === 'assigned' && selfServe && (
          <div className="mt-5 space-y-3">
            <div className="rounded-[24px] border-2 border-[#E0D4FF] bg-[#F8F5FF] p-4">
              <p className="text-xs font-black text-[#4C1FB8]">{service} 이용 정보</p>
              <p className="mt-2 text-lg font-black text-[#0F172A]">{selectedUsage.name}</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">{service === '주차' || service === 'EV 충전' ? '위치' : '거리'}</p>
                  <p className="mt-1 text-sm font-black text-[#0F172A]">{selectedUsage.distance}</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">{service === '주차' ? '잔여 자리' : service === 'EV 충전' ? '잔여 전력' : '대여 상태'}</p>
                  <p className="mt-1 text-sm font-black text-[#4C1FB8]">{service === '자전거' || service === '킥보드' ? '대여 중' : selectedUsage.extra}</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">{service === 'EV 충전' ? '충전 요금' : '이용 요금'}</p>
                  <p className="mt-1 text-sm font-black text-[#0F172A]">{selectedUsage.rate}</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">{service === '자전거' || service === '킥보드' ? '배터리' : '진행 상태'}</p>
                  <p className="mt-1 text-sm font-black text-[#0F172A]">{service === '자전거' || service === '킥보드' ? selectedUsage.extra : service === 'EV 충전' ? '충전 중' : '주차 이용 중'}</p>
                </div>
              </div>
            </div>
            <PaymentHandler
              service={service}
              amount={fare}
              balance={balance}
              place={place}
              qrScanned={qrScanned}
              parkingOption={parkingOption}
              prepaidSettled={prepaidSettled}
              mode="notice"
              onParkingOption={setParkingOption}
              onRequestQr={() => setQrOpen(true)}
              onPay={onPay}
              onNeedCharge={onNeedCharge}
              onContinue={() => undefined}
              onPrepaidSettled={() => setPrepaidSettled(true)}
            />
            <PiCheckoutButton
              amount={chargeAmount}
              memo={`${service} ${chargeAmount} Pi`}
              metadata={{ kind: 'service-pay', place, label: `${service} 이용` }}
              className="w-full rounded-2xl bg-[#4A82B8] py-4 text-lg font-bold text-white shadow-[0_10px_22px_rgba(74,130,184,0.28)]"
              onPaid={(result) => {
                if (!result.paymentId || !result.txid) return
                onSettle(chargeAmount, place, `${service} 이용`, ride ? billed.estimate : undefined, result)
                onAskReview(partner)
                onClose()
              }}
              onFailed={(error) => onNotice(describePiUserMessage(error))}
            >
              {settleTiming === 'qr_auto' ? '이용 완료 · 자동결제' : settleTiming === 'postpaid' ? '이용 완료 · 후결제' : '이용 완료'}
            </PiCheckoutButton>
            <p className="text-center text-[11px] font-bold text-[#64748B]">이용이 끝나면 눌러 주세요</p>
          </div>
        )}
        {!more && phase === 'assigned' && !selfServe && (
          <div className="mt-5 space-y-3">
            {ride ? (
              <TaxiLiveMap
                kind="daeri"
                phase={rideStage === 'moving' ? 'moving' : 'arriving'}
                routeLabel={place}
                statusLabel={rideStage === 'moving' ? '목적지 이동 중' : '기사 이동 중'}
              />
            ) : null}
            <div className="rounded-[24px] border-2 border-[#E0D4FF] bg-[#F8F5FF] p-4">
              <p className="text-xs font-black text-[#2d9a5e]">{ride ? (rideStage === 'moving' ? '운행 시작' : '배정 완료') : '배정 완료'}</p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#4C1FB8] font-black text-white">{partner.name.slice(0, 1)}</div>
                <div>
                  <p className="font-black text-[#0F172A]">{partner.name} 기사님</p>
                  <p className="mt-1 text-xs font-bold text-[#475569]">{partner.vehicle} · {partner.plate}{daeriTrip ? ` · ${daeriTrip.plan}` : ''}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">{ride && rideStage === 'moving' ? '실제 이용 요금' : '예상 요금'}</p>
                  <p className="mt-1 text-sm font-black text-[#4C1FB8]">{(ride && rideStage === 'moving' ? billed.actual : fare).toFixed(2)} Pi</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">이용 상태</p>
                  <p className="mt-1 text-sm font-black text-[#0F172A]">{ride ? (rideStage === 'moving' ? '목적지 이동 중' : '호출자에게 이동 중') : '이동/이용 중'}</p>
                </div>
              </div>
            </div>
            {ride && rideStage === 'arriving' ? (
              <button type="button" onClick={() => setRideStage('moving')} className="w-full rounded-2xl border-2 border-[#4A82B8] bg-white py-3.5 text-base font-bold text-[#4A82B8]">
                운행 시작
              </button>
            ) : null}
            <PiCheckoutButton
              amount={ride && rideStage === 'moving' ? billed.actual : fare}
              memo={`${service} ${(ride && rideStage === 'moving' ? billed.actual : fare)} Pi`}
              metadata={{ kind: 'service-pay', place, label: `${service} 이용` }}
              className="w-full rounded-2xl bg-[#4C1FB8] py-4 text-lg font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)]"
              onPaid={(result) => {
                if (!result.paymentId || !result.txid) return
                const paid = ride && rideStage === 'moving' ? billed.actual : fare
                onSettle(paid, place, `${service} 이용`, ride ? billed.estimate : undefined, result)
                onAskReview(partner)
                onClose()
              }}
              onFailed={(error) => onNotice(describePiUserMessage(error))}
            >
              이용 완료
            </PiCheckoutButton>
            <p className="text-center text-[11px] font-bold text-[#8b8495]">{ride && rideStage === 'arriving' ? '기사님이 도착하면 운행을 시작해 주세요' : '도착 후 눌러 주세요 · 하차 완료'}</p>
          </div>
        )}
        {phase === 'idle' && ride && (
          <div className="mt-5 space-y-3">
            <div className="relative flex h-28 items-center justify-center overflow-hidden rounded-3xl bg-[#f7f3ff]">
              <div className="absolute h-20 w-20 animate-ping rounded-full border border-[#bda9f5]" />
              <div className="absolute h-12 w-12 rounded-full border-2 border-[#7046dc]" />
              <Car className="relative z-10 h-6 w-6 text-[#7046dc]" />
            </div>
            <div className="rounded-3xl border border-[#ece8f4] bg-[#F8F5FF] p-4">
              <p className="text-xs font-black text-[#4C1FB8]">주변 대리기사 대기 중</p>
              <p className="mt-2 text-sm font-bold text-[#475569]">호출하면 가까운 기사님이 배정됩니다.</p>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="text-xs font-bold text-[#8b8495]">예상 도착</p>
                  <p className="text-lg font-black text-[#4C1FB8]">약 4분</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-[#8b8495]">예상 요금</p>
                  <p className="text-lg font-black">{fare.toFixed(2)} Pi</p>
                </div>
              </div>
            </div>
            <button type="button" onClick={() => startService()} className="w-full rounded-2xl bg-[#4C1FB8] py-4 text-lg font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)]">
              대리운전 호출하기
            </button>
            <p className="text-center text-[11px] font-bold text-[#8b8495]">호출 후 기사 배정이 시작됩니다.</p>
          </div>
        )}
        {phase === 'idle' && (service === '주차' || service === 'EV 충전') && (
          <div className="mt-5 space-y-3">
            <div className="relative h-32 overflow-hidden rounded-3xl bg-[#e8f0f2]" style={{ backgroundImage: 'linear-gradient(35deg, transparent 46%, #c2d0d2 47%, #c2d0d2 50%, transparent 51%), linear-gradient(120deg, transparent 42%, #c2d0d2 43%, #c2d0d2 46%, transparent 47%)' }}>
              <span className="absolute left-[25%] top-[35%] rounded-full bg-[#7046dc] p-2 text-white">
                <MapPin className="h-4 w-4" />
              </span>
              <p className="absolute bottom-3 left-3 rounded-xl bg-white/90 px-3 py-2 text-xs font-black">주변 500m 실시간 현황</p>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {(service === '주차' ? parkingSpots : evStations).map((item) => (
                <button key={item.name} onClick={() => setSelectedItem(item.name)} className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${selectedItem === item.name ? 'border-[#7046dc] bg-[#f1ebff] ring-2 ring-[#7046dc]/15' : 'border-[#ece8f4] bg-white'}`}>
                  <span className={`h-5 w-5 rounded-full border-2 p-1 ${selectedItem === item.name ? 'border-[#7046dc]' : 'border-[#cfc7db]'}`}>
                    <span className={`block h-full w-full rounded-full ${selectedItem === item.name ? 'bg-[#7046dc]' : 'bg-transparent'}`} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block text-sm font-black">{item.name}</strong>
                    <span className="mt-1 block text-xs font-bold text-[#8b8495]">
                      {item.distance} · <b className="text-[#36a76b]">{item.extra}</b>
                    </span>
                  </span>
                  <span className="text-xs font-black text-[#7046dc]">{item.rate}</span>
                </button>
              ))}
            </div>
            <PaymentHandler
              service={service}
              amount={fare}
              balance={balance}
              place={place}
              qrScanned={qrScanned}
              parkingOption={parkingOption}
              prepaidSettled={prepaidSettled}
              continueLabel={selectedItem ? '이용 시작' : '장소를 선택해 주세요'}
              canProceed={Boolean(selectedItem)}
              onParkingOption={setParkingOption}
              onRequestQr={() => {
                if (!selectedItem) {
                  onNotice('먼저 장소를 선택해 주세요.')
                  return
                }
                setQrOpen(true)
              }}
              onPay={onPay}
              onNeedCharge={onNeedCharge}
              onContinue={() => startService()}
              onPrepaidSettled={() => {
                setPrepaidSettled(true)
                startService(true)
              }}
            />
          </div>
        )}
        {phase === 'idle' && vehicle && (
          <div className="mt-5 space-y-3">
            <div className="relative h-28 rounded-3xl bg-[#edf8f0]">
              <span className="absolute left-[42%] top-[30%] rounded-full bg-[#36a76b] p-3 text-white shadow-lg">
                <Bike className="h-5 w-5" />
              </span>
              <p className="absolute bottom-3 left-4 text-xs font-black text-[#277a4d]">가까운 차량 4대</p>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {(service === '자전거' ? bikes : scooters).map((item) => (
                <button key={item.name} onClick={() => setSelectedItem(item.name)} className={`w-full rounded-2xl border p-3 text-left transition ${selectedItem === item.name ? 'border-[#7046dc] bg-[#f1ebff] ring-2 ring-[#7046dc]/15' : 'border-[#ece8f4] bg-white'}`}>
                  <div className="flex items-center gap-3">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${selectedItem === item.name ? 'bg-[#7046dc] text-white' : 'bg-[#edf8f0] text-[#36a76b]'}`}>
                      <Bike className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block text-sm font-black">{item.name}</strong>
                      <span className="mt-1 block text-xs font-bold text-[#8b8495]">
                        {item.distance} · <b className="text-[#36a76b]">{item.extra}</b>
                      </span>
                    </span>
                    <span className={`h-5 w-5 rounded-full border-2 p-1 ${selectedItem === item.name ? 'border-[#7046dc]' : 'border-[#cfc7db]'}`}>
                      <span className={`block h-full w-full rounded-full ${selectedItem === item.name ? 'bg-[#7046dc]' : 'bg-transparent'}`} />
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <PaymentHandler
              service={service}
              amount={fare}
              balance={balance}
              place={place}
              qrScanned={qrScanned}
              parkingOption={parkingOption}
              prepaidSettled={prepaidSettled}
              continueLabel={selectedItem ? '이용 시작' : '차량을 선택해 주세요'}
              canProceed={Boolean(selectedItem)}
              onParkingOption={setParkingOption}
              onRequestQr={() => {
                if (!selectedItem) {
                  onNotice('먼저 차량을 선택해 주세요.')
                  return
                }
                setQrOpen(true)
              }}
              onPay={onPay}
              onNeedCharge={onNeedCharge}
              onContinue={() => startService(true)}
              onPrepaidSettled={() => {
                setPrepaidSettled(true)
                startService(true)
              }}
            />
          </div>
        )}
        {phase === 'idle' && service === '택배' && (
          <div className="mt-5 space-y-4">
            <div>
              <p className="mb-2 text-sm font-black">차량 선택</p>
              <div className="grid grid-cols-3 gap-2">
                {['오토바이', '다마스', '1톤 트럭'].map((item) => (
                  <button key={item} onClick={() => setDeliveryVehicle(item)} className={`rounded-2xl border p-3 text-xs font-black ${deliveryVehicle === item ? 'border-[#7046dc] bg-[#7046dc] text-white' : 'border-[#ece8f4] bg-white'}`}>
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-black">상품 크기</p>
              <div className="flex gap-2">
                {['소형', '중형', '대형'].map((item) => (
                  <button key={item} onClick={() => setPackageSize(item)} className={`rounded-full px-4 py-2 text-xs font-black ${packageSize === item ? 'bg-[#7046dc] text-white' : 'bg-[#f1eff7] text-[#5f566d]'}`}>
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-3xl bg-[#f7f3ff] p-4">
              <div className="flex justify-between">
                <span className="font-black">예상 배송 요금</span>
                <strong className="text-xl text-[#7046dc]">{deliveryFare.toFixed(1)} Pi</strong>
              </div>
              <p className="mt-2 text-xs font-bold text-[#8b8495]">
                {deliveryVehicle} · {packageSize} · 30분 내 배차
              </p>
            </div>
            <button type="button" onClick={() => startService()} className="w-full rounded-2xl bg-[#4C1FB8] py-4 font-black text-white">
              배송 요청하기
            </button>
          </div>
        )}
        {more && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-black text-[#8b8495]">안내 · 설정</p>
            <MoreMenu />
            <p className="mb-2 mt-5 text-xs font-black text-[#475569]">이동 서비스</p>
            <div className="rounded-[22px] bg-[#E2E8F0] p-3">
              <div className="grid grid-cols-3 gap-x-2 gap-y-4">
                {services
                  .filter((item) => item.label !== '더보기')
                  .map((item) => (
                    <ServiceIconButton
                      key={item.label}
                      service={item}
                      onClick={() => {
                        if (onSelectService) onSelectService(item.label)
                        else action(`${item.label} 서비스를 선택했어요.`)
                      }}
                    />
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {qrOpen ? (
        <QrScanModal
          service={service}
          onClose={() => setQrOpen(false)}
          onScanned={() => {
            setQrScanned(true)
            setQrOpen(false)
            onNotice(`${service} QR 스캔이 완료되었어요.`)
            if (paymentPolicy?.timing === 'qr_auto') startService(true)
          }}
        />
      ) : null}
    </div>
  )
}

function DaeriCallSetupSheet({
  destination,
  onClose,
  onCall,
}: {
  destination: string
  onClose: () => void
  onCall: (trip: { pickup: string; dest: string; plan: string; fare: number }) => void
}) {
  const [pickup, setPickup] = useState('서울특별시 중구 세종대로 110')
  const [dest, setDest] = useState(destination.trim() || '')
  const [plan, setPlan] = useState<'착한요금' | '빠른배정'>('착한요금')
  const [mapPlace, setMapPlace] = useState(SEOUL_CITY_HALL)
  const [mapPicker, setMapPicker] = useState(false)
  const [pendingPick, setPendingPick] = useState<{ lat: number; lng: number; address: string } | null>(null)
  const [sheetOpen, setSheetOpen] = useState(true)
  const [sheetHeight, setSheetHeight] = useState(360)
  const [dragOffset, setDragOffset] = useState(0)
  const [sheetDragging, setSheetDragging] = useState(false)
  const sheetRef = useRef<HTMLElement>(null)
  const dragRef = useRef({ active: false, startY: 0, pointerId: -1 })
  const peekHeight = 72
  const plans = [
    { id: '착한요금' as const, fare: 2.1, caption: '합리적인 기본 요금' },
    { id: '빠른배정' as const, fare: 2.8, caption: '가까운 기사 우선 배정' },
  ]
  const selected = plans.find((item) => item.id === plan) ?? plans[0]
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        setMapPlace({ lat, lng, label: '현재 위치' })
        void fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ko`, {
          headers: { Accept: 'application/json' },
        })
          .then((response) => (response.ok ? response.json() : null))
          .then((data: { display_name?: string } | null) => {
            if (data?.display_name) setPickup(data.display_name.split(',').slice(0, 3).join(' ').trim())
          })
          .catch(() => undefined)
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60_000 },
    )
  }, [])
  const pickMapPoint = (lat: number, lng: number) => {
    const fallback = virtualPickupAddress(lat, lng)
    setMapPlace({ lat, lng, label: '선택 위치' })
    setPendingPick({ lat, lng, address: fallback })
    void fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ko`, {
      headers: { Accept: 'application/json' },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { display_name?: string } | null) => {
        const address = data?.display_name?.split(',').slice(0, 3).join(' ').trim()
        if (!address) return
        setPendingPick((current) => (current && current.lat === lat && current.lng === lng ? { ...current, address } : current))
      })
      .catch(() => undefined)
  }
  const closePicker = () => {
    setMapPicker(false)
    setPendingPick(null)
  }
  useLayoutEffect(() => {
    const node = sheetRef.current
    if (!node) return
    const measure = () => setSheetHeight(node.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [pickup, dest, plan, mapPicker])
  const collapsedY = Math.max(0, sheetHeight - peekHeight)
  const sheetY = mapPicker ? sheetHeight + 48 : Math.min(collapsedY, Math.max(0, (sheetOpen ? 0 : collapsedY) + dragOffset))
  const bottomInset = mapPicker ? 0 : Math.max(peekHeight, sheetHeight - sheetY)
  const finishSheetDrag = (clientY: number) => {
    if (!dragRef.current.active) return
    const delta = clientY - dragRef.current.startY
    dragRef.current.active = false
    setSheetDragging(false)
    setDragOffset(0)
    if (Math.abs(delta) < 12) {
      setSheetOpen((open) => !open)
      return
    }
    if (sheetOpen && delta > 48) setSheetOpen(false)
    else if (!sheetOpen && delta < -48) setSheetOpen(true)
  }
  return (
    <div className="fixed inset-0 z-[52] bg-[#1e1033]/40">
      <div className="relative mx-auto h-full max-w-md overflow-hidden bg-[#E2E8F0]">
        <LocationTileMap
          lat={mapPlace.lat}
          lng={mapPlace.lng}
          className="h-full"
          interactive
          pulsePin
          bottomInset={bottomInset}
          onActivate={mapPicker ? undefined : () => setMapPicker(true)}
          onPick={mapPicker ? pickMapPoint : undefined}
        />
        {mapPicker ? (
          <button type="button" onClick={closePicker} className="absolute left-4 top-5 z-20 rounded-full bg-white p-2 text-[#334155] shadow-md" aria-label="지도 선택 닫기">
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : (
          <button type="button" onClick={onClose} className="absolute left-4 top-5 z-20 rounded-full bg-white p-2 text-[#334155] shadow-md" aria-label="닫기">
            <X className="h-5 w-5" />
          </button>
        )}
        <div
          className={`absolute inset-x-0 bottom-0 z-20 px-3 pb-5 transition-all duration-300 ease-out ${mapPicker && pendingPick ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-8 opacity-0'}`}
        >
          <div className="rounded-[26px] border-2 border-[#334155] bg-white px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.18)]">
            <p className="text-sm font-semibold text-[#1d4ed8]">선택한 위치</p>
            <p className="mt-1.5 text-lg font-bold leading-snug text-[#0f172a]">{pendingPick?.address ?? ''}</p>
            <button
              type="button"
              onClick={() => {
                if (!pendingPick) return
                setPickup(pendingPick.address)
                closePicker()
              }}
              className="mt-4 w-full rounded-2xl bg-[#2563EB] py-4 text-lg font-bold text-white shadow-[0_10px_22px_rgba(37,99,235,0.38)]"
            >
              출발지로 설정
            </button>
          </div>
        </div>
        <section
          ref={sheetRef}
          className={`absolute inset-x-0 bottom-0 z-30 rounded-t-[28px] bg-white px-5 pb-7 pt-1 shadow-[0_-16px_32px_rgba(36,27,56,0.16)] ${sheetDragging ? '' : 'transition-transform duration-300 ease-out'}`}
          style={{ transform: `translateY(${sheetY}px)` }}
        >
          <button
            type="button"
            aria-expanded={sheetOpen}
            aria-label={sheetOpen ? '호출 창 접기' : '호출 창 펼치기'}
            className="flex w-full touch-none flex-col items-center pb-2 pt-2"
            onPointerDown={(event) => {
              dragRef.current = { active: true, startY: event.clientY, pointerId: event.pointerId }
              setSheetDragging(true)
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (!dragRef.current.active) return
              setDragOffset(event.clientY - dragRef.current.startY)
            }}
            onPointerUp={(event) => finishSheetDrag(event.clientY)}
            onPointerCancel={(event) => finishSheetDrag(event.clientY)}
          >
            <span className="h-1.5 w-12 rounded-full bg-[#D4D4D8]" />
            <span className="mt-2 text-[11px] font-bold text-[#94A3B8]">{sheetOpen ? '아래로 밀어 지도를 더 보기' : '위로 밀어 호출 창 열기'}</span>
          </button>
          <p className="text-xs font-black text-[#4C1FB8]">대리 호출 준비</p>
          <label className="mt-3 block">
            <span className="text-[10px] font-black text-[#8b8495]">출발지 주소</span>
            <div className="mt-2 flex items-center gap-2 rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] px-4 py-3">
              <LocateFixed className="h-4 w-4 shrink-0 text-[#4C1FB8]" />
              <input
                value={pickup}
                onChange={(event) => setPickup(event.target.value)}
                placeholder="출발지 주소를 입력해 주세요"
                aria-label="출발지 주소 수정"
                className="min-w-0 flex-1 bg-transparent text-sm font-black outline-none"
              />
            </div>
          </label>
          <label className="mt-3 block">
            <span className="text-[10px] font-black text-[#8b8495]">도착지 · 목적지</span>
            <div className="mt-2 flex items-center gap-2 rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] px-4 py-3">
              <MapPin className="h-4 w-4 text-[#4C1FB8]" />
              <input
                value={dest}
                onChange={(event) => setDest(event.target.value)}
                placeholder="어디로 갈까요?"
                className="min-w-0 flex-1 bg-transparent text-sm font-black outline-none"
              />
            </div>
          </label>
          <p className="mt-4 text-xs font-black text-[#334155]">요금 선택</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {plans.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPlan(item.id)}
                className={`rounded-[20px] border-2 p-3 text-left ${plan === item.id ? 'border-[#4C1FB8] bg-[#F8F5FF]' : 'border-[#E2E8F0] bg-white'}`}
              >
                <p className="text-sm font-black text-[#0F172A]">{item.id}</p>
                <p className="mt-1 text-[11px] font-bold text-[#8b8495]">{item.caption}</p>
                <p className="mt-2 text-base font-black text-[#4C1FB8]">{item.fare.toFixed(1)} Pi</p>
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!pickup.trim() || !dest.trim()}
            onClick={() => onCall({ pickup: pickup.trim(), dest: dest.trim(), plan: selected.id, fare: selected.fare })}
            className="mt-4 w-full rounded-2xl bg-[#4C1FB8] py-4 font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            대리 호출하기
          </button>
        </section>
      </div>
    </div>
  )
}

function DaeriPromoBanner({ onCall }: { onCall: () => void }) {
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  return (
    <div className="pointer-events-none fixed bottom-[4.6rem] left-1/2 z-[42] w-full max-w-md -translate-x-1/2 px-3">
      <div className={`pointer-events-auto overflow-hidden rounded-[22px] shadow-[0_12px_28px_rgba(76,31,184,0.35)] ${open ? 'bg-gradient-to-b from-[#F3E8FF] via-[#8B5CF6] to-[#1E1B4B] text-[#3B16A8]' : 'bg-gradient-to-b from-[#6D28D9] via-[#4C1FB8] to-[#1E1B4B] text-white'}`}>
        <div className="flex w-full items-center gap-5 px-4 py-3">
          <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <span className={`min-w-0 flex-1 text-sm font-black tracking-tight ${open ? 'text-[#3B16A8]' : 'text-white'}`}>&lsquo;대리&rsquo; 필요하신가요?</span>
            <ChevronUp className={`h-5 w-5 shrink-0 transition-transform duration-300 ${open ? 'rotate-0 text-[#4C1FB8]' : 'rotate-180 text-white'}`} />
          </button>
          <button type="button" onClick={() => setHidden(true)} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${open ? 'bg-[#4C1FB8]/15 text-[#4C1FB8]' : 'bg-white/20 text-white'}`} aria-label="배너 닫기">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
            <div className="border-t border-white/20 px-4 pb-4 pt-2">
              <p className="text-xs font-bold leading-5 text-white">쿠폰으로 부담 없이, 편하게 집까지 이동해보세요</p>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onCall()
                }}
                className="mt-3 w-full rounded-2xl bg-white py-3 text-sm font-black text-[#3B16A8] shadow-[0_8px_16px_rgba(15,23,42,0.18)]"
              >
                대리 호출하기 &gt;
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Home({
  destination,
  pickup,
  gps,
  onDestination,
  onService,
  onReceipt,
  onOpenMap,
}: {
  destination: string
  pickup: string
  gps: GpsFix
  onDestination: (value: string) => void
  onService: (value: string) => void
  onReceipt: (ride: RideReceipt) => void
  onOpenMap: () => void
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [favorites, setFavorites] = useState<FavoritePlace[]>([])
  const [recents, setRecents] = useState<RecentPlace[]>([])
  const [sheetOpen, setSheetOpen] = useState(true)
  const [sheetHeight, setSheetHeight] = useState(360)
  const [dragOffset, setDragOffset] = useState(0)
  const [sheetDragging, setSheetDragging] = useState(false)
  const sheetRef = useRef<HTMLElement>(null)
  const dragRef = useRef({ active: false, startX: 0, startY: 0, axis: null as null | 'x' | 'y', fromHandle: false })
  const peekHeight = 118

  useEffect(() => {
    setFavorites(readFavoritePlaces())
    setRecents(readRecentPlaces())
  }, [])

  const rememberRecent = (name: string, address?: string) => {
    const next = [{ id: `${Date.now()}`, name, address: address || name }, ...recents.filter((place) => place.name !== name && place.address !== address)]
    setRecents(next)
    writeRecentPlaces(next)
  }
  const select = (name: string, address?: string) => {
    rememberRecent(name, address)
    onDestination(address || name)
    setSearchOpen(false)
  }
  const addFavorite = (place: { name: string; address: string }) => {
    const next = [...favorites, { id: `${Date.now()}`, ...place }]
    setFavorites(next)
    writeFavoritePlaces(next)
    setFormOpen(false)
  }
  const removeFavorite = (id: string) => {
    const next = favorites.filter((place) => place.id !== id)
    setFavorites(next)
    writeFavoritePlaces(next)
  }
  const removeRecent = (id: string) => {
    const next = recents.filter((place) => place.id !== id)
    setRecents(next)
    writeRecentPlaces(next)
  }
  const callTaxi = () => {
    if (!destination) {
      setSearchOpen(true)
      setSheetOpen(true)
      return
    }
    onService('택시')
  }

  useLayoutEffect(() => {
    const node = sheetRef.current
    if (!node) return
    const measure = () => setSheetHeight(node.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [destination, pickup, searchOpen])

  const maxSheetY = Math.max(0, sheetHeight - peekHeight)
  const sheetOrigin = sheetOpen ? 0 : maxSheetY
  const sheetY = Math.min(maxSheetY, Math.max(0, sheetOrigin + dragOffset))

  const finishSheetDrag = (clientY: number) => {
    if (!dragRef.current.active) return
    const delta = clientY - dragRef.current.startY
    const fromHandle = dragRef.current.fromHandle
    const axis = dragRef.current.axis
    dragRef.current = { active: false, startX: 0, startY: 0, axis: null, fromHandle: false }
    setSheetDragging(false)
    setDragOffset(0)
    if (axis === 'x') return
    if (Math.abs(delta) < 12) {
      if (fromHandle) setSheetOpen((open) => !open)
      return
    }
    const projected = Math.min(maxSheetY, Math.max(0, sheetOrigin + delta))
    setSheetOpen(projected < maxSheetY * 0.5)
  }

  const onSheetPointerDown = (event: React.PointerEvent<HTMLElement>, fromHandle = false) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    dragRef.current = { active: true, startX: event.clientX, startY: event.clientY, axis: null, fromHandle }
  }

  const onSheetPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current.active) return
    const dx = event.clientX - dragRef.current.startX
    const dy = event.clientY - dragRef.current.startY
    if (!dragRef.current.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      dragRef.current.axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x'
      if (dragRef.current.axis === 'y') {
        setSheetDragging(true)
        event.currentTarget.setPointerCapture(event.pointerId)
      }
    }
    if (dragRef.current.axis === 'y') {
      event.preventDefault()
      setDragOffset(dy)
    }
  }

  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="absolute inset-0 z-0 bg-[#E2E8F0]">
        <LocationTileMap
          lat={gps.lat}
          lng={gps.lng}
          pinLat={gps.lat}
          pinLng={gps.lng}
          className="h-full min-h-0 w-full touch-none"
          interactive
          showZoom
          pulsePin
        />
      </div>
      <section
        ref={sheetRef}
        className={`absolute inset-x-0 z-10 overflow-hidden rounded-t-[22px] bg-white px-3 pb-3 pt-1 shadow-[0_-12px_28px_rgba(15,23,42,0.14)] ${sheetDragging ? '' : 'transition-transform duration-300 ease-out'}`}
        style={{ bottom: '5.5rem', minHeight: peekHeight, transform: `translateY(${sheetY}px)` }}
        onPointerDown={(event) => onSheetPointerDown(event, false)}
        onPointerMove={onSheetPointerMove}
        onPointerUp={(event) => finishSheetDrag(event.clientY)}
        onPointerCancel={(event) => finishSheetDrag(event.clientY)}
      >
        <button
          type="button"
          data-sheet-handle="true"
          aria-expanded={sheetOpen}
          aria-label={sheetOpen ? '호출 창 접기' : '호출 창 펼치기'}
          className="flex w-full touch-none flex-col items-center pb-1.5 pt-1"
          onPointerDown={(event) => {
            event.stopPropagation()
            onSheetPointerDown(event, true)
          }}
          onPointerMove={onSheetPointerMove}
          onPointerUp={(event) => finishSheetDrag(event.clientY)}
          onPointerCancel={(event) => finishSheetDrag(event.clientY)}
        >
          <span className="h-1 w-10 rounded-full bg-[#D4D4D8]" />
          <span className="mt-1 text-[10px] font-bold text-[#94A3B8]">{sheetOpen ? '아래로 밀어 지도를 더 보기' : '위로 밀어 호출 창 열기'}</span>
        </button>
        <div className="rounded-[18px] border border-[#E2E8F0] bg-[#F8FAFC] p-2">
          <button type="button" onClick={onOpenMap} className="flex min-h-10 w-full items-center gap-2 rounded-xl bg-white px-2.5 py-1.5 text-left shadow-[0_3px_8px_rgba(15,23,42,0.05)]">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-[#4C1FB8]">
              <LocateFixed className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-bold text-[#64748B]">출발지</span>
              <span className="block truncate text-[13px] font-black leading-tight text-[#0F172A]">{pickup}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="mt-1.5 flex min-h-11 w-full items-stretch overflow-hidden rounded-xl border-2 border-[#7C3AED] bg-white text-left shadow-[0_6px_12px_rgba(124,58,237,0.1)]"
            aria-label={destination ? `목적지 ${destination}` : '목적지 검색 열기'}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EDE5FF] text-[#6D28D9]">
                <Search className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-bold text-[#7C3AED]">목적지</span>
                <span className={`block truncate text-sm font-black leading-tight ${destination ? 'text-[#0F172A]' : 'text-[#94A3B8]'}`}>
                  {destination || '어디로 갈까요?'}
                </span>
              </span>
            </span>
            <DestinationTaxiLoop className="w-[7.5rem] shrink-0 self-stretch" />
          </button>
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SUGGESTED_DESTINATIONS.map((place) => {
            const active = destination === place.name || destination === place.address
            return (
              <button
                key={place.name}
                type="button"
                onClick={() => select(place.name, place.address)}
                className={`inline-flex min-h-8 shrink-0 items-center rounded-full px-3 text-[12px] font-black transition active:scale-95 ${
                  active ? 'bg-[#4C1FB8] text-white shadow-[0_6px_12px_rgba(76,31,184,0.24)]' : 'bg-[#F1F5F9] text-[#1E293B]'
                }`}
              >
                {place.name}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={callTaxi}
          className="mt-2.5 flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#4C1FB8] text-[15px] font-black tracking-tight text-white shadow-[0_8px_18px_rgba(76,31,184,0.28)] transition hover:bg-[#3B16A8] active:scale-[0.99]"
        >
          택시 호출하기
        </button>
        <section className="mt-2.5">
          <div className="flex items-end justify-between px-0.5">
            <h2 className="text-sm font-black tracking-tight text-[#0F172A]">무엇을 이용할까요?</h2>
            <span className="text-[10px] font-bold text-[#475569]">8개 서비스</span>
          </div>
          <div className="mt-2 rounded-[22px] bg-[#E2E8F0] p-3">
            <div className="grid grid-cols-4 gap-x-2 gap-y-4">
              {services.map((item) => (
                <ServiceIconButton key={item.label} service={item} onClick={() => onService(item.label)} />
              ))}
            </div>
          </div>
        </section>
        <button type="button" onClick={() => onReceipt(SAMPLE_RIDES[0])} className="mt-2 w-full rounded-xl border border-[#E2E8F0] bg-white px-2.5 py-2 text-left">
          <p className="text-[10px] font-bold text-[#64748B]">최근 이용</p>
          <p className="text-[13px] font-black leading-tight">서울시청 → 강남역 · 3.2 Pi</p>
        </button>
      </section>
      {searchOpen ? (
        <DestinationSearchModal
          destination={destination}
          favorites={favorites}
          recents={recents}
          onClose={() => setSearchOpen(false)}
          onSelect={select}
          onAddFavorite={() => setFormOpen(true)}
          onRemoveFavorite={removeFavorite}
          onRemoveRecent={removeRecent}
          onOpenMap={onOpenMap}
        />
      ) : null}
      {formOpen ? <FavoritePlaceModal onClose={() => setFormOpen(false)} onSave={addFavorite} /> : null}
    </main>
  )
}

function ReceiptModal({ ride, onClose, onNotice }: { ride: RideReceipt; onClose: () => void; onNotice: (message: string) => void }) {
  const shareReceipt = async () => {
    const text = `택시타고 영수증 ${ride.transactionId}\n${ride.origin} → ${ride.dest}\n결제 ${ride.fare} · ${ride.method}\n${ride.driver} 기사님 · ${ride.car} ${ride.plate}\n${ride.date}`
    try {
      if (navigator.share) {
        await navigator.share({ title: '택시타고 영수증', text })
        return
      }
      await navigator.clipboard.writeText(text)
      onNotice('영수증 내용이 복사되었습니다')
    } catch {
      onNotice('공유가 취소되었습니다')
    }
  }
  return (
    <div className="fixed inset-0 z-[98] flex items-end bg-[#1e1033]/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-white p-5 shadow-2xl sm:rounded-[32px]" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-black text-[#4C1FB8]">이용 기록 · 상세 영수증</p>
            <h2 className="mt-1 text-2xl font-black text-[#0F172A]">결제 영수증</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="내역 닫기">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4 rounded-[26px] bg-[#4C1FB8] p-5 text-white shadow-[0_12px_24px_rgba(76,31,184,0.35)]">
          <p className="text-xs font-bold text-white/75">실제 이용 요금</p>
          <p className="mt-1 text-3xl font-black">{ride.fare}</p>
          {ride.estimatedFare && ride.estimatedFare !== ride.fare ? (
            <p className="mt-2 text-xs font-bold leading-5 text-white/85">실시간 주행 거리/시간에 따라 최종 요금이 산정되었습니다 · 예상 {ride.estimatedFare}</p>
          ) : null}
          <p className="mt-2 text-xs font-black text-[#E8DCFF]">결제 수단 · {ride.method}</p>
        </div>
        <div className="mt-4 rounded-[24px] border-2 border-[#E0D4FF] bg-[#F8F5FF] p-4">
          <p className="text-xs font-black text-[#4C1FB8]">이동 경로</p>
          <div className="mt-3 flex items-start gap-3">
            <div className="flex flex-col items-center pt-1">
              <span className="h-2.5 w-2.5 rounded-full bg-[#4C1FB8]" />
              <span className="my-1 h-8 w-0.5 bg-[#C4B5FD]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#0F172A]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-[#8b8495]">출발지</p>
              <p className="font-black text-[#0F172A]">{ride.origin}</p>
              <p className="mt-3 text-[11px] font-bold text-[#8b8495]">도착지</p>
              <p className="font-black text-[#0F172A]">{ride.dest}</p>
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-[#E0D4FF] bg-white px-4 py-3">
            <p className="text-[10px] font-bold text-[#8b8495]">이동 거리</p>
            <p className="mt-1 text-sm font-black text-[#0F172A]">{ride.distance}</p>
          </div>
          <div className="rounded-2xl border border-[#E0D4FF] bg-white px-4 py-3">
            <p className="text-[10px] font-bold text-[#8b8495]">소요 시간</p>
            <p className="mt-1 text-sm font-black text-[#0F172A]">{ride.duration}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-[22px] border-2 border-[#E0D4FF] bg-[#F8F5FF] p-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#4C1FB8] font-black text-white">{ride.driver.slice(0, 1)}</div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-[#8b8495]">담당 기사님</p>
            <p className="font-black text-[#0F172A]">{ride.driver === '-' ? '해당 없음' : `${ride.driver} 기사님`}</p>
            <p className="mt-1 text-xs font-bold text-[#475569]">{ride.vehicle} · {ride.car} · {ride.plate}</p>
          </div>
        </div>
        <dl className="mt-3 divide-y divide-[#EDE5FF] rounded-[22px] border border-[#E0D4FF] bg-white px-4">
          <div className="flex justify-between gap-3 py-3 text-sm">
            <dt className="font-bold text-[#64748B]">영수증 번호</dt>
            <dd className="font-mono text-xs font-black text-[#0F172A]">{ride.transactionId}</dd>
          </div>
          <div className="flex justify-between gap-3 py-3 text-sm">
            <dt className="font-bold text-[#64748B]">발행 일시</dt>
            <dd className="font-black text-[#0F172A]">{ride.date}</dd>
          </div>
          <div className="flex justify-between gap-3 py-3 text-sm">
            <dt className="font-bold text-[#64748B]">결제 상태</dt>
            <dd className="font-black text-[#2d9a5e]">정상 결제 완료</dd>
          </div>
        </dl>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={shareReceipt} className="inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-[#4C1FB8] bg-white py-3.5 text-sm font-black text-[#4C1FB8]">
            <Share2 className="h-4 w-4" />
            공유하기
          </button>
          <button type="button" onClick={onClose} className="rounded-2xl bg-[#4C1FB8] py-3.5 text-sm font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.35)]">
            내역 닫기
          </button>
        </div>
      </section>
    </div>
  )
}

function InboxDetailModal({ item, onClose }: { item: Notice; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[92] flex items-end bg-[#1e293b]/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto w-full max-w-md rounded-t-[30px] bg-white p-5 shadow-2xl sm:rounded-[30px]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-black text-[#4C1FB8]">{item.kind} · {item.date}</p>
            <h2 className="mt-2 text-xl font-black text-[#0F172A]">{item.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="닫기">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-4 text-sm font-bold leading-6 text-[#475569]">{item.body}</p>
        <button type="button" onClick={onClose} className="mt-5 w-full rounded-2xl bg-[#4C1FB8] py-3.5 font-black text-white">
          확인
        </button>
      </section>
    </div>
  )
}

function ActivityInbox({
  tabRides,
  readNoticeIds,
  onOpenInbox,
}: {
  tabRides: (ride: RideReceipt) => void
  readNoticeIds: string[]
  onOpenInbox: (item: Notice) => void
}) {
  const [view, setView] = useState<'rides' | 'inbox'>('rides')
  const unreadCount = notices.filter((item) => !readNoticeIds.includes(item.id)).length
  const kindClass = (kind: Notice['kind']) =>
    kind === '이벤트' ? 'bg-[#FEF3C7] text-[#B45309]' : kind === '업데이트' ? 'bg-[#DBEAFE] text-[#1D4ED8]' : 'bg-[#EDE5FF] text-[#4C1FB8]'

  return (
    <main className="flex-1 overflow-y-auto px-4 pb-28">
      <h2 className="pt-3 text-2xl font-black">이용/알림</h2>
      <p className="mt-1 text-sm font-bold text-[#64748B]">이용 내역과 공지사항을 전환해 확인하세요.</p>
      <div className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
        <button
          type="button"
          onClick={() => setView('rides')}
          className={`rounded-xl py-2.5 text-xs font-black ${view === 'rides' ? 'bg-[#4C1FB8] text-white shadow-[0_8px_16px_rgba(76,31,184,0.28)]' : 'text-[#64748B]'}`}
        >
          이용 내역
        </button>
        <button
          type="button"
          onClick={() => setView('inbox')}
          className={`rounded-xl py-2.5 text-xs font-black ${view === 'inbox' ? 'bg-[#4C1FB8] text-white shadow-[0_8px_16px_rgba(76,31,184,0.28)]' : 'text-[#64748B]'}`}
        >
          알림/공지{unreadCount > 0 ? ` ${unreadCount}` : ''}
        </button>
      </div>
      {view === 'rides' ? (
        <>
          {SAMPLE_RIDES.map((ride) => (
            <button key={ride.transactionId} type="button" onClick={() => tabRides(ride)} className="mt-3 w-full rounded-3xl border-2 border-[#CBD5E1] bg-white p-4 text-left shadow-[0_8px_18px_rgba(15,23,42,0.1)] transition hover:border-[#4C1FB8] active:scale-[0.99]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 overflow-hidden pr-1">
                  <p className="break-all font-black leading-5 text-[#1E293B] [overflow-wrap:anywhere] line-clamp-2">{ride.route}</p>
                  <p className="mt-2 truncate text-xs font-bold text-[#64748B]">
                    {ride.vehicle} · {ride.date}
                  </p>
                </div>
                <strong className="shrink-0 whitespace-nowrap tabular-nums text-[#7046dc]">{ride.fare}</strong>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-[#E2E8F0] pt-3 text-xs font-bold text-[#8b8495]">
                <span>{ride.distance}</span>
                <span className="text-[#7046dc]">영수증 보기 ›</span>
              </div>
            </button>
          ))}
        </>
      ) : (
        <div className="mt-3 space-y-3">
          {notices.map((item) => {
            const unread = !readNoticeIds.includes(item.id)
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenInbox(item)}
                className={`w-full rounded-[24px] border-2 p-4 text-left shadow-[0_8px_18px_rgba(15,23,42,0.08)] transition active:scale-[0.99] ${unread ? 'border-[#4C1FB8] bg-[#F8F5FF]' : 'border-[#CBD5E1] bg-white'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`rounded-full px-2 py-1 text-[10px] font-black ${kindClass(item.kind)}`}>{item.kind}</span>
                  <span className="text-[11px] font-bold text-[#8b8495]">{item.date}</span>
                </div>
                <div className="mt-2 flex items-start justify-between gap-2">
                  <h3 className="text-sm font-black text-[#0F172A]">{item.title}</h3>
                  {unread ? <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#4C1FB8]" /> : null}
                </div>
                <p className="mt-2 text-xs font-bold leading-5 text-[#64748B]">{item.summary}</p>
                <p className="mt-3 text-xs font-black text-[#4C1FB8]">자세히 보기 ›</p>
              </button>
            )
          })}
        </div>
      )}
    </main>
  )
}

function TabContent({
  tab,
  onService,
  balance,
  onWallet,
  onReceipt,
  readNoticeIds,
  onOpenInbox,
  username,
  driverMode,
  isDriverRegistered,
  isPartnerRegistered,
  piLinked,
  onToggleDriverMode,
  onOpenDriverSignup,
  onOpenPartnerSignup,
  onNotice,
}: {
  tab: string
  destination: string
  onDestination: (value: string) => void
  onService: (value: string) => void
  onNotice: (message: string) => void
  balance: number
  onWallet: () => void
  onReceipt: (ride: RideReceipt) => void
  readNoticeIds: string[]
  onOpenInbox: (item: Notice) => void
  username: string
  driverMode: boolean
  isDriverRegistered: boolean
  isPartnerRegistered: boolean
  piLinked: boolean
  onToggleDriverMode: () => void
  onOpenDriverSignup: () => void
  onOpenPartnerSignup: () => void
}) {
  if (tab === '전체보기') {
    return (
      <main className="flex-1 overflow-y-auto px-4 pb-28">
        <h2 className="pt-3 text-2xl font-black">전체보기</h2>
        <p className="mt-1 text-sm font-bold text-[#64748B]">모든 서비스와 안내를 한곳에서 확인하세요.</p>
        <section className="mt-4">
          <p className="mb-2 text-xs font-black text-[#475569]">안내 · 설정</p>
          <MoreMenu />
          <p className="mb-2 mt-5 text-xs font-black text-[#475569]">이동 서비스</p>
          <div className="rounded-[22px] bg-[#E2E8F0] p-3">
            <div className="grid grid-cols-4 gap-x-2 gap-y-4">
              {services.map((item) => (
                <ServiceIconButton key={item.label} service={item} onClick={() => onService(item.label)} />
              ))}
            </div>
          </div>
        </section>
      </main>
    )
  }
  if (tab === '이용/알림') {
    return <ActivityInbox tabRides={onReceipt} readNoticeIds={readNoticeIds} onOpenInbox={onOpenInbox} />
  }
  return (
    <div className="h-full min-h-0">
    <MyPage
      embedded
      username={username}
      balance={balance}
      driverMode={driverMode}
      isDriverRegistered={isDriverRegistered}
      isPartnerRegistered={isPartnerRegistered}
      piLinked={piLinked}
      onOpenWallet={onWallet}
      onToggleDriverMode={onToggleDriverMode}
      onOpenDriverSignup={onOpenDriverSignup}
      onOpenPartnerSignup={onOpenPartnerSignup}
      onNotice={onNotice}
    />
    </div>
  )
}

const PI_DEPOSIT_ADDRESS = 'GBCX92KL-TAXI-DEPOSIT-ADDRESS'

function WalletModal({
  balance,
  onClose,
  onDeposit,
  onWithdraw,
  transactions,
  onNotice,
  onReceipt,
}: {
  balance: number
  onClose: () => void
  onDeposit: (amount: number) => void
  onWithdraw: (amount: number, address: string) => void
  transactions: PiTransaction[]
  onNotice: (message: string) => void
  onReceipt: (ride: RideReceipt) => void
}) {
  const [tab, setTab] = useState<'charge' | 'refund' | 'history'>('charge')
  const [chargeUnit, setChargeUnit] = useState(10)
  const [address, setAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [process, setProcess] = useState<{ kind: 'charge' | 'withdraw'; phase: 'pending' | 'done'; amount: number } | null>(null)
  const chargeUnits = [5, 10, 25, 50]
  const withdrawValue = Number(amount)

  useEffect(() => {
    if (process?.phase !== 'pending' || process.kind !== 'withdraw') return
    const value = process.amount
    const dest = address.trim()
    const timer = window.setTimeout(() => {
      onWithdraw(value, dest)
      setProcess({ kind: 'withdraw', phase: 'done', amount: value })
    }, 2200)
    return () => window.clearTimeout(timer)
    // Callbacks are recreated each parent render; only restart when a new pending request starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [process?.phase, process?.kind, process?.amount])

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(PI_DEPOSIT_ADDRESS)
    } catch {
      /* clipboard may be unavailable in some browsers */
    }
    onNotice('주소가 복사되었습니다')
  }

  const setQuickAmount = (ratio: number) => {
    const value = Math.round(balance * ratio * 100) / 100
    setAmount(value > 0 ? value.toFixed(2) : '0')
  }

  const requestWithdraw = () => {
    if (process) return
    if (!address.trim() || !withdrawValue || withdrawValue <= 0 || withdrawValue > balance) {
      onNotice('출금 주소와 출금 가능 금액을 확인해 주세요.')
      return
    }
    setProcess({ kind: 'withdraw', phase: 'pending', amount: withdrawValue })
  }

  const tabs = [
    { id: 'charge' as const, label: '충전' },
    { id: 'refund' as const, label: '출금ㆍ환불' },
    { id: 'history' as const, label: '이용 내역' },
  ]

  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-[#241d35]/45 p-0 sm:p-4">
      <div className="mx-auto max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-[#F4F0FB] px-5 pb-8 pt-3 shadow-2xl sm:rounded-[32px]">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d9d3e4]" />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-black text-[#4C1FB8]">PI WALLET</p>
            <h2 className="mt-1 text-2xl font-black text-[#0F172A]">Pi 월렛 관리</h2>
          </div>
          <button onClick={onClose} className="rounded-full bg-white p-2 text-[#5f566d]" aria-label="지갑 닫기">
            <X className="h-5 w-5" />
          </button>
        </div>
        <section className="mt-5 rounded-[26px] bg-[#4C1FB8] p-5 text-white shadow-[0_16px_32px_rgba(76,31,184,0.35)]">
          <p className="text-xs font-bold text-[#E8DCFF]">사용 가능 잔액</p>
          <p className="mt-2 text-3xl font-black">
            {balance.toFixed(2)} <span className="text-lg text-[#E8DCFF]">Pi</span>
          </p>
          <p className="mt-2 text-xs font-bold text-[#E8DCFF]">
            {PI_SANDBOX ? '샌드박스 테스트 잔액으로 충전됩니다' : 'Pi Browser에서 충전하면 공식 결제 창이 열립니다'}
          </p>
        </section>
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-white p-1 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded-xl py-2.5 text-xs font-black transition ${tab === item.id ? 'bg-[#4C1FB8] text-white shadow-[0_8px_16px_rgba(76,31,184,0.28)]' : 'text-[#64748B]'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {tab === 'charge' && (
          <div className="mt-4 space-y-3">
            <section className="rounded-3xl border-2 border-[#E0D4FF] bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-black">입금 주소</p>
                <span className="rounded-full bg-[#EDE5FF] px-2 py-1 text-[10px] font-black text-[#4C1FB8]">입금 전용</span>
              </div>
              <p className="mt-2 text-xs font-bold text-[#8b8495]">아래 주소로 Pi를 입금해 주세요.</p>
              <div className="mt-3 flex items-center gap-2 rounded-2xl border-2 border-[#D8CCF5] bg-[#F8F5FF] px-3 py-3">
                <p className="min-w-0 flex-1 truncate font-mono text-xs font-bold text-[#3B16A8]">{PI_DEPOSIT_ADDRESS}</p>
                <button type="button" onClick={copyAddress} className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-[#4C1FB8] px-3 py-2 text-[11px] font-black text-white">
                  <Copy className="h-3.5 w-3.5" />
                  복사
                </button>
              </div>
            </section>
            <section className="rounded-3xl border-2 border-[#E0D4FF] bg-white p-4">
              <p className="font-black">파이 충전 단위</p>
              <p className="mt-1 text-xs font-bold text-[#8b8495]">충전할 Pi 수량을 선택한 뒤 신청해 주세요.</p>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {chargeUnits.map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => setChargeUnit(unit)}
                    className={`rounded-2xl py-3 text-sm font-black ${chargeUnit === unit ? 'bg-[#4C1FB8] text-white shadow-[0_8px_16px_rgba(76,31,184,0.28)]' : 'bg-[#F1EBFF] text-[#4C1FB8]'}`}
                  >
                    {unit}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex items-end justify-between rounded-2xl bg-[#F8F5FF] px-4 py-3">
                <span className="text-xs font-bold text-[#64748B]">신청 수량</span>
                <strong className="text-lg font-black text-[#4C1FB8]">{chargeUnit.toFixed(2)} Pi</strong>
              </div>
              <button
                type="button"
                disabled={Boolean(process)}
                className="mt-4 w-full rounded-2xl bg-[#4C1FB8] py-3.5 font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.35)] disabled:opacity-60"
                onClick={() => {
                  if (process) return
                  const amount = chargeUnit
                  setProcess({ kind: 'charge', phase: 'pending', amount })
                  void chargePiWallet(amount)
                    .then(() => {
                      onDeposit(amount)
                      setProcess({ kind: 'charge', phase: 'done', amount })
                    })
                    .catch((error) => {
                      setProcess(null)
                      onNotice(describePiUserMessage(error))
                    })
                }}
              >
                충전 신청
              </button>
            </section>
          </div>
        )}
        {tab === 'refund' && (
          <section className="mt-4 rounded-3xl border-2 border-[#E0D4FF] bg-white p-4">
            <p className="font-black">출금ㆍ환불</p>
            <p className="mt-1 text-xs font-bold text-[#8b8495]">보유 Pi를 외부 지갑으로 출금하거나, 결제 금액을 환불받을 때 사용합니다. 받을 주소와 수량을 입력해 주세요.</p>
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="받을 Pi Wallet 주소"
              className="mt-4 w-full rounded-2xl border-2 border-[#D8CCF5] bg-[#F8F5FF] px-4 py-3 text-sm font-bold text-[#0F172A] outline-none focus:border-[#4C1FB8]"
            />
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black text-[#334155]">출금ㆍ환불할 파이 개수</p>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setQuickAmount(0.5)} className="rounded-full bg-[#EDE5FF] px-2.5 py-1 text-[10px] font-black text-[#4C1FB8]">
                    50%
                  </button>
                  <button type="button" onClick={() => setQuickAmount(1)} className="rounded-full bg-[#4C1FB8] px-2.5 py-1 text-[10px] font-black text-white">
                    최대
                  </button>
                </div>
              </div>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="출금 Pi"
                className="mt-2 w-full rounded-2xl border-2 border-[#D8CCF5] bg-[#F8F5FF] px-4 py-3 text-sm font-bold text-[#0F172A] outline-none focus:border-[#4C1FB8]"
              />
            </div>
            <button type="button" onClick={requestWithdraw} className="mt-4 w-full rounded-2xl bg-[#4C1FB8] py-3.5 font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.35)]">
              출금ㆍ환불 신청
            </button>
          </section>
        )}
        {tab === 'history' && (
          <section className="mt-4 space-y-2">
            {transactions.map((transaction, index) => (
              <button
                key={`${transaction.label}-${transaction.at}-${index}`}
                type="button"
                onClick={() => onReceipt(receiptFromTransaction(transaction, index))}
                className="w-full rounded-2xl border border-[#E0D4FF] bg-white p-4 text-left transition hover:border-[#4C1FB8] active:scale-[0.99]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 overflow-hidden pr-1">
                    <p className="truncate font-black">{transaction.label}</p>
                    <p className="mt-1 break-all text-xs font-bold leading-5 text-[#4C1FB8] [overflow-wrap:anywhere] line-clamp-2" title={transaction.place}>
                      {transaction.place}
                    </p>
                    <p className="mt-1 truncate text-xs font-bold text-[#8b8495]">{transaction.at}</p>
                  </div>
                  <strong className={`shrink-0 whitespace-nowrap tabular-nums ${transaction.amount > 0 ? 'text-[#2d9a5e]' : 'text-[#4C1FB8]'}`}>
                    {transaction.amount > 0 ? '+' : ''}
                    {transaction.amount.toFixed(2)} Pi
                  </strong>
                </div>
                <p className="mt-3 text-xs font-black text-[#4C1FB8]">상세 영수증 보기 ›</p>
              </button>
            ))}
          </section>
        )}
      </div>
      {process?.phase === 'pending' && (
        <div className="fixed inset-0 z-[96] flex items-center justify-center bg-[#1e1033]/55 p-6">
          <section className="w-full max-w-sm rounded-[28px] bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#EDE5FF] text-[#4C1FB8]">
              <LoaderCircle className="h-7 w-7 animate-spin" />
            </div>
            <h3 className="mt-4 text-xl font-black text-[#0F172A]">블록체인 네트워크 승인 대기</h3>
            <p className="mt-2 text-sm font-bold leading-6 text-[#64748B]">
              {process.kind === 'charge' ? '충전' : '출금ㆍ환불'} {process.amount.toFixed(2)} Pi 트랜잭션을 Pi Network에서 확인하고 있습니다.
            </p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#EDE5FF]">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-[#4C1FB8]" />
            </div>
          </section>
        </div>
      )}
      {process?.phase === 'done' && (
        <div className="fixed inset-0 z-[96] flex items-center justify-center bg-[#1e1033]/55 p-6">
          <section className="w-full max-w-sm rounded-[28px] bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#4C1FB8] text-white">
              <Check className="h-7 w-7" strokeWidth={3} />
            </div>
            <h3 className="mt-4 text-xl font-black text-[#0F172A]">처리가 완료되었습니다</h3>
            <p className="mt-2 text-sm font-bold text-[#64748B]">
              {process.kind === 'charge' ? '충전' : '출금ㆍ환불'} {process.amount.toFixed(2)} Pi가 월렛에 반영되었습니다.
            </p>
            <button type="button" onClick={() => setProcess(null)} className="mt-5 w-full rounded-2xl bg-[#4C1FB8] py-3.5 font-black text-white">
              확인
            </button>
          </section>
        </div>
      )}
    </div>
  )
}

function HeaderModal({
  kind,
  username,
  piLinked,
  onClose,
  onLinkPi,
  onUnlinkPi,
}: {
  kind: 'activity' | 'account'
  username: string
  piLinked: boolean
  onClose: () => void
  onLinkPi: () => void
  onUnlinkPi: () => void
}) {
  const isActivity = kind === 'activity'
  const [linking, setLinking] = useState(false)
  const [unlinkConfirm, setUnlinkConfirm] = useState(false)
  const showLinked = piLinked
  const connect = () => {
    if (linking || piLinked) return
    setLinking(true)
    window.setTimeout(() => {
      onLinkPi()
      setLinking(false)
    }, 900)
  }
  const unlink = () => {
    onUnlinkPi()
    setUnlinkConfirm(false)
  }
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-[#1e293b]/35 px-4 pt-24" onClick={onClose}>
      <section className="w-full max-w-md rounded-[28px] border-2 border-[#CBD5E1] bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold text-[#4A82B8]">{isActivity ? 'ACTIVITY' : 'PI ACCOUNT'}</p>
            <h2 className="mt-1 text-xl font-bold text-[#0F172A]">{isActivity ? '시간별 활동 기록' : '파이 계정 연동'}</h2>
          </div>
          <button onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#64748B]" aria-label="닫기">
            <X className="h-5 w-5" />
          </button>
        </div>
        {isActivity ? (
          <div className="mt-5 space-y-3">
            {[['14:00', '택시 결제 완료', '2.1 Pi'], ['12:00', 'Pi 충전 완료', '+10 Pi'], ['09:20', '기사님 호출 요청', '서울시청 → 강남역']].map(([time, label, detail]) => (
              <div key={time} className="flex gap-3 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                <span className="font-mono text-xs font-bold text-[#4A82B8]">{time}</span>
                <div>
                  <p className="text-sm font-bold text-[#0F172A]">{label}</p>
                  <p className="mt-1 text-xs font-medium text-[#64748B]">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        ) : showLinked ? (
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-3 rounded-2xl border-2 border-[#CBD5E1] bg-[#F8FAFC] p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E8F1FA] text-[#4A82B8]">
                <UserRound className="h-6 w-6" />
              </div>
              <div>
                <p className="font-bold text-[#0F172A]">{username}</p>
                <p className="text-xs font-medium text-[#64748B]">Pi Pioneer · 회원가입 완료</p>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-2xl border-2 border-[#A7F3D0] bg-[#ECFDF5] p-4">
              <div>
                <p className="text-base font-bold text-[#0F172A]">Pi Network 계정 연동됨</p>
                <p className="mt-1 text-xs font-medium text-[#047857]">안전하게 인증된 계정입니다.</p>
              </div>
              <span className="h-3 w-3 rounded-full bg-[#10B981]" />
            </div>
            <p className="px-1 text-sm font-semibold leading-6 text-[#B91C1C]">Pi 계정 연동을 해제하면 회원 탈퇴 처리됩니다.</p>
            {unlinkConfirm ? (
              <div className="rounded-2xl border-2 border-[#FECACA] bg-[#FEF2F2] p-4">
                <p className="text-sm font-bold text-[#0F172A]">연동을 해제하고 탈퇴할까요?</p>
                <p className="mt-1 text-xs font-medium leading-5 text-[#64748B]">비회원 상태로 돌아가며, 기사/파트너 권한도 함께 해제됩니다.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setUnlinkConfirm(false)} className="rounded-2xl border-2 border-[#CBD5E1] bg-white py-3 text-sm font-bold text-[#334155]">
                    취소
                  </button>
                  <button type="button" onClick={unlink} className="rounded-2xl bg-[#B91C1C] py-3 text-sm font-bold text-white">
                    탈퇴하기
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setUnlinkConfirm(true)}
                className="flex min-h-12 w-full items-center justify-center rounded-2xl border-2 border-[#FECACA] bg-[#FEF2F2] px-3 py-3.5 text-sm font-bold text-[#B91C1C] transition hover:bg-[#FEE2E2] active:scale-[0.99]"
              >
                Pi 계정 연동 해제 (회원탈퇴)
              </button>
            )}
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4">
              <p className="text-lg font-bold leading-snug text-[#0F172A]">Pi 계정과 연동하시겠습니까?</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#334155]">연동을 시키면 바로 회원가입이 완료됩니다.</p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E8F1FA] text-[#4A82B8]">
                <UserRound className="h-6 w-6" />
              </div>
              <div>
                <p className="font-bold text-[#0F172A]">{username}</p>
                <p className="text-xs font-medium text-[#64748B]">Pi Pioneer · 미연동</p>
              </div>
            </div>
            <button
              type="button"
              onClick={connect}
              disabled={linking}
              className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#4A82B8] py-3.5 text-base font-bold text-white shadow-[0_10px_22px_rgba(74,130,184,0.28)] transition hover:bg-[#3F74A8] disabled:opacity-70"
            >
              {linking ? '연동 중…' : 'Pi 계정 연동하기'}
            </button>
            <button type="button" onClick={onClose} className="w-full py-2 text-sm font-bold text-[#64748B]">
              나중에
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

function PartnerSignupModal({ onClose, onDone, onRegistered }: { onClose: () => void; onDone: (message: string) => void; onRegistered: (role: '기사' | '파트너') => void }) {
  const [role, setRole] = useState<'기사' | '파트너'>('기사')
  const [serviceType, setServiceType] = useState<'택시' | '대리운전' | '택배'>('택시')
  const [facilityType, setFacilityType] = useState<'주차' | '자전거' | '킥보드' | 'EV 충전'>('주차')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [detail, setDetail] = useState('')
  const [region, setRegion] = useState('서울')
  const [photo, setPhoto] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)
  const skipVehicle = role === '기사' && serviceType === '대리운전'
  const canSubmit = name.trim() && phone.trim() && (skipVehicle || detail.trim())
  const submit = () => {
    if (!canSubmit) return
    setSubmitted(true)
    onRegistered(role)
    window.setTimeout(() => {
      onDone(`${role} 등록이 완료되었어요. 기사 모드로 전환합니다.`)
      onClose()
    }, 1400)
  }
  const onPhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setPhoto(typeof reader.result === 'string' ? reader.result : null)
    reader.readAsDataURL(file)
  }
  return (
    <div className="fixed inset-0 z-[94] flex items-end bg-[#1e1033]/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-white p-5 shadow-2xl sm:rounded-[32px]" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
        {submitted ? (
          <div className="py-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#4C1FB8] text-white">
              <Check className="h-8 w-8" strokeWidth={3} />
            </div>
            <h2 className="mt-4 text-2xl font-black text-[#0F172A]">등록이 완료되었습니다</h2>
            <p className="mt-2 text-sm font-bold text-[#475569]">기사/파트너 권한이 활성화되었어요. 대시보드로 이동합니다.</p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-black text-[#4C1FB8]">PARTNER SIGNUP</p>
                <h2 className="mt-1 text-2xl font-black text-[#0F172A]">기사/파트너 회원가입</h2>
                <p className="mt-1 text-sm font-bold text-[#64748B]">기사 또는 가맹점/업체로 등록해 주세요.</p>
              </div>
              <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="닫기">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-[#F8F5FF] p-1">
              {(['기사', '파트너'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRole(item)}
                  className={`rounded-xl py-2.5 text-xs font-black ${role === item ? 'bg-[#4C1FB8] text-white shadow-[0_8px_16px_rgba(76,31,184,0.28)]' : 'text-[#64748B]'}`}
                >
                  {item === '파트너' ? '파트너(가맹점/업체)' : '기사 등록'}
                </button>
              ))}
            </div>
            {role === '기사' ? (
              <div className="mt-4">
                <p className="text-xs font-black text-[#334155]">서비스 항목 선택</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(['택시', '대리운전', '택배'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setServiceType(item)}
                      className={`rounded-2xl border-2 py-3 text-xs font-black ${serviceType === item ? 'border-[#4C1FB8] bg-[#4C1FB8] text-white' : 'border-[#E0D4FF] bg-[#F8F5FF] text-[#4C1FB8]'}`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <label className="mt-4 block">
              <span className="text-xs font-black text-[#334155]">{role === '기사' ? '기사 성함' : '대표자 성함'}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="홍길동" className="mt-2 w-full rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] px-4 py-3 text-sm font-bold outline-none focus:border-[#4C1FB8]" />
            </label>
            {role === '기사' ? (
              <div className="mt-3">
                <p className="text-xs font-black text-[#334155]">등록자 사진</p>
                <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
                <button
                  type="button"
                  onClick={() => photoInput.current?.click()}
                  className="mt-2 flex w-full items-center gap-3 rounded-[22px] border-2 border-dashed border-[#4C1FB8] bg-[#F8F5FF] px-4 py-3 text-left"
                >
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white text-[#4C1FB8] shadow-[0_6px_14px_rgba(76,31,184,0.12)]">
                    {photo ? <img src={photo} alt="등록자 사진" className="h-full w-full object-cover" /> : <Camera className="h-6 w-6" />}
                  </span>
                  <span>
                    <strong className="block text-sm font-black text-[#0F172A]">{photo ? '사진이 등록되었습니다' : '본인 얼굴 / 프로필 등록'}</strong>
                    <span className="mt-1 block text-xs font-bold text-[#64748B]">{photo ? '탭하여 다른 사진으로 변경' : '신분증과 대조할 수 있는 사진을 올려 주세요'}</span>
                  </span>
                </button>
              </div>
            ) : (
              <div className="mt-4">
                <p className="text-xs font-black text-[#334155]">등록 서비스(시설) 선택</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(['주차', '자전거', '킥보드', 'EV 충전'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setFacilityType(item)}
                      className={`rounded-2xl border-2 py-3 text-xs font-black ${facilityType === item ? 'border-[#4C1FB8] bg-[#4C1FB8] text-white shadow-[0_8px_16px_rgba(76,31,184,0.22)]' : 'border-[#E0D4FF] bg-[#F8F5FF] text-[#4C1FB8]'}`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="mt-3 block">
              <span className="text-xs font-black text-[#334155]">연락처</span>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="010-0000-0000" className="mt-2 w-full rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] px-4 py-3 text-sm font-bold outline-none focus:border-[#4C1FB8]" />
            </label>
            <label className="mt-3 block">
              <span className="text-xs font-black text-[#334155]">{role === '기사' ? '차량 정보' : '업체/가맹점명'}</span>
              <input
                value={skipVehicle ? '' : detail}
                onChange={(event) => setDetail(event.target.value)}
                disabled={skipVehicle}
                placeholder={skipVehicle ? '대리운전은 차량 정보 입력 제외' : role === '기사' ? '현대 아슬란 · 서울 31바 1842' : '파이 모빌리티 강남점'}
                className={`mt-2 w-full rounded-2xl border-2 px-4 py-3 text-sm font-bold outline-none ${skipVehicle ? 'cursor-not-allowed border-[#E2E8F0] bg-[#F1F5F9] text-[#94A3B8] placeholder:text-[#94A3B8]' : 'border-[#E0D4FF] bg-[#F8F5FF] focus:border-[#4C1FB8]'}`}
              />
              {skipVehicle ? <p className="mt-1.5 text-[11px] font-bold text-[#8b8495]">* 대리운전은 차량 정보 입력 제외</p> : null}
            </label>
            <label className="mt-3 block">
              <span className="text-xs font-black text-[#334155]">활동 지역</span>
              <input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="서울" className="mt-2 w-full rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] px-4 py-3 text-sm font-bold outline-none focus:border-[#4C1FB8]" />
            </label>
            <button type="button" onClick={submit} disabled={!canSubmit} className="mt-5 w-full rounded-2xl bg-[#4C1FB8] py-3.5 font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.35)] disabled:cursor-not-allowed disabled:opacity-40">
              회원가입 완료
            </button>
          </>
        )}
      </section>
    </div>
  )
}

const PARTNER_REVENUE = {
  daily: [
    { period: '2026-09-17 (목)', count: 8, amount: 45.2, note: '오늘' },
    { period: '2026-09-16 (수)', count: 6, amount: 32.8, note: '완료' },
    { period: '2026-09-15 (화)', count: 9, amount: 51.4, note: '완료' },
    { period: '2026-09-14 (월)', count: 7, amount: 38.6, note: '완료' },
    { period: '2026-09-13 (일)', count: 5, amount: 24.1, note: '완료' },
    { period: '2026-09-12 (토)', count: 11, amount: 62.7, note: '완료' },
    { period: '2026-09-11 (금)', count: 8, amount: 44.0, note: '완료' },
  ],
  monthly: [
    { period: '2026-09', count: 54, amount: 298.8, note: '진행 중' },
    { period: '2026-08', count: 121, amount: 642.5, note: '마감' },
    { period: '2026-07', count: 108, amount: 571.3, note: '마감' },
    { period: '2026-06', count: 96, amount: 498.0, note: '마감' },
  ],
  yearly: [
    { period: '2026', count: 379, amount: 2010.6, note: '진행 중' },
    { period: '2025', count: 1284, amount: 6842.1, note: '마감' },
    { period: '2024', count: 906, amount: 4711.4, note: '마감' },
  ],
  total: [
    { period: '누적 합계', count: 2569, amount: 13564.1, note: '전체' },
  ],
}

const PARTNER_TRIPS = {
  daily: [
    { period: '2026-09-17 (목)', trips: 8, done: 8, cancel: 0, note: '오늘' },
    { period: '2026-09-16 (수)', trips: 7, done: 6, cancel: 1, note: '완료' },
    { period: '2026-09-15 (화)', trips: 10, done: 9, cancel: 1, note: '완료' },
    { period: '2026-09-14 (월)', trips: 7, done: 7, cancel: 0, note: '완료' },
    { period: '2026-09-13 (일)', trips: 6, done: 5, cancel: 1, note: '완료' },
    { period: '2026-09-12 (토)', trips: 12, done: 11, cancel: 1, note: '완료' },
    { period: '2026-09-11 (금)', trips: 8, done: 8, cancel: 0, note: '완료' },
  ],
  monthly: [
    { period: '2026-09', trips: 58, done: 54, cancel: 4, note: '진행 중' },
    { period: '2026-08', trips: 129, done: 121, cancel: 8, note: '마감' },
    { period: '2026-07', trips: 116, done: 108, cancel: 8, note: '마감' },
    { period: '2026-06', trips: 103, done: 96, cancel: 7, note: '마감' },
  ],
  yearly: [
    { period: '2026', trips: 406, done: 379, cancel: 27, note: '진행 중' },
    { period: '2025', trips: 1361, done: 1284, cancel: 77, note: '마감' },
    { period: '2024', trips: 972, done: 906, cancel: 66, note: '마감' },
  ],
}

const PARTNER_ROUTES = [
  { from: '서울시청', to: '강남역', fare: 6.4, service: '택시' },
  { from: '홍대입구', to: '합정', fare: 3.2, service: '택시' },
  { from: '잠실역', to: '송파나루', fare: 4.8, service: '대리' },
  { from: '여의도', to: '공덕', fare: 5.1, service: '택시' },
  { from: '성수', to: '건대입구', fare: 3.6, service: '택시' },
  { from: '사당역', to: '이수', fare: 2.9, service: '대리' },
  { from: '선릉', to: '삼성역', fare: 4.1, service: '택시' },
  { from: '망원', to: '상수', fare: 3.8, service: '대리' },
  { from: '수원역', to: '영통', fare: 7.2, service: '택시' },
  { from: '판교', to: '정자', fare: 5.6, service: '택시' },
]

function partnerRowDetails(period: string, count: number, cancelCount = 0) {
  const size = Math.min(Math.max(count, 1), 8)
  return Array.from({ length: size }, (_, index) => {
    const route = PARTNER_ROUTES[(period.length + index * 3) % PARTNER_ROUTES.length]
    const canceled = index < cancelCount
    const hour = 7 + ((index * 2) % 14)
    const minute = (index * 13) % 60
    return {
      id: `${period}-${index}`,
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      from: route.from,
      to: route.to,
      fare: canceled ? 0 : route.fare,
      service: route.service,
      status: canceled ? '취소' : '완료',
    }
  })
}

function PartnerStatSheet({ kind, onClose }: { kind: 'revenue' | 'trips'; onClose: () => void }) {
  const isRevenue = kind === 'revenue'
  const tabs = isRevenue
    ? [
        { id: 'daily' as const, label: '일일 수익' },
        { id: 'monthly' as const, label: '월별 수익' },
        { id: 'yearly' as const, label: '년도별 수익' },
        { id: 'total' as const, label: '총 수익' },
      ]
    : [
        { id: 'daily' as const, label: '일별 운행' },
        { id: 'monthly' as const, label: '월별 운행' },
        { id: 'yearly' as const, label: '년도별 운행' },
      ]
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('daily')
  const [openedRow, setOpenedRow] = useState<{ period: string; count: number; cancel: number; amount?: number } | null>(null)
  const revenueRows = PARTNER_REVENUE[tab === 'total' ? 'total' : tab === 'monthly' ? 'monthly' : tab === 'yearly' ? 'yearly' : 'daily']
  const tripRows = PARTNER_TRIPS[tab === 'monthly' ? 'monthly' : tab === 'yearly' ? 'yearly' : 'daily']
  const revenueSum = revenueRows.reduce((sum, row) => sum + row.amount, 0)
  const tripSum = tripRows.reduce((sum, row) => ({ trips: sum.trips + row.trips, done: sum.done + row.done, cancel: sum.cancel + row.cancel }), { trips: 0, done: 0, cancel: 0 })
  const accent = isRevenue
    ? { ink: 'text-[#0F766E]', inkSoft: 'text-[#0D9488]', chipOn: 'bg-[#0F766E] text-white shadow-[0_6px_14px_rgba(15,118,110,0.28)]', chipOff: 'bg-[#F0FDFA] text-[#0F766E]', head: 'bg-[#0F766E]', border: 'border-[#99F6E4]', zebra: 'bg-[#F0FDFA]', hover: 'hover:bg-[#CCFBF1] active:bg-[#99F6E4]', total: 'bg-[#CCFBF1] text-[#115E59]', amount: 'text-[#0F766E]' }
    : { ink: 'text-[#0369A1]', inkSoft: 'text-[#0284C7]', chipOn: 'bg-[#0369A1] text-white shadow-[0_6px_14px_rgba(3,105,161,0.28)]', chipOff: 'bg-[#F0F9FF] text-[#0369A1]', head: 'bg-[#0E7490]', border: 'border-[#A5F3FC]', zebra: 'bg-[#F0F9FF]', hover: 'hover:bg-[#E0F2FE] active:bg-[#BAE6FD]', total: 'bg-[#E0F2FE] text-[#075985]', amount: 'text-[#0369A1]' }
  const details = openedRow ? partnerRowDetails(openedRow.period, openedRow.count, openedRow.cancel) : []
  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-slate-900/45 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-[32px] bg-white shadow-2xl sm:rounded-[32px]" onClick={(event) => event.stopPropagation()}>
        <div className="px-5 pt-4">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className={`flex items-center gap-1.5 text-xs font-black ${accent.ink}`}>
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {isRevenue ? '수익 상세 내역' : '운행 횟수 상세 내역'}
              </p>
              <h2 className="mt-1 text-xl font-black text-slate-900">{isRevenue ? '엑셀 시트 · 수익 통계' : '엑셀 시트 · 운행 통계'}</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-full bg-slate-100 p-2 text-slate-600" aria-label="통계 닫기">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black ${tab === item.id ? accent.chipOn : accent.chipOff}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-auto px-5 pb-6">
          <div className={`overflow-hidden rounded-[18px] border-2 ${accent.border}`}>
            <table className="w-full min-w-[320px] border-collapse text-left text-[11px]">
              <thead>
                <tr className={`${accent.head} text-white`}>
                  <th className="px-3 py-2.5 font-black">기간</th>
                  {isRevenue ? (
                    <>
                      <th className="px-3 py-2.5 font-black">건수</th>
                      <th className="px-3 py-2.5 font-black">수익(Pi)</th>
                      <th className="px-3 py-2.5 font-black">상태</th>
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-2.5 font-black">운행 횟수</th>
                      <th className="px-3 py-2.5 font-black">완료</th>
                      <th className="px-3 py-2.5 font-black">취소</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {isRevenue
                  ? revenueRows.map((row, index) => (
                      <tr
                        key={row.period}
                        role="button"
                        tabIndex={0}
                        onClick={() => setOpenedRow({ period: row.period, count: row.count, cancel: 0, amount: row.amount })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') setOpenedRow({ period: row.period, count: row.count, cancel: 0, amount: row.amount })
                        }}
                        className={`cursor-pointer border-t border-slate-100 transition ${index % 2 === 0 ? 'bg-white' : accent.zebra} ${accent.hover}`}
                      >
                        <td className="px-3 py-2.5 font-black text-slate-900">{row.period}</td>
                        <td className="px-3 py-2.5 font-bold text-slate-600">{row.count.toLocaleString()}건</td>
                        <td className={`px-3 py-2.5 font-black ${accent.amount}`}>{row.amount.toFixed(1)}</td>
                        <td className="px-3 py-2.5 font-bold text-slate-500">{row.note}</td>
                      </tr>
                    ))
                  : tripRows.map((row, index) => (
                      <tr
                        key={row.period}
                        role="button"
                        tabIndex={0}
                        onClick={() => setOpenedRow({ period: row.period, count: row.trips, cancel: row.cancel })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') setOpenedRow({ period: row.period, count: row.trips, cancel: row.cancel })
                        }}
                        className={`cursor-pointer border-t border-slate-100 transition ${index % 2 === 0 ? 'bg-white' : accent.zebra} ${accent.hover}`}
                      >
                        <td className="px-3 py-2.5 font-black text-slate-900">{row.period}</td>
                        <td className={`px-3 py-2.5 font-black ${accent.amount}`}>{row.trips.toLocaleString()}회</td>
                        <td className="px-3 py-2.5 font-bold text-slate-600">{row.done.toLocaleString()}건</td>
                        <td className="px-3 py-2.5 font-bold text-slate-500">{row.cancel.toLocaleString()}건</td>
                      </tr>
                    ))}
                <tr className={accent.total}>
                  {isRevenue ? (
                    <>
                      <td className="px-3 py-2.5 font-black">합계</td>
                      <td className="px-3 py-2.5 font-black">{revenueRows.reduce((sum, row) => sum + row.count, 0).toLocaleString()}건</td>
                      <td className="px-3 py-2.5 font-black">{revenueSum.toFixed(1)}</td>
                      <td className="px-3 py-2.5 font-black">Pi</td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2.5 font-black">합계</td>
                      <td className="px-3 py-2.5 font-black">{tripSum.trips.toLocaleString()}회</td>
                      <td className="px-3 py-2.5 font-black">{tripSum.done.toLocaleString()}건</td>
                      <td className="px-3 py-2.5 font-black">{tripSum.cancel.toLocaleString()}건</td>
                    </>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-center text-[10px] font-bold text-slate-400">행을 선택하면 해당 기간의 세부 운행 내역을 볼 수 있어요</p>
        </div>
      </section>
      {openedRow ? (
        <div className="absolute inset-0 z-10 flex items-end bg-slate-900/40 sm:items-center sm:p-6" onClick={() => setOpenedRow(null)}>
          <section className="mx-auto max-h-[82vh] w-full max-w-sm overflow-y-auto rounded-t-[28px] bg-white p-5 shadow-2xl sm:rounded-[28px]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-xs font-black ${accent.inkSoft}`}>{isRevenue ? '수익 세부 내역' : '운행 세부 내역'}</p>
                <h3 className="mt-1 text-lg font-black text-slate-900">{openedRow.period}</h3>
                {openedRow.amount != null ? <p className={`mt-1 text-sm font-black ${accent.amount}`}>합계 {openedRow.amount.toFixed(1)} Pi</p> : null}
              </div>
              <button type="button" onClick={() => setOpenedRow(null)} className="rounded-full bg-slate-100 p-2 text-slate-600" aria-label="세부 내역 닫기">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ul className="mt-4 space-y-2">
              {details.map((item) => (
                <li key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold text-slate-500">{item.time} · {item.service}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${item.status === '완료' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>{item.status}</span>
                  </div>
                  <p className="mt-1.5 text-sm font-black text-slate-900">{item.from} → {item.to}</p>
                  {isRevenue ? (
                    <p className={`mt-1 text-xs font-black ${accent.amount}`}>{item.status === '완료' ? `+${item.fare.toFixed(1)} Pi` : '정산 없음'}</p>
                  ) : (
                    <p className="mt-1 text-xs font-bold text-slate-500">{item.status === '완료' ? '운행 완료' : '호출 취소'} · {item.fare ? `${item.fare.toFixed(1)} Pi` : '요금 없음'}</p>
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

function DriverNeedSignupModal({ onClose, onSignup }: { onClose: () => void; onSignup: () => void }) {
  return (
    <div className="fixed inset-0 z-[94] flex items-end bg-[#1e1033]/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto w-full max-w-md rounded-t-[32px] bg-white p-5 shadow-2xl sm:rounded-[32px]" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
        <p className="text-xs font-bold text-[#4A82B8]">기사/파트너 모드</p>
        <h2 className="mt-1 text-2xl font-bold text-[#0F172A]">먼저 회원가입이 필요해요</h2>
        <p className="mt-2 text-sm font-medium leading-6 text-[#475569]">
          등록을 마치면 콜 수락과 파트너 대시보드를 바로 이용할 수 있어요.
        </p>
        <button
          type="button"
          onClick={onSignup}
          className="mt-5 w-full rounded-2xl bg-[#4A82B8] py-3.5 text-base font-bold text-white shadow-[0_10px_22px_rgba(74,130,184,0.28)]"
        >
          회원가입 하러 가기
        </button>
        <button type="button" onClick={onClose} className="mt-2 w-full rounded-2xl py-3 text-sm font-bold text-[#64748B]">
          나중에
        </button>
      </section>
    </div>
  )
}

function DriverDashboard({ online, onToggleOnline, onPassengerMode, onWithdraw, onNotice }: { online: boolean; onToggleOnline: () => void; onPassengerMode: () => void; onWithdraw: () => void; onNotice: (message: string) => void }) {
  const [requestVisible, setRequestVisible] = useState(true)
  const [statSheet, setStatSheet] = useState<'revenue' | 'trips' | null>(null)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  return (
    <main className="flex-1 overflow-y-auto px-4 pb-28 pt-4">
      <section className="rounded-[28px] bg-[#243044] p-5 text-white shadow-[0_14px_32px_rgba(15,23,42,0.16)]">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold text-[#93C5FD]">기사/파트너 모드</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">오늘도 안전 운행하세요</h2>
            <p className="mt-2 text-xs font-medium text-[#CBD5E1]">근처 호출 요청을 실시간으로 확인하세요</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${online ? 'bg-[#D1FAE5] text-[#047857]' : 'bg-white/10 text-[#CBD5E1]'}`}>{online ? '영업 중' : '영업 종료'}</span>
        </div>
        <button onClick={onToggleOnline} className={`mt-5 flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left ${online ? 'bg-[#4A82B8]' : 'bg-white/10'}`}>
          <span>
            <span className="block text-xs font-medium text-white/70">운행 상태</span>
            <strong className="text-base font-bold">{online ? '영업 중 (Online)' : '영업 종료 (Offline)'}</strong>
          </span>
          <span className={`relative h-7 w-12 rounded-full p-1 transition ${online ? 'bg-white/25' : 'bg-black/20'}`}>
            <span className={`block h-5 w-5 rounded-full bg-white transition ${online ? 'translate-x-5' : ''}`} />
          </span>
        </button>
      </section>
      <section className="mt-4 grid grid-cols-3 gap-2.5">
        <button type="button" onClick={() => setStatSheet('revenue')} className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-3 text-left shadow-[0_6px_18px_rgba(15,23,42,0.08)] transition active:scale-[0.98]">
          <p className="text-[10px] font-semibold text-[#64748B]">오늘의 수익</p>
          <p className="mt-2 text-lg font-bold text-[#0F766E]">45.2 Pi</p>
          <p className="mt-1 text-[10px] font-bold text-[#0D9488]">상세 보기 ›</p>
        </button>
        <button type="button" onClick={() => setStatSheet('trips')} className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-3 text-left shadow-[0_6px_18px_rgba(15,23,42,0.08)] transition active:scale-[0.98]">
          <p className="text-[10px] font-semibold text-[#64748B]">8건 운행</p>
          <p className="mt-2 text-lg font-bold text-[#0F172A]">8건</p>
          <p className="mt-1 text-[10px] font-bold text-[#0369A1]">상세 보기 ›</p>
        </button>
        <div className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-3 shadow-[0_6px_18px_rgba(15,23,42,0.08)]">
          <p className="text-[10px] font-semibold text-[#64748B]">기사 평점</p>
          <p className="mt-2 text-lg font-bold text-[#0F172A]">4.9</p>
        </div>
      </section>
      {online && requestVisible ? (
        <section className="mt-4 rounded-[26px] border-2 border-[#BFDBFE] bg-[#F8FAFC] p-5 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-[#4A82B8]">새로운 운행 요청</p>
            <span className="animate-pulse rounded-full bg-[#4A82B8] px-2 py-1 text-[10px] font-bold text-white">방금 도착</span>
          </div>
          <p className="mt-3 text-lg font-bold text-[#0F172A]">서울시청 → 강남역</p>
          <div className="mt-2 flex justify-between text-sm font-semibold text-[#475569]">
            <span>승객까지 1.2 km</span>
            <strong className="text-[#0F172A]">3.4 Pi</strong>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                setRequestVisible(false)
                onNotice('운행 요청을 수락했어요.')
              }}
              className="rounded-2xl bg-[#4A82B8] py-3.5 font-bold text-white"
            >
              수락
            </button>
            <button
              onClick={() => {
                setRequestVisible(false)
                onNotice('요청을 거절했어요.')
              }}
              className="rounded-2xl border-2 border-[#CBD5E1] bg-white py-3.5 font-bold text-[#475569]"
            >
              거절
            </button>
          </div>
        </section>
      ) : (
        <section className="mt-4 rounded-[26px] border-2 border-[#CBD5E1] bg-white p-5 text-center shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
          <p className="font-bold text-[#0F172A]">{online ? '새로운 요청을 기다리는 중이에요' : '영업을 시작하면 요청을 받을 수 있어요'}</p>
          <p className="mt-1 text-xs font-medium text-[#64748B]">주변 승객의 호출이 이곳에 표시됩니다.</p>
        </section>
      )}
      <button onClick={onPassengerMode} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-[#CBD5E1] bg-white py-3.5 font-bold text-[#334155] shadow-sm">
        승객 모드로 돌아가기
      </button>
      <section className="mt-4 rounded-[26px] border-2 border-[#CBD5E1] bg-white p-5 shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
        <p className="text-xs font-bold text-[#4A82B8]">계정 설정</p>
        <h3 className="mt-1 text-base font-bold text-[#0F172A]">기사/파트너 권한</h3>
        <p className="mt-1.5 text-sm font-medium leading-6 text-[#64748B]">탈퇴하면 콜 수락과 파트너 대시보드를 이용할 수 없으며, 다시 이용하려면 회원가입이 필요해요.</p>
        <button
          type="button"
          onClick={() => setWithdrawOpen(true)}
          className="mt-4 w-full rounded-2xl border-2 border-[#FECACA] bg-[#FEF2F2] py-3.5 font-bold text-[#B91C1C] transition hover:bg-[#FEE2E2] active:scale-[0.99]"
        >
          회원탈퇴
        </button>
      </section>
      {withdrawOpen ? (
        <div className="fixed inset-0 z-[94] flex items-end bg-[#1e1033]/50 p-0 sm:items-center sm:p-4" onClick={() => setWithdrawOpen(false)}>
          <section className="mx-auto w-full max-w-md rounded-t-[32px] bg-white p-5 shadow-2xl sm:rounded-[32px]" onClick={(event) => event.stopPropagation()}>
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
            <p className="text-xs font-bold text-[#B91C1C]">기사 권한 해제</p>
            <h2 className="mt-1 text-2xl font-bold text-[#0F172A]">기사/파트너를 탈퇴할까요?</h2>
            <p className="mt-2 text-sm font-medium leading-6 text-[#475569]">권한이 해제되고 일반 승객 화면으로 돌아갑니다. 언제든 다시 가입할 수 있어요.</p>
            <button
              type="button"
              onClick={() => {
                setWithdrawOpen(false)
                onWithdraw()
              }}
              className="mt-5 w-full rounded-2xl bg-[#B91C1C] py-3.5 text-base font-bold text-white shadow-[0_10px_22px_rgba(185,28,28,0.22)]"
            >
              탈퇴하기
            </button>
            <button type="button" onClick={() => setWithdrawOpen(false)} className="mt-2 w-full rounded-2xl py-3 text-sm font-bold text-[#64748B]">
              취소
            </button>
          </section>
        </div>
      ) : null}
      {statSheet ? <PartnerStatSheet kind={statSheet} onClose={() => setStatSheet(null)} /> : null}
    </main>
  )
}

export default function HomeScreen() {
  const user = LOCAL_TEST_USER
  const [driverMode, setDriverMode] = useState(false)
  const [driverOnline, setDriverOnline] = useState(true)
  const [tab, setTab] = useState('홈')
  const [destination, setDestination] = useState('')
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [daeriSetupOpen, setDaeriSetupOpen] = useState(false)
  const [daeriTrip, setDaeriTrip] = useState<{ pickup: string; dest: string; plan: string; fare: number } | null>(null)
  const [notice, setNotice] = useState('')
  const [walletBalance, setWalletBalance] = useState(18.4)
  const [walletOpen, setWalletOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [fullscreenMapOpen, setFullscreenMapOpen] = useState(false)
  const [pickup, setPickup] = useState<PickupPlace | null>(null)
  const pickupRef = useRef<PickupPlace | null>(null)
  const [gps, setGps] = useState<GpsFix>({
    status: 'pending',
    address: '현재 위치를 확인하는 중',
    lat: SEOUL_CITY_HALL.lat,
    lng: SEOUL_CITY_HALL.lng,
  })
  const [chargePromptOpen, setChargePromptOpen] = useState(false)
  const [walletReady, setWalletReady] = useState(false)
  const [headerModal, setHeaderModal] = useState<'activity' | 'account' | null>(null)
  const [partnerSignupOpen, setPartnerSignupOpen] = useState(false)
  const [driverGateOpen, setDriverGateOpen] = useState(false)
  const [isDriverRegistered, setIsDriverRegistered] = useState(false)
  const [isPartnerRegistered, setIsPartnerRegistered] = useState(false)
  const [isPiLinked, setIsPiLinked] = useState(false)
  const [receiptRide, setReceiptRide] = useState<RideReceipt | null>(null)
  const [inboxItem, setInboxItem] = useState<Notice | null>(null)
  const [readNoticeIds, setReadNoticeIds] = useState<string[]>([])
  const [paymentDone, setPaymentDone] = useState<{ amount: number; place: string; remaining: number; estimated?: number; paymentId: string; txid: string } | null>(null)
  const [driverReview, setDriverReview] = useState<{ name: string; vehicle: string; plate: string; kind?: 'driver' | 'service' } | null>(null)
  const [transactions, setTransactions] = useState<PiTransaction[]>(DEFAULT_PI_TX)

  const showNotice = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  const applyPickup = (place: PickupPlace) => {
    pickupRef.current = place
    setPickup(place)
    writePickupPlace(place)
  }

  useEffect(() => {
    const stored = readPiWallet()
    setWalletBalance(stored.balance)
    setTransactions(stored.transactions)
    setReadNoticeIds(loadReadNoticeIds())
    setIsDriverRegistered(loadIsDriverRegistered())
    setIsPartnerRegistered(loadIsPartnerRegistered())
    setIsPiLinked(loadIsPiLinked())
    setWalletReady(true)
    const storedPickup = readPickupPlace()
    if (storedPickup) {
      pickupRef.current = storedPickup
      setPickup(storedPickup)
    }
  }, [])

  useEffect(() => {
    if (!navigator.geolocation) {
      if (pickupRef.current?.source === 'map') return
      const fallback = {
        status: 'denied' as const,
        address: virtualPickupAddress(SEOUL_CITY_HALL.lat, SEOUL_CITY_HALL.lng),
        lat: SEOUL_CITY_HALL.lat,
        lng: SEOUL_CITY_HALL.lng,
      }
      setGps(fallback)
      applyPickup({ address: fallback.address, lat: fallback.lat, lng: fallback.lng, source: 'gps' })
      return
    }
    const timer = window.setTimeout(() => {
      if (pickupRef.current?.source === 'map') return
      setGps((current) =>
        current.status === 'pending'
          ? {
              status: 'denied',
              address: virtualPickupAddress(SEOUL_CITY_HALL.lat, SEOUL_CITY_HALL.lng),
              lat: SEOUL_CITY_HALL.lat,
              lng: SEOUL_CITY_HALL.lng,
            }
          : current,
      )
    }, 6000)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timer)
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        const address = virtualPickupAddress(lat, lng)
        if (pickupRef.current?.source === 'map') return
        setGps({ status: 'ready', address, lat, lng })
        applyPickup({ address, lat, lng, source: 'gps' })
      },
      () => {
        window.clearTimeout(timer)
        if (pickupRef.current?.source === 'map') return
        const fallback = {
          status: 'denied' as const,
          address: virtualPickupAddress(SEOUL_CITY_HALL.lat, SEOUL_CITY_HALL.lng),
          lat: SEOUL_CITY_HALL.lat,
          lng: SEOUL_CITY_HALL.lng,
        }
        setGps(fallback)
        applyPickup({ address: fallback.address, lat: fallback.lat, lng: fallback.lng, source: 'gps' })
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60_000 },
    )
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!walletReady) return
    writePiWallet(walletBalance, transactions)
  }, [walletReady, walletBalance, transactions])

  const origin: PickupPlace = pickup ?? {
    address: gps.address,
    lat: gps.lat,
    lng: gps.lng,
    source: 'gps',
  }
  const originGps: GpsFix = {
    status: pickup?.source === 'map' ? 'ready' : gps.status,
    address: origin.address,
    lat: origin.lat,
    lng: origin.lng,
  }
  const unreadNoticeCount = notices.filter((item) => !readNoticeIds.includes(item.id)).length
  const openWallet = () => setWalletOpen(true)
  const showChargePrompt = () => setChargePromptOpen(true)
  const confirmChargePrompt = () => {
    setChargePromptOpen(false)
    setWalletOpen(true)
  }
  const openInbox = (item: Notice) => {
    setInboxItem(item)
    setReadNoticeIds((ids) => {
      if (ids.includes(item.id)) return ids
      const next = [...ids, item.id]
      saveReadNoticeIds(next)
      return next
    })
  }
  const settlePiLedger = (
    amount: number,
    place: string,
    label: string,
    estimated: number | undefined,
    proof: { paymentId: string; txid: string },
  ) => {
    if (!proof.paymentId || !proof.txid) {
      console.error('[Pi] blocked local receipt without Pi payment proof')
      showNotice('파이 지갑 승인이 완료되어야 영수증으로 넘어갑니다.')
      return
    }
    const remaining = Math.round((walletBalance - amount) * 100) / 100
    const at = formatPiTime()
    setWalletBalance(Math.max(0, remaining))
    setTransactions((items) => [{ label, amount: -amount, detail: `${place} · ${at}`, place, at, estimated }, ...items])
    setPaymentDone({ amount, place, remaining: Math.max(0, remaining), estimated, paymentId: proof.paymentId, txid: proof.txid })
  }
  const payWithPi = async (amount: number, place: string, label: string, estimated?: number) => {
    try {
      const proof = await startPiCheckout({
        amount,
        memo: `${label} ${amount} Pi`,
        metadata: { kind: 'service-pay', place, label },
      })
      settlePiLedger(amount, place, label, estimated, proof)
      return true
    } catch (error) {
      showNotice(describePiUserMessage(error))
      return false
    }
  }
  const depositWallet = (amount: number) => {
    const at = formatPiTime()
    setWalletBalance((balance) => Math.round((balance + amount) * 100) / 100)
    setTransactions((items) => [{ label: 'Pi 충전', amount, detail: `Pi 월렛 · ${at}`, place: 'Pi 월렛', at }, ...items])
  }
  const withdrawWallet = (amount: number, dest: string) => {
    const at = formatPiTime()
    setWalletBalance((balance) => Math.max(0, Math.round((balance - amount) * 100) / 100))
    setTransactions((items) => [{ label: 'Pi 환불', amount: -amount, detail: `${dest.slice(0, 10)}… · ${at}`, place: dest || 'Pi 월렛', at }, ...items])
  }
  const rewardReview = () => {
    const amount = 0.1
    const at = formatPiTime()
    setWalletBalance((balance) => Math.round((balance + amount) * 100) / 100)
    setTransactions((items) => [{ label: '리뷰 적립', amount, detail: `기사 평가 · ${at}`, place: '리뷰 감사 포인트', at }, ...items])
    showNotice('평가 감사합니다. 0.1 Pi가 적립되었습니다.')
  }
  const openService = (value: string) => {
    if (value === '더보기') {
      setMoreOpen(true)
      setTab('홈')
      return
    }
    setMoreOpen(false)
    if (value === '대리운전') {
      setDaeriSetupOpen(true)
      setTab('홈')
      return
    }
    setSelectedService(value)
  }
  const selectDestination = (value: string) => {
    setDestination(value)
    if (value) showNotice(`${value} 목적지를 선택했어요.`)
  }
  const enterDriverMode = () => {
    setDriverMode(true)
    setTab('홈')
    showNotice('기사 모드로 전환했어요.')
  }
  const leaveDriverMode = () => {
    setDriverMode(false)
    setTab('홈')
    showNotice('승객 모드로 전환했어요.')
  }
  const toggleDriverMode = () => {
    if (driverMode) {
      leaveDriverMode()
      return
    }
    if (isDriverRegistered) {
      enterDriverMode()
      return
    }
    setDriverGateOpen(true)
  }
  const completeDriverRegistration = (role: '기사' | '파트너' = '기사') => {
    if (role === '파트너') {
      setIsPartnerRegistered(true)
      saveIsPartnerRegistered(true)
    } else {
      setIsDriverRegistered(true)
      saveIsDriverRegistered(true)
      setDriverMode(true)
    }
    setDriverGateOpen(false)
    setPartnerSignupOpen(false)
    if (role !== '파트너') setTab('홈')
  }
  const withdrawDriverRegistration = () => {
    setIsDriverRegistered(false)
    saveIsDriverRegistered(false)
    setIsPartnerRegistered(false)
    saveIsPartnerRegistered(false)
    setDriverMode(false)
    setDriverOnline(false)
    setTab('홈')
    showNotice('기사/파트너 탈퇴가 완료되었습니다')
  }

  return (
    <main className="h-dvh overflow-hidden bg-[#E2E8F0] text-[#0F172A]">
      <div className="mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-[#F8FAFC] shadow-2xl">
        <header className="relative z-20 border-b border-[#E2E8F0] bg-white/95 px-4 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold tracking-wide text-[#7C3AED]">TAXI TAGO</p>
              <h1 className="truncate text-[22px] font-black leading-tight text-[#0F172A]">{driverMode ? '파트너 대시보드' : '택시타고'}</h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button onClick={openWallet} className="rounded-full bg-[#EDE5FF] px-2.5 py-1.5 text-[11px] font-black text-[#4C1FB8]">
                {walletBalance.toFixed(2)} Pi
              </button>
              <button onClick={() => setHeaderModal('activity')} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#4C1FB8] text-white" aria-label="시간별 활동 기록">
                <Bell className="h-4 w-4" />
              </button>
              <button onClick={() => setHeaderModal('account')} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#4C1FB8] text-white" aria-label="파이 계정 연동">
                <UserRound className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div
            className={`mt-3 flex min-h-10 items-center gap-2 rounded-2xl px-3 py-2 text-[12px] font-bold ${
              pickup?.source === 'map' || gps.status === 'ready'
                ? 'bg-[#ECFDF5] text-[#047857]'
                : gps.status === 'pending'
                  ? 'bg-[#FFFBEB] text-[#B45309]'
                  : 'bg-[#F1F5F9] text-[#475569]'
            }`}
          >
            <LocateFixed className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {pickup?.source === 'map' || gps.status === 'ready'
                ? `현재 위치 · ${origin.address}`
                : gps.status === 'pending'
                  ? 'GPS 위치를 수신하는 중이에요'
                  : `위치 권한 없음 · ${origin.address}`}
            </span>
            <button
              type="button"
              onClick={() => setFullscreenMapOpen(true)}
              className="shrink-0 rounded-full bg-[#4C1FB8] px-2.5 py-1 text-[11px] font-black text-white shadow-[0_4px_10px_rgba(76,31,184,0.28)]"
            >
              지도확인
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={toggleDriverMode}
              className={`min-h-9 flex-1 rounded-full px-3 text-[11px] font-black ${driverMode ? 'bg-[#4A82B8] text-white' : 'border border-[#CBD5E1] bg-white text-[#334155]'}`}
            >
              {driverMode ? '승객 모드' : '기사/파트너'}
            </button>
            {!driverMode && !isDriverRegistered ? (
              <button type="button" onClick={() => setPartnerSignupOpen(true)} className="min-h-9 flex-1 rounded-full border border-[#4C1FB8] bg-[#EDE5FF] px-3 text-[11px] font-black text-[#3B16A8]">
                회원가입
              </button>
            ) : null}
          </div>
        </header>
        {driverMode ? (
          <DriverDashboard online={driverOnline} onToggleOnline={() => setDriverOnline((value) => !value)} onPassengerMode={leaveDriverMode} onWithdraw={withdrawDriverRegistration} onNotice={showNotice} />
        ) : (
          <Home
            destination={destination}
            pickup={origin.address}
            gps={originGps}
            onDestination={selectDestination}
            onService={openService}
            onReceipt={setReceiptRide}
            onOpenMap={() => setFullscreenMapOpen(true)}
          />
        )}
        {tab !== '홈' && (
          <div className="fixed inset-x-0 top-0 z-30 flex items-end bg-[#241d35]/35" style={{ bottom: '4.75rem' }} onClick={() => setTab('홈')}>
            <div className="mx-auto flex h-[min(92dvh,100%)] w-full max-w-md flex-col overflow-hidden rounded-t-[30px] bg-[#f7f7fb] pt-3" onClick={(event) => event.stopPropagation()}>
              <div className="mx-auto mb-3 h-1.5 w-12 shrink-0 rounded-full bg-[#d8d2e0]" />
              <div className="min-h-0 flex-1 overflow-hidden">
                <TabContent tab={tab} destination={destination} onDestination={selectDestination} onService={(value) => { openService(value); setTab('홈') }} onNotice={showNotice} balance={walletBalance} onWallet={openWallet} onReceipt={setReceiptRide} readNoticeIds={readNoticeIds} onOpenInbox={openInbox} username={user.username} driverMode={driverMode} isDriverRegistered={isDriverRegistered} isPartnerRegistered={isPartnerRegistered} piLinked={isPiLinked} onToggleDriverMode={toggleDriverMode} onOpenDriverSignup={() => setPartnerSignupOpen(true)} onOpenPartnerSignup={() => setPartnerSignupOpen(true)} />
              </div>
            </div>
          </div>
        )}
        <nav className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-md -translate-x-1/2 justify-around border-t-2 border-[#CBD5E1] bg-white px-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_24px_rgba(15,23,42,0.12)]">
          {navItems.map(({ id, label, icon: Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  if (id === '비즈니스') {
                    showNotice('서비스 준비중입니다')
                    return
                  }
                  setTab(id)
                }}
                className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl py-1.5 ${active ? 'text-[#4C1FB8]' : 'text-[#64748B]'}`}
              >
                <span className={`relative flex h-9 w-9 items-center justify-center rounded-2xl ${active ? 'bg-[#4C1FB8] text-white shadow-[0_6px_14px_rgba(76,31,184,0.35)]' : 'bg-transparent'}`}>
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
                  {id === '이용/알림' && unreadNoticeCount > 0 ? (
                    <span className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-black ${active ? 'bg-white text-[#4C1FB8]' : 'bg-[#4C1FB8] text-white'}`}>
                      {unreadNoticeCount > 9 ? '9+' : unreadNoticeCount}
                    </span>
                  ) : null}
                </span>
                <span className="text-[10px] font-black leading-none tracking-tight">{label}</span>
              </button>
            )
          })}
        </nav>
        {mapOpen ? <LocationMapModal onClose={() => setMapOpen(false)} /> : null}
        {fullscreenMapOpen ? (
          <FullscreenMapView
            lat={gps.lat}
            lng={gps.lng}
            address={gps.address}
            pickupLat={origin.lat}
            pickupLng={origin.lng}
            onClose={() => setFullscreenMapOpen(false)}
            onConfirmPickup={(place) => {
              applyPickup({ address: place.address, lat: place.lat, lng: place.lng, source: 'map' })
              setGps({ status: 'ready', address: place.address, lat: place.lat, lng: place.lng })
              setFullscreenMapOpen(false)
              showNotice('출발지를 지정했어요')
            }}
          />
        ) : null}
        {receiptRide && <ReceiptModal ride={receiptRide} onClose={() => setReceiptRide(null)} onNotice={showNotice} />}
        {inboxItem && <InboxDetailModal item={inboxItem} onClose={() => setInboxItem(null)} />}
        {headerModal && (
          <HeaderModal
            kind={headerModal}
            username={user.username}
            piLinked={isPiLinked}
            onClose={() => setHeaderModal(null)}
            onLinkPi={() => {
              setIsPiLinked(true)
              saveIsPiLinked(true)
              showNotice('Pi 계정 연동이 완료되었습니다')
            }}
            onUnlinkPi={() => {
              setIsPiLinked(false)
              saveIsPiLinked(false)
              setIsDriverRegistered(false)
              saveIsDriverRegistered(false)
              setIsPartnerRegistered(false)
              saveIsPartnerRegistered(false)
              setDriverMode(false)
              setDriverOnline(false)
              setTab('홈')
              showNotice('Pi 계정 연동이 해제되어 회원 탈퇴 처리되었습니다')
            }}
          />
        )}
        {partnerSignupOpen && (
          <PartnerSignupModal
            onClose={() => setPartnerSignupOpen(false)}
            onRegistered={completeDriverRegistration}
            onDone={showNotice}
          />
        )}
        {driverGateOpen ? (
          <DriverNeedSignupModal
            onClose={() => setDriverGateOpen(false)}
            onSignup={() => {
              setDriverGateOpen(false)
              setPartnerSignupOpen(true)
            }}
          />
        ) : null}
        {walletOpen && <WalletModal balance={walletBalance} onClose={() => setWalletOpen(false)} onDeposit={depositWallet} onWithdraw={withdrawWallet} transactions={transactions} onNotice={showNotice} onReceipt={setReceiptRide} />}
        {daeriSetupOpen ? (
          <DaeriCallSetupSheet
            destination={destination}
            onClose={() => setDaeriSetupOpen(false)}
            onCall={(trip) => {
              setDaeriTrip(trip)
              setDaeriSetupOpen(false)
              setSelectedService('대리운전')
            }}
          />
        ) : null}
        {moreOpen ? (
          <MoreHubSheet
            onClose={() => setMoreOpen(false)}
            onNotice={showNotice}
            onSelectService={(label) => {
              setMoreOpen(false)
              openService(label)
            }}
          />
        ) : null}
        {selectedService === '택시' && <TaxiMatchingSheet destination={destination} onClose={() => setSelectedService(null)} onNotice={showNotice} balance={walletBalance} onPay={payWithPi} onSettle={settlePiLedger} onNeedCharge={showChargePrompt} onAskReview={setDriverReview} />}
        {selectedService && selectedService !== '택시' && selectedService !== '더보기' && (
          <ServiceSheet
            service={selectedService}
            onClose={() => {
              setSelectedService(null)
              setDaeriTrip(null)
            }}
            onNotice={showNotice}
            balance={walletBalance}
            onPay={payWithPi}
            onSettle={settlePiLedger}
            onNeedCharge={showChargePrompt}
            onAskReview={setDriverReview}
            onSelectService={openService}
            initialPhase={selectedService === '대리운전' && daeriTrip ? 'matching' : 'idle'}
            daeriTrip={selectedService === '대리운전' ? daeriTrip : null}
          />
        )}
        {paymentDone?.txid ? (
          <PaymentDoneModal
            amount={paymentDone.amount}
            place={paymentDone.place}
            remaining={paymentDone.remaining}
            estimated={paymentDone.estimated}
            onClose={() => setPaymentDone(null)}
          />
        ) : driverReview ? (
          <DriverReviewModal
            driver={driverReview}
            onClose={() => setDriverReview(null)}
            onSubmit={() => {
              rewardReview()
              setDriverReview(null)
            }}
          />
        ) : null}
        {chargePromptOpen ? <InsufficientBalanceModal onConfirm={confirmChargePrompt} /> : null}
        {notice && <div className="fixed bottom-20 left-1/2 z-[100] -translate-x-1/2 rounded-full bg-[#241d35] px-4 py-3 text-xs font-black text-white">{notice}</div>}
      </div>
    </main>
  )
}
