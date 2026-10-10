'use client'

import { Component, Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Bell, Bike, Briefcase, Building2, Camera, Car, Check, ChevronLeft, ChevronRight, ChevronUp, CircleUserRound, Clock, Copy, FileSpreadsheet, Gift, House, LayoutGrid, LoaderCircle, LocateFixed, MapPin, MessageCircle, Minus, Navigation, Phone, PhoneOff, Plus, ScanLine, Search, Share2, Sparkles, SquareParking, Star, ToggleRight, UserRound, WalletCards, X } from 'lucide-react'
import { useLocale } from '@/components/locale-provider'
import { translateService } from '@/lib/i18n'
import { notices, type Notice } from '@/lib/notices'
import MoreMenu, { type MoreItemId } from '@/components/more/more-menu'
import { FaresView, NoticeDetailView, NoticeListView, SettingsView, SupportView } from '@/components/more/more-pages'
import { TermsDetailView, TermsListView } from '@/components/more/terms-pages'
import { PaymentHandler, QrScanModal } from '@/components/PaymentHandler'
import { serviceIllustrations } from '@/components/service-illustrations'
import { LocationTileMap, TaxiLiveMap, toTaxiLivePhase, type TaxiMatchPhase } from '@/components/app-map'
import { NearbyServiceMap } from '@/components/nearby-service-map'
import { MobilityDeviceFormModal } from '@/components/mobility-device-form'
import { PlacePickerScreen } from '@/components/place-picker-map'
import { InviteLaunchModal } from '@/components/invite-launch-modal'
import { lookupSuggestedPlace, suggestedDestinationsFor } from '@/lib/region-destinations'
import { searchPlacesFromApi } from '@/lib/geocode-client'
import { BUSAN_CITY_HALL, failedReverseAddress, requestBrowserPosition, resolveFlexibleFallback, resolveRidePlace, reverseGeocode, type RidePlace } from '@/lib/user-location'
import { resolveLiveRidePoints, writeRideSession } from '@/lib/ride-session'
import {
  appendSettlementEntry,
  hasPiCallCredential,
  loadPartnerProfile,
  loadPiIdentity,
  partnerVehicle,
  requestAccountWithdrawal,
  savePartnerProfile,
  savePiIdentity,
  syncPartnerLink,
  uploadInsuranceDoc,
} from '@/lib/partner-account'
import { getPaymentPolicy, setPolicyBaseOverrides } from '@/lib/payment-policy'
import { piCompact } from '@/lib/pi-format'
import { DEFAULT_FARE_CONFIG, fetchDepositWallet, fetchFareConfig, FLAT_SERVICE_LABEL, type FareConfig, type FlatServiceId } from '@/lib/fare-config'
import { isPiWalletAddress, piWalletError, PLATFORM_DEPOSIT_WALLET } from '@/lib/pi-wallet'
import { DELIVERY_VEHICLES, estimateDeliveryFare, formatDeliveryFare, getPackageSize, PACKAGE_SIZES, type DeliveryVehicle, type PackageSizeId } from '@/lib/delivery-fare'
import { acceptDelivery, fetchDelivery, fetchOpenDeliveries, loadDeliveryJob, publishDelivery, saveDeliveryJob, type DeliveryChatPeer, type DeliveryJob, type PublicDelivery } from '@/lib/delivery-job'
import { formatKoreanPhone, isValidKoreanPhone } from '@/lib/phone'
import { DeliveryChatSheet, DeliveryContactCard } from '@/components/delivery-contacts'
import { isRidePayLabel, settleMidTripCancelFee, settleRideFare } from '@/lib/ride-fare'
import { haversineKm, LONG_DISTANCE_CALL_KM, longDistanceCheck, routeChainKm } from '@/lib/dispatch-geo'
import { listNearbyServiceSpots, nearbyKindFromService, partnerListingFromProfile, type RegisteredNearbyPartner } from '@/lib/nearby-services'
import { findDeviceBySpotId, isDeviceRentable, MOBILITY_DEVICES_EVENT, MOBILITY_STATUS_LABEL, mobilityPartnersForService, setMobilityDeviceStatus } from '@/lib/mobility-devices'
import {
  abandonDriverRide,
  cancelRideRequest,
  completeRideTrip,
  markRideProgress,
  createRideRequest,
  fetchActiveRide,
  fetchDriverActiveRide,
  fetchDriverEarnings,
  fetchDriverOffer,
  fetchRideHistory,
  fetchRideReceipt,
  rideFromPushedOffer,
  subscribeDriverLive,
  fetchRideRequest,
  lockRideEscrow,
  respondToRideOffer,
  acceptRideOnDevice,
  sendDriverPresence,
  subscribeRideLive,
} from '@/lib/dispatch-client'
import { enableDriverPush, showDriverOfferNotification } from '@/lib/driver-notify-client'
import { acquireDriverWakeLock, alertDriverOffer, primeDriverAlertAudio, releaseDriverWakeLock, stopDriverOfferAlarm } from '@/lib/driver-alert'
import { playCommsAlert, primeCommsAlertAudio } from '@/lib/alert-sound'
import DriverLostWatcher from '@/components/driver-lost-watcher'
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/contact-info'
import type { DriverPenaltyInfo, PublicRide } from '@/lib/dispatch-types'
import type { DriverEarningsStats, SettlementReceipt } from '@/lib/escrow-types'
import { BalanceCheckoutButton, describePiUserMessage, chargePiWallet, PI_SANDBOX, PI_CHARGE_MAX_PI, signInWithPi, autoVerifyPiAppStudio, type PiSession } from '@/components/pi-checkout'
import { payFromBalance } from '@/lib/balance-pay'
import MyPage from '@/components/my-page'
import ManualPayModal from '@/components/manual-pay-modal'
import QrPayScanModal from '@/components/qr-pay-scan'
import PartnerProfileEditModal from '@/components/partner-profile-edit'
import EarningsStatSheet from '@/components/partner-stat-sheet'
import RideSafeCall from '@/components/ride-safe-call'
import RideChat from '@/components/ride-chat'
import RideCommsAlerts from '@/components/ride-comms-alerts'
import RideReviewModal, { type RideReviewTarget } from '@/components/ride-review'
import RideSosButton from '@/components/ride-sos'
import SupportCenter, { type LostPrefill } from '@/components/support-center'
import { fetchUserRating, recordReviewReward } from '@/lib/review-client'
import { fetchLostInbox, fetchSosInbox } from '@/lib/support-client'
import type { LostItem, SosAlert } from '@/lib/support-types'

const LOCAL_TEST_USER = { username: 'taxitago' }
const PASSENGER_ID_KEY = 'taxitago-passenger-id'
const DRIVER_ID_KEY = 'taxitago-driver-id'
let taxiSheetRideId = ''
const ACTIVE_TAXI_KEY = 'taxitago-active-taxi'

function readStoredTaxi(): { rideId: string; trip: ActiveTrip } | null {
  if (typeof window === 'undefined') return null
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(ACTIVE_TAXI_KEY) || 'null') as { rideId?: string; trip?: ActiveTrip } | null
    if (!parsed?.rideId || !parsed.trip) return null
    return { rideId: parsed.rideId, trip: parsed.trip }
  } catch {
    return null
  }
}

function writeStoredTaxi(value: { rideId: string; trip: ActiveTrip } | null) {
  if (typeof window === 'undefined') return
  if (!value) window.sessionStorage.removeItem(ACTIVE_TAXI_KEY)
  else window.sessionStorage.setItem(ACTIVE_TAXI_KEY, JSON.stringify(value))
}
let daeriSheetRideId = ''

function readOrCreateLocalId(key: string, prefix: string) {
  try {
    const existing = window.localStorage.getItem(key)
    if (existing) return existing
    const next = `${prefix}-${crypto.randomUUID()}`
    window.localStorage.setItem(key, next)
    return next
  } catch {
    return `${prefix}-local`
  }
}

function localPassengerId() {
  return readOrCreateLocalId(PASSENGER_ID_KEY, 'passenger')
}

const DRIVER_ACTIVE_KEY = 'taxitago-driver-active'
const DRIVER_ACTIVE_MAX_AGE = 12 * 60 * 60 * 1000

function readStoredDriverRide(driverId: string): PublicRide | null {
  if (typeof window === 'undefined' || !driverId) return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`${DRIVER_ACTIVE_KEY}:${driverId}`) || 'null') as
      | { ride?: PublicRide; savedAt?: number }
      | null
    const ride = parsed?.ride
    if (!ride?.id || ride.status !== 'assigned') return null
    if (!Number.isFinite(parsed?.savedAt) || Date.now() - (parsed?.savedAt ?? 0) > DRIVER_ACTIVE_MAX_AGE) return null
    return ride
  } catch {
    return null
  }
}

function writeStoredDriverRide(driverId: string, ride: PublicRide | null) {
  if (typeof window === 'undefined' || !driverId) return
  try {
    const key = `${DRIVER_ACTIVE_KEY}:${driverId}`
    if (!ride || ride.status !== 'assigned') window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify({ ride, savedAt: Date.now() }))
  } catch {
    undefined
  }
}

const DRIVER_EARNINGS_CACHE = 'taxitago-driver-earnings'

function readEarningsCache(driverId: string): DriverEarningsStats | null {
  try {
    const raw = window.localStorage.getItem(`${DRIVER_EARNINGS_CACHE}:${driverId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DriverEarningsStats
    return parsed && Array.isArray(parsed.recent) ? parsed : null
  } catch {
    return null
  }
}

function writeEarningsCache(driverId: string, stats: DriverEarningsStats) {
  try {
    window.localStorage.setItem(`${DRIVER_EARNINGS_CACHE}:${driverId}`, JSON.stringify(stats))
  } catch {
    undefined
  }
}

function hasRecordedEarnings(stats: DriverEarningsStats | null | undefined) {
  if (!stats) return false
  const total = stats.total?.[0]
  return stats.todayAmount > 0 || stats.todayTrips > 0 || (total?.amount ?? 0) > 0 || (total?.trips ?? 0) > 0 || stats.recent.length > 0
}

function localDriverId(partnerUid?: string) {
  if (partnerUid) return partnerUid
  return readOrCreateLocalId(DRIVER_ID_KEY, 'driver')
}

function liveVehicleFromRide(ride: PublicRide | null | undefined) {
  const driver = ride?.assignedDriver
  if (!driver || !Number.isFinite(driver.lat) || !Number.isFinite(driver.lng)) return {}
  return { vehicleLat: driver.lat, vehicleLng: driver.lng, vehicleHeading: driver.heading }
}

type ServiceLabel = keyof typeof serviceIllustrations
type Service = { label: ServiceLabel }
type RideCoords = { lat: number; lng: number; address?: string }
const MAX_WAYPOINTS = 2
type ActiveTrip = {
  originLat: number
  originLng: number
  originAddress: string
  waypoints?: RideCoords[]
  destLat: number
  destLng: number
  destAddress: string
  destLabel: string
}
type DaeriTrip = {
  pickup: string
  dest: string
  plan: string
  fare: number
  pickupLat: number
  pickupLng: number
  waypoints?: RideCoords[]
  destLat: number
  destLng: number
}

function coordsFromPlaceQuery(query: string): RideCoords | null {
  const hit = lookupSuggestedPlace(query)
  if (!hit || !Number.isFinite(hit.lat) || !Number.isFinite(hit.lng)) return null
  return { lat: hit.lat, lng: hit.lng, address: hit.address }
}

function rideRouteLabel(pickupAddress: string, destLabel: string, destAddress?: string, waypointLabels?: string[]) {
  const origin = pickupAddress.trim() || '현재 위치'
  const dest = (destAddress || destLabel).trim() || '선택한 목적지'
  const stops = (waypointLabels ?? []).map((label) => label.trim()).filter(Boolean)
  return `${origin} → ${[...stops, dest].join(' → ')}`
}

type RideStopPoints = {
  pickup: { address?: string; label?: string }
  waypoints?: { address?: string; label?: string }[]
  dest: { address?: string; label?: string }
}

/** Server ride (PublicRide) → ordered stops: 출발지 → 경유지… → 목적지. */
function rideStops(ride: RideStopPoints) {
  const origin = ride.pickup.address || ride.pickup.label || '출발지'
  const via = (ride.waypoints ?? []).map((point) => point.label || point.address || '경유지').filter(Boolean)
  const dest = ride.dest.label || ride.dest.address || '목적지'
  return { origin, via, dest, chain: [origin, ...via, dest].join(' → ') }
}

/** 기사 콜 카드용 장거리 판별 — 출발지→경유지→목적지 체인 거리 + 시/도 권역 이탈 여부. */
function rideLongDistanceFlag(ride: PublicRide | null | undefined) {
  if (!ride?.pickup || !ride?.dest) return null
  if (!Number.isFinite(ride.pickup.lat) || !Number.isFinite(ride.dest.lat)) return null
  const flag = longDistanceCheck(ride.pickup, ride.dest)
  const chain = [ride.pickup, ...(ride.waypoints ?? []), ride.dest].filter(
    (point): point is NonNullable<typeof point> => Number.isFinite(point?.lat) && Number.isFinite(point?.lng),
  )
  const chainKm = chain.length > 1 ? routeChainKm(chain) : 0
  const km = Math.max(chainKm, flag.km)
  if (!flag.far && km < LONG_DISTANCE_CALL_KM) return null
  return { km, regionExit: flag.regionExit }
}

function LongDistanceCallBadge({ ride }: { ride: PublicRide | null }) {
  const flag = rideLongDistanceFlag(ride)
  if (!flag) return null
  return (
    <div className="mt-2 flex items-start gap-2 rounded-xl border border-[#FDBA74] bg-[#FFF7ED] px-3 py-2">
      <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-[#EA580C]" />
      <div className="min-w-0">
        <p className="text-xs font-black text-[#C2410C]">장거리 운행</p>
        <p className="mt-0.5 text-[11px] font-bold leading-4 text-[#9A3412]">
          예상 이동 거리 약 {flag.km.toFixed(1)}km{flag.regionExit ? ' · 타 시/도 이동' : ''} — 수락 전 경로와 요금을 확인해 주세요.
        </p>
      </div>
    </div>
  )
}

type RouteGap = 'pickup' | 'dest' | 'both'

function isUsablePickupAddress(value?: string | null) {
  return Boolean(usableMapAddress(value))
}

function routeGap(pickup?: string | null, dest?: string | null): RouteGap | null {
  const pickupReady = isUsablePickupAddress(pickup)
  const destReady = Boolean((dest ?? '').trim())
  if (pickupReady && destReady) return null
  if (!pickupReady && !destReady) return 'both'
  return pickupReady ? 'dest' : 'pickup'
}

function RouteRequiredModal({ onConfirm }: { onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[#1e1033]/50 p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="route-required-title"
        className="w-full max-w-sm rounded-[28px] bg-white px-5 py-6 text-center shadow-[0_20px_48px_rgba(30,16,51,0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#F3E8FF] text-[#4C1FB8]">
          <MapPin className="h-7 w-7" />
        </div>
        <h2 id="route-required-title" className="mt-4 text-lg font-black leading-7 text-[#0F172A]">
          먼저 출발지와 목적지를 선택 하세요
        </h2>
        <button type="button" onClick={onConfirm} className="mt-6 w-full rounded-2xl bg-[#4C1FB8] py-3.5 text-base font-black text-white">
          확인
        </button>
      </section>
    </div>
  )
}

function LongDistanceConfirmModal({
  km,
  regionExit,
  destRegion,
  onEdit,
  onConfirm,
}: {
  km: number
  regionExit: boolean
  destRegion: string
  onEdit: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-[125] flex items-center justify-center bg-[#1e1033]/50 p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="long-distance-title"
        className="w-full max-w-sm rounded-[28px] bg-white px-5 py-6 text-center shadow-[0_20px_48px_rgba(30,16,51,0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#FFF7ED] text-[#EA580C]">
          <Navigation className="h-7 w-7" />
        </div>
        <h2 id="long-distance-title" className="mt-4 text-lg font-black leading-7 text-[#0F172A]">
          장거리 콜을 확인해 주세요
        </h2>
        <p className="mt-2 text-sm font-bold leading-6 text-[#64748B]">
          목적지 거리가 너무 멀리 있습니다. 목적지를 다시 한번 확인해 주세요.
        </p>
        <p className="mt-2 text-xs font-black text-[#EA580C]">
          직선거리 약 {km.toFixed(1)}km{regionExit && destRegion ? ` · ${destRegion} 권역` : ''}
        </p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-2xl border-2 border-[#E0D4FF] bg-white py-3.5 text-sm font-black text-[#4C1FB8]"
          >
            목적지 수정하기
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-2xl bg-[#4C1FB8] py-3.5 text-sm font-black text-white"
          >
            그대로 호출하기
          </button>
        </div>
      </section>
    </div>
  )
}

const navItems = [
  { id: '전체보기', labelKey: 'nav.all' as const, icon: LayoutGrid },
  { id: '기사/파트너', labelKey: 'nav.partner' as const, icon: Car },
  { id: '홈', labelKey: 'nav.home' as const, icon: House },
  { id: '이용/알림', labelKey: 'nav.inbox' as const, icon: Bell },
  { id: '내 정보', labelKey: 'nav.mypage' as const, icon: CircleUserRound },
] as const

const services: Service[] = [
  { label: '택시' },
  { label: '대리운전' },
  { label: '택배' },
  { label: '자전거' },
  { label: '킥보드' },
  { label: 'EV 충전' },
  { label: '주차' },
  { label: '더보기' },
]

const comingSoonServices: Service[] = [
  { label: '무인 자율 택시' },
  { label: '무인 로봇 배송' },
]

function isComingSoonService(label: string) {
  return comingSoonServices.some((item) => item.label === label)
}

function menuMobilityServices(includeMore: boolean) {
  const current = includeMore ? services : services.filter((item) => item.label !== '더보기')
  return [...current, ...comingSoonServices]
}

function ServicePreparingModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#1e1033]/50 p-5" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-preparing-title"
        className="w-full max-w-sm rounded-[28px] bg-white px-5 py-6 text-center shadow-[0_20px_48px_rgba(30,16,51,0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="service-preparing-title" className="text-lg font-black leading-7 text-[#0F172A]">
          서비스 준비중 입니다
        </h2>
        <button type="button" onClick={onClose} className="mt-6 w-full rounded-2xl bg-[#4C1FB8] py-3.5 text-base font-black text-white">
          확인
        </button>
      </section>
    </div>
  )
}

function ServiceIconButton({
  service,
  onClick,
  compact = false,
  wrapLabel = false,
}: {
  service: Service
  onClick: () => void
  compact?: boolean
  wrapLabel?: boolean
}) {
  const { locale, t } = useLocale()
  const Illustration = serviceIllustrations[service.label]
  const name = translateService(locale, service.label)
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      aria-label={t('service.open', { name })}
      className="group flex flex-col items-center"
    >
      <span className={`flex items-center justify-center bg-white shadow-[0_8px_22px_rgba(15,23,42,0.10)] ring-1 ring-black/[0.04] transition group-hover:-translate-y-0.5 group-active:scale-95 ${compact ? 'h-12 w-12 rounded-[16px]' : 'h-16 w-16 rounded-[22px]'}`}>
        <Illustration />
      </span>
      <span className={`font-black tracking-tight text-[#0F172A] ${wrapLabel ? 'mt-2 w-full whitespace-normal text-center text-[11px] leading-tight' : `whitespace-nowrap ${compact ? 'mt-1 text-[11px]' : 'mt-2 text-[13px]'}`}`}>
        {name}
      </span>
    </button>
  )
}


type GpsFix = {
  status: 'pending' | 'ready' | 'denied' | 'approx'
  address: string
  lat: number
  lng: number
}

type PickupSource = 'gps' | 'map' | string

type PickupPlace = {
  address: string
  lat: number
  lng: number
  source?: PickupSource
}

function pickupSourceIsMap(place: { source?: PickupSource } | null | undefined) {
  return String(place?.source ?? '') === 'map'
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

function openFreshMapModal(setOpen: (open: boolean) => void, bumpSession: () => void) {
  setOpen(false)
  bumpSession()
  window.setTimeout(() => setOpen(true), 0)
}

function finiteCoord(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isCityHallCoord(nextLat: number, nextLng: number) {
  return Math.abs(nextLat - BUSAN_CITY_HALL.lat) < 1e-4 && Math.abs(nextLng - BUSAN_CITY_HALL.lng) < 1e-4
}

function usableMapAddress(value?: string | null) {
  const label = (value || '').trim()
  if (!label) return ''
  if (/확인하는 중|수신하는 중|불러오는 중|갱신하는 중/.test(label)) return ''
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(label)) return ''
  return label
}

const ADDRESS_LOADING = '새로운 주소를 불러오는 중...'

function LocationMapModal({
  onClose,
  initialLat,
  initialLng,
  initialAddress,
}: {
  onClose: () => void
  initialLat?: number
  initialLng?: number
  initialAddress?: string
}) {
  const start = {
    lat: Number.isFinite(initialLat) ? (initialLat as number) : BUSAN_CITY_HALL.lat,
    lng: Number.isFinite(initialLng) ? (initialLng as number) : BUSAN_CITY_HALL.lng,
  }
  const [gpsPending, setGpsPending] = useState(true)
  const [addressPending, setAddressPending] = useState(!initialAddress)
  const [mapCenter, setMapCenter] = useState(start)
  const [pin, setPin] = useState(start)
  const [address, setAddress] = useState(initialAddress || '이 위치의 주소를 확인하는 중')
  const [source, setSource] = useState<'fallback' | 'gps' | 'pick'>(initialAddress ? 'gps' : 'fallback')
  const [mapInstanceKey] = useState(() => `loc-map-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const userMovedRef = useRef(false)
  const setAddressRef = useRef(setAddress)
  const setAddressPendingRef = useRef(setAddressPending)
  const setPinRef = useRef(setPin)
  const setSourceRef = useRef(setSource)
  setAddressRef.current = setAddress
  setAddressPendingRef.current = setAddressPending
  setPinRef.current = setPin
  setSourceRef.current = setSource

  const mapCenterRef = useRef(start)
  mapCenterRef.current = mapCenter

  const applyPoint = (nextLat: number, nextLng: number, nextSource: 'fallback' | 'gps' | 'pick', recenter = false) => {
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return
    setPin({ lat: nextLat, lng: nextLng })
    if (recenter) setMapCenter({ lat: nextLat, lng: nextLng })
    setSource(nextSource)
    setAddress(ADDRESS_LOADING)
    setAddressPending(true)
  }

  useEffect(() => {
    let cancelled = false
    if (usableMapAddress(initialAddress)) {
      setGpsPending(false)
      setAddressPending(false)
    }
    void (async () => {
      const point = await requestBrowserPosition()
      if (cancelled) return
      if (point) {
        if (!userMovedRef.current) applyPoint(point.lat, point.lng, 'gps', true)
        setGpsPending(false)
        return
      }
      setGpsPending(false)
      if (!usableMapAddress(initialAddress) && !userMovedRef.current) {
        applyPoint(start.lat, start.lng, 'fallback', true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const statusLabel = gpsPending
    ? 'GPS로 현재 위치를 확인하는 중이에요.'
    : source === 'pick'
      ? '지도를 움직인 중심 위치의 주소입니다.'
      : source === 'gps'
        ? '스마트폰 GPS 기준 현재 위치입니다.'
        : '위치 권한이 없어 접속 지역 기준으로 표시했어요.'
  const displayedAddress = addressPending || !usableMapAddress(address) ? ADDRESS_LOADING : address

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
            <p className="mt-1 text-base font-semibold leading-snug text-[#0f172a]">{displayedAddress}</p>
            {addressPending ? <p className="mt-1 text-[11px] font-bold text-[#94A3B8]">지도 중심에 맞춰 주소를 갱신하는 중</p> : null}
          </div>
        </div>
        <div className="relative mx-4 overflow-hidden rounded-[24px] border-2 border-[#334155] bg-[#E2E8F0]">
          <LocationTileMap
            key={mapInstanceKey}
            lat={mapCenter.lat}
            lng={mapCenter.lng}
            pinLat={pin.lat}
            pinLng={pin.lng}
            className="h-[340px]"
            interactive
            centerPin
            onAddressChange={(place) => {
              setPinRef.current({ lat: place.lat, lng: place.lng })
              const next = usableMapAddress(place.address)
              if (!next) {
                setAddressRef.current(ADDRESS_LOADING)
                setAddressPendingRef.current(true)
                return
              }
              const origin = mapCenterRef.current
              if (Math.abs(place.lat - origin.lat) > 1e-5 || Math.abs(place.lng - origin.lng) > 1e-5) {
                userMovedRef.current = true
                setSourceRef.current('pick')
              }
              setAddressRef.current(next)
              setAddressPendingRef.current(false)
            }}
            onLocate={() => {
              userMovedRef.current = false
              if (typeof navigator === 'undefined' || !navigator.geolocation) return
              navigator.geolocation.getCurrentPosition(
                (position) => applyPoint(position.coords.latitude, position.coords.longitude, 'gps', true),
                () => undefined,
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
              )
            }}
          />
          <div className="pointer-events-none absolute inset-x-3 top-3">
            <div className="rounded-2xl bg-white/95 px-3 py-2.5 shadow-[0_8px_18px_rgba(15,23,42,0.14)]">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-[#3b1d8f]">
                <MapPin className="h-3.5 w-3.5" />
                {source === 'pick' ? '지도 위치' : '현재 위치'}
              </p>
              <p className="mt-1 text-sm font-semibold leading-snug text-[#0f172a]">{displayedAddress}</p>
              {addressPending ? <p className="mt-1 text-[11px] font-bold text-[#94A3B8]">지도 중심에 맞춰 주소를 갱신하는 중</p> : null}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-3 bottom-8">
            <p className="rounded-xl bg-[#0f172a]/90 px-3 py-2 text-center text-sm font-medium leading-snug text-white">
              지도를 움직이면 중심 위치의 주소가 바로 바뀝니다
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
const DEPOSIT_ADDRESS_KEY = 'taxitago-pi-deposit-address'
/** 이용자가 지정한 출금 주소 — {uid, address} 형태로 uid 범위로 저장한다. */
const WITHDRAW_ADDRESS_KEY = 'taxitago-pi-withdraw-address'
const DEPOSIT_CREDITED_KEY = 'taxitago-pi-deposit-credited'

/** txid 단위 멱등 — 지갑 모달과 앱 레벨 폴러가 같은 입금을 두 번 충전하지 못하게 공유한다. */
let piDepositCreditedCache: Set<string> | null = null
function piDepositCreditedSet() {
  if (!piDepositCreditedCache) {
    piDepositCreditedCache = new Set()
    try {
      const stored = JSON.parse(window.localStorage.getItem(DEPOSIT_CREDITED_KEY) || '[]') as unknown
      if (Array.isArray(stored)) piDepositCreditedCache = new Set(stored.map(String))
    } catch {
      undefined
    }
  }
  return piDepositCreditedCache
}
function markPiDepositCredited(txid: string) {
  const value = txid.trim()
  if (!value) return
  piDepositCreditedSet().add(value)
  try {
    window.localStorage.setItem(DEPOSIT_CREDITED_KEY, JSON.stringify([...piDepositCreditedSet()].slice(-300)))
  } catch {
    undefined
  }
}
function isPiDepositCredited(txid: string) {
  const value = txid.trim()
  return Boolean(value) && piDepositCreditedSet().has(value)
}
const SETTLED_RIDES_KEY = 'taxitago-settled-rides'
const SETTLED_PAYMENTS_KEY = 'taxitago-settled-payments'

/** rideId/paymentId 단위 멱등 — 새로고침해도 유지돼 완료 폴러가 같은 건을 다시 차감하지 못한다. */
let settledRideIdCache: Set<string> | null = null
let settledPaymentIdCache: Set<string> | null = null
function loadPersistedIds(key: string) {
  const ids = new Set<string>()
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) || '[]') as unknown
    if (Array.isArray(stored)) for (const id of stored) ids.add(String(id))
  } catch {
    undefined
  }
  return ids
}
function persistIds(key: string, ids: Set<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...ids].slice(-500)))
  } catch {
    undefined
  }
}
function markSettledRide(id: string | undefined) {
  const value = (id || '').trim()
  if (!value) return
  if (!settledRideIdCache) settledRideIdCache = loadPersistedIds(SETTLED_RIDES_KEY)
  settledRideIdCache.add(value)
  persistIds(SETTLED_RIDES_KEY, settledRideIdCache)
}
function markSettledPayment(id: string | undefined) {
  const value = (id || '').trim()
  if (!value) return
  if (!settledPaymentIdCache) settledPaymentIdCache = loadPersistedIds(SETTLED_PAYMENTS_KEY)
  settledPaymentIdCache.add(value)
  persistIds(SETTLED_PAYMENTS_KEY, settledPaymentIdCache)
}
function isSettledRide(id: string | undefined) {
  const value = (id || '').trim()
  if (!value) return false
  if (!settledRideIdCache) settledRideIdCache = loadPersistedIds(SETTLED_RIDES_KEY)
  return settledRideIdCache.has(value)
}
function isSettledPayment(id: string | undefined) {
  const value = (id || '').trim()
  if (!value) return false
  if (!settledPaymentIdCache) settledPaymentIdCache = loadPersistedIds(SETTLED_PAYMENTS_KEY)
  return settledPaymentIdCache.has(value)
}

/**
 * 서버(/api/wallet/deposits)가 Horizon 스캔+장부 기록까지 처리한 뒤
 * 이 이용자에게 귀속되는 confirmed 입금을 돌려준다 — 각 건은 txid 멱등으로
 * 정확히 한 번만 onCredit 된다.
 */
async function scanPiDeposits(
  wallet: string,
  uid: string,
  onCredit: (amount: number, txid: string, at?: number) => void,
  onBalance?: (spendable: number) => void,
) {
  try {
    const uidParam = uid ? `&uid=${encodeURIComponent(uid)}` : ''
    const res = await fetch(
      `/api/wallet/deposits?from=${encodeURIComponent(wallet)}${uidParam}&sandbox=${PI_SANDBOX}`,
      { cache: 'no-store' },
    )
    const data = (await res.json().catch(() => null)) as {
      deposits?: { txid: string; amount: number; createdAt?: string }[]
      spendable?: number
      creditsTotal?: { total?: number }
    } | null
    if (!res.ok || !data?.deposits) return
    for (const deposit of data.deposits) {
      if (!deposit.txid || isPiDepositCredited(deposit.txid) || !(deposit.amount > 0)) continue
      markPiDepositCredited(deposit.txid)
      // 서버 장부의 실제 입금 시각을 넘긴다 — 재동기화된 과거 입금이 "오늘 충전"
      // 으로 오인돼 24시간 한도를 깎아먹지 않게 한다.
      const at = typeof deposit.createdAt === 'string' ? Date.parse(deposit.createdAt) : NaN
      onCredit(deposit.amount, deposit.txid, Number.isFinite(at) ? at : undefined)
    }
    // 서버 장부가 권위 — 크레딧이 실제로 기록된 이용자는 spendable로 로컬 잔액을
    // 교정한다(새로고침 중복 차감 등으로 깨진 표시 자가치유). 서버 장부가 비어
    // 있으면 로컬 잔액을 건드리지 않는다(KV 미설정 등 판별 불가).
    const spendable = Number(data.spendable)
    const creditsTotal = Number(data.creditsTotal?.total)
    if (onBalance && Number.isFinite(spendable) && spendable >= 0 && creditsTotal > 0) onBalance(spendable)
  } catch {
    undefined
  }
}
const DEFAULT_DEPOSIT_ADDRESS = PLATFORM_DEPOSIT_WALLET
const DRIVER_REG_KEY = 'taxitago-is-driver-registered'
const PARTNER_REG_KEY = 'taxitago-is-partner-registered'
const PI_ACCOUNT_KEY = 'taxitago-pi-account-linked'
const READ_NOTICES_KEY = 'taxitago-read-notices'
const RECENT_DEST_KEY = 'taxitago-recent-destinations'
const PICKUP_KEY = 'taxitago-pickup-place'
const ACTIVITY_KEY = 'taxitago-activity-log'
const RECENT_USE_KEY = 'taxitago-recent-use'

type RecentUse = {
  route: string
  fare: number
  service: string
  at: string
  paymentId: string
  txid: string
}

function loadRecentUse(): RecentUse | null {
  if (typeof window === 'undefined') return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_USE_KEY) || 'null') as RecentUse | null
    if (!parsed || typeof parsed.route !== 'string' || !(parsed.fare > 0)) return null
    return parsed
  } catch {
    return null
  }
}

function saveRecentUse(item: RecentUse) {
  window.localStorage.setItem(RECENT_USE_KEY, JSON.stringify(item))
}

function formatRecentFare(amount: number) {
  return `${amount.toFixed(7)} Pi`
}

function receiptFromRecent(item: RecentUse): RideReceipt {
  const parts = item.route.split('→').map((part) => part.trim()).filter(Boolean)
  const origin = parts[0] || item.route
  const dest = parts.length > 1 ? parts[parts.length - 1] : item.route
  const waypoints = parts.length > 2 ? parts.slice(1, -1) : undefined
  return {
    route: item.route,
    origin,
    waypoints,
    dest,
    fare: formatRecentFare(item.fare),
    vehicle: item.service,
    date: item.at,
    distance: '-',
    duration: '-',
    driver: '-',
    car: item.service,
    plate: '-',
    transactionId: item.txid,
    method: 'Pi 월렛',
  }
}

type ActivityEntry = { id: string; at: string; ts?: number; label: string; detail: string }

function loadActivities(): ActivityEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACTIVITY_KEY) || '[]') as ActivityEntry[]
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.label && item.at) : []
  } catch {
    return []
  }
}

function saveActivities(items: ActivityEntry[]) {
  window.localStorage.setItem(ACTIVITY_KEY, JSON.stringify(items.slice(0, 40)))
}

type FavoritePlace = { id: string; name: string; address: string }
type RecentPlace = { id: string; name: string; address: string }
type PiTransaction = { label: string; amount: number; detail: string; place: string; at: string; ts?: number; estimated?: number; txid?: string }
type RideReceipt = {
  rideId?: string
  route: string
  origin: string
  waypoints?: string[]
  dest: string
  fare: string
  estimatedFare?: string
  trafficSurcharge?: string
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

function receiptFromSettlement(item: SettlementReceipt): RideReceipt {
  return {
    rideId: item.rideId,
    route: item.route,
    origin: item.origin,
    waypoints: item.waypoints,
    dest: item.dest,
    fare: `${item.amount.toFixed(7)} Pi`,
    estimatedFare: `${item.estimatedFare.toFixed(7)} Pi`,
    trafficSurcharge:
      item.trafficSurcharge && item.trafficSurcharge > 0
        ? `+${item.trafficSurcharge.toFixed(7)} Pi${item.trafficDelayMinutes ? ` (예상 대비 +${item.trafficDelayMinutes}분 지연)` : ''}`
        : undefined,
    vehicle: '택시',
    date: new Date(item.settledAt).toLocaleString('ko-KR'),
    distance: item.actualKm != null ? `실측 ${item.actualKm.toFixed(1)} km` : '-',
    duration: item.expectedMinutes != null ? `약 ${Math.round(item.expectedMinutes)}분` : '-',
    driver: item.driverName,
    car: item.vehicle,
    plate: item.plate,
    transactionId: item.payoutTxid,
    method: 'Pi 에스크로 정산',
  }
}

function receiptFromTransaction(tx: PiTransaction, index: number): RideReceipt {
  const matched = SAMPLE_RIDES.find((ride) => ride.route === tx.place)
  const estimatedFare = tx.estimated != null ? `${tx.estimated.toFixed(7)} Pi` : undefined
  if (matched) {
    return { ...matched, fare: `${Math.abs(tx.amount).toFixed(7)} Pi`, estimatedFare, date: tx.at, vehicle: tx.label }
  }
  const isRoute = tx.place.includes('→')
  const parts = isRoute ? tx.place.split('→').map((part) => part.trim()).filter(Boolean) : [tx.place]
  const origin = parts[0] ?? tx.place
  const dest = parts.length > 1 ? parts[parts.length - 1] : ''
  const waypoints = parts.length > 2 ? parts.slice(1, -1) : undefined
  const rideLike = isRoute || (tx.amount < 0 && /택시|대리|호출/.test(tx.label))
  return {
    route: isRoute ? tx.place : `${tx.label}`,
    origin: origin.trim() || tx.label,
    waypoints,
    dest: (dest || (rideLike ? '목적지' : 'Pi 월렛')).trim(),
    fare: `${Math.abs(tx.amount).toFixed(7)} Pi`,
    estimatedFare,
    vehicle: tx.label,
    date: tx.at,
    distance: rideLike ? '5.2 km' : '-',
    duration: rideLike ? '18분' : '-',
    driver: rideLike ? '김민수' : '-',
    car: rideLike ? '현대 아슬란' : '-',
    plate: rideLike ? '서울 31바 1842' : '-',
    transactionId: tx.txid || `TX-${String(index + 1).padStart(4, '0')}-${tx.at.replace(/[^0-9]/g, '').slice(0, 8) || '000000'}`,
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

function loadDepositAddress() {
  try {
    const raw = window.localStorage.getItem(DEPOSIT_ADDRESS_KEY)
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
  } catch {
    /* private mode */
  }
  return DEFAULT_DEPOSIT_ADDRESS
}

function saveDepositAddress(value: string) {
  window.localStorage.setItem(DEPOSIT_ADDRESS_KEY, value.trim())
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
    const source: PickupSource = typeof parsed.source === 'string' && parsed.source ? parsed.source : 'gps'
    return { address: parsed.address, lat: parsed.lat, lng: parsed.lng, source }
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

type PlaceItem = { name: string; address: string; jibun?: string; category?: string; kind?: 'parking'; hint: string; lat?: number; lng?: number }

function locationHint(address: string) {
  return address.replace(/\s+/g, ' ').trim()
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
  originLat,
  originLng,
  originAddress,
  searchPlaceholder,
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
  originLat?: number
  originLng?: number
  originAddress?: string
  searchPlaceholder?: string
  onClose: () => void
  onSelect: (name: string, address?: string, coords?: RideCoords) => void
  onAddFavorite: () => void
  onRemoveFavorite: (id: string) => void
  onRemoveRecent: (id: string) => void
  onOpenMap?: () => void
}) {
  const [query, setQuery] = useState('')
  const [destMapOpen, setDestMapOpen] = useState(false)
  const [destMapSession, setDestMapSession] = useState(0)
  const [remotePlaces, setRemotePlaces] = useState<PlaceItem[]>([])
  const [searching, setSearching] = useState(false)
  const openDestMap = () => {
    setDestMapSession((value) => value + 1)
    setDestMapOpen(true)
  }
  const inputRef = useRef<HTMLInputElement>(null)
  const searchSeq = useRef(0)
  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(timer)
  }, [])
  const keyword = query.trim()
  useEffect(() => {
    if (!keyword) {
      setRemotePlaces([])
      setSearching(false)
      return
    }
    setRemotePlaces([])
    setSearching(true)
    const timer = window.setTimeout(() => {
      const seq = ++searchSeq.current
      void searchPlacesFromApi(keyword)
        .then((places) => {
          if (seq !== searchSeq.current) return
          setRemotePlaces(
            places
              .filter((place): place is NonNullable<typeof place> => place != null)
              .map((place) => ({
                name: place.name,
                address: place.address,
                jibun: place.jibun,
                category: place.category,
                kind: place.kind,
                hint: locationHint(place.address),
                lat: place.lat,
                lng: place.lng,
              })),
          )
          setSearching(false)
        })
        .catch(() => {
          if (seq !== searchSeq.current) return
          setRemotePlaces([])
          setSearching(false)
        })
    }, 180)
    return () => {
      window.clearTimeout(timer)
    }
  }, [keyword])
  const results = remotePlaces

  const pick = (name: string, address?: string, coords?: RideCoords) => {
    onSelect(name, address, coords)
    onClose()
  }

  const mapLat = finiteCoord(originLat, BUSAN_CITY_HALL.lat)
  const mapLng = finiteCoord(originLng, BUSAN_CITY_HALL.lng)

  return (
    <div className="fixed inset-0 z-[88] flex justify-center bg-[#E2E8F0]">
      <section className="flex h-full w-full max-w-md flex-col bg-[#F4F0FB]">
        <header className="border-b border-[#E0D4FF] bg-white px-4 pb-3 pt-5">
          <div className="flex items-start gap-2">
            <button type="button" onClick={onClose} className="mt-1.5 rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="검색 닫기">
              <X className="h-5 w-5" />
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex min-w-0 items-center gap-2 rounded-2xl border-2 border-[#4C1FB8] bg-[#F8F5FF] px-3 py-3">
                <Search className="h-5 w-5 shrink-0 text-[#4C1FB8]" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder || '목적지를 검색해 주세요'}
                  className="w-full bg-transparent text-sm font-extrabold text-[#0F172A] outline-none placeholder:text-[#64748B]"
                  aria-label="목적지 검색"
                />
                {query ? (
                  <button type="button" onClick={() => setQuery('')} className="text-[11px] font-black text-[#4C1FB8]" aria-label="검색어 지우기">
                    지우기
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={openDestMap}
                className="flex min-w-0 items-center gap-2 rounded-2xl border-2 border-[#4C1FB8] bg-[#F8F5FF] px-3 py-3 text-left"
              >
                <MapPin className="h-5 w-5 shrink-0 text-[#4C1FB8]" />
                <span className="w-full text-sm font-extrabold text-[#64748B]">지도에서 찾기</span>
              </button>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-8">
          {keyword ? (
            <div>
              <p className="text-xs font-black text-[#4C1FB8]">{searching ? '장소를 찾는 중' : `검색 결과 ${results.length}곳`}</p>
              <p className="mt-1 text-[11px] font-bold text-[#64748B]">{`‘${keyword}’ 검색 결과입니다. 같은 주소는 한 번만 보여주고, 주변 시설도 함께 띄워요.`}</p>
              {!searching && results.length === 0 ? <p className="mt-2 text-xs font-bold text-[#64748B]">검색된 장소가 없어요.</p> : null}
              <div className="mt-3 space-y-2">
                {results.map((place) => {
                  const coords =
                    Number.isFinite(place.lat) && Number.isFinite(place.lng)
                      ? { lat: place.lat as number, lng: place.lng as number, address: place.address }
                      : undefined
                  return (
                    <button key={`${place.name}-${place.address}-${place.lat}-${place.lng}`} type="button" onClick={() => pick(place.name, place.address, coords)} className="flex w-full items-start gap-3 rounded-[22px] border-2 border-[#E0D4FF] bg-white p-4 text-left shadow-[0_8px_18px_rgba(15,23,42,0.06)] active:scale-[0.99]">
                      <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${place.kind === 'parking' ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-[#EDE5FF] text-[#4C1FB8]'}`}>
                        {place.kind === 'parking' ? <SquareParking className="h-5 w-5" /> : <MapPin className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <strong className="break-words text-sm font-black text-[#0F172A]">{place.name}</strong>
                          {place.kind === 'parking' ? (
                            <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10px] font-black text-[#B45309]">{place.category || '주차장'}</span>
                          ) : place.category ? (
                            <span className="rounded-full bg-[#EDE5FF] px-2 py-0.5 text-[10px] font-black text-[#4C1FB8]">{place.category}</span>
                          ) : null}
                        </span>
                        <span className="mt-1 block break-words text-xs font-bold text-[#334155]">{place.address}</span>
                        {place.jibun && place.jibun !== place.address ? <span className="mt-0.5 block break-words text-[11px] font-bold text-[#64748B]">지번 {place.jibun}</span> : null}
                      </span>
                    </button>
                  )
                })}
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
                  <button type="button" onClick={openDestMap} className="rounded-[22px] border-2 border-dashed border-[#4C1FB8] bg-[#F8F5FF] p-4 text-left">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-[#4C1FB8]">
                      <MapPin className="h-5 w-5" />
                    </span>
                    <strong className="mt-3 block text-sm font-black text-[#4C1FB8]">지도에서 찾기</strong>
                    <span className="mt-1 block text-[11px] font-bold text-[#64748B]">핀을 옮겨 목적지 지정</span>
                  </button>
                  {onOpenMap ? (
                    <button type="button" onClick={onOpenMap} className="rounded-[22px] border-2 border-dashed border-[#94A3B8] bg-white p-4 text-left">
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#F1F5F9] text-[#4C1FB8]">
                        <LocateFixed className="h-5 w-5" />
                      </span>
                      <strong className="mt-3 block text-sm font-black text-[#0F172A]">내 위치</strong>
                      <span className="mt-1 block text-[11px] font-bold text-[#64748B]">현재 위치 지도 보기</span>
                    </button>
                  ) : null}
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
      {destMapOpen ? (
        <PlacePickerScreen
          key={`dest-map-${destMapSession}`}
          variant="dest"
          lat={mapLat}
          lng={mapLng}
          onClose={() => setDestMapOpen(false)}
          onConfirm={(place) => {
            pick(place.address, place.address, { lat: place.lat, lng: place.lng, address: place.address })
            setDestMapOpen(false)
          }}
        />
      ) : null}
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
  const [locationMapSession, setLocationMapSession] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const openLocationMap = () => {
    openFreshMapModal(setMapOpen, () => setLocationMapSession((value) => value + 1))
  }
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
  const select = (name: string, address?: string, _coords?: RideCoords) => {
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
        <button type="button" onClick={openLocationMap} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border-2 border-[#4C1FB8] bg-[#EDE5FF] px-4 py-2 text-xs font-black text-[#3B16A8] shadow-[0_6px_14px_rgba(76,31,184,0.18)] transition hover:bg-[#E0D4FF] active:scale-95">
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
          onOpenMap={openLocationMap}
        />
      ) : null}
      {mapOpen ? <LocationMapModal key={`search-loc-${locationMapSession}`} onClose={() => setMapOpen(false)} /> : null}
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
          <p className="text-xs font-bold text-[#475569]">보유 잔액 {balance.toFixed(7)} Pi</p>
          <p className="text-lg font-black text-[#4C1FB8]">{amount.toFixed(7)} Pi</p>
        </div>
        {!enough ? <p className="mt-2 text-xs font-black text-[#BE123C]">잔액이 부족합니다. 충전 후 결제해 주세요.</p> : null}
      </div>
      {enough ? (
        <BalanceCheckoutButton
          amount={amount}
          memo={`TaxiTago ${amount} Pi 결제`}
          metadata={{ kind: 'service-pay', label: '서비스 결제' }}
          className="w-full rounded-2xl bg-[#4C1FB8] py-4 font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)]"
          onPaid={() => onPay()}
        >
          {`Pi로 ${amount.toFixed(7)} 결제하기`}
        </BalanceCheckoutButton>
      ) : (
        <button type="button" onClick={onPay} className="w-full rounded-2xl bg-[#4C1FB8] py-4 font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)]">
          잔액 충전하기
        </button>
      )}
    </div>
  )
}

function InTripCancelConfirmModal({
  quoted,
  cancelFee,
  waived,
  driverPayout,
  settling,
  onKeep,
  onConfirm,
}: {
  quoted: number
  cancelFee: number
  waived: number
  driverPayout: number
  settling: boolean
  onKeep: () => void
  onConfirm: () => void
}) {
  return (
    <div className="pointer-events-auto fixed inset-0 z-[120] flex items-end bg-[#1e293b]/50 sm:items-center sm:p-4">
      <section className="pointer-events-auto mx-auto w-full max-w-md rounded-t-[30px] bg-white p-5 text-center shadow-2xl sm:rounded-[30px]" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
        <h2 className="text-2xl font-black text-[#0F172A]">이용 취소</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-[#334155]">운행 중 취소 시 취소 수수료가 부과될 수 있습니다. 정말 취소하시겠습니까?</p>
        <div className="mt-5 rounded-[22px] border-2 border-[#FECACA] bg-[#FEF2F2] p-4 text-left">
          <p className="text-xs font-black text-[#BE123C]">취소 수수료 정산</p>
          <p className="mt-2 text-[11px] font-bold leading-5 text-[#7F1D1D]">기사님의 이동 수고를 반영해 이용 요금의 일부가 위약금(취소 수수료)으로 기사에게 지급되고, 나머지는 청구되지 않습니다.</p>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs font-medium text-[#64748B]">운행 요금</span>
            <span className="text-sm font-bold text-[#64748B]">{quoted.toFixed(7)} Pi</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs font-bold text-[#BE123C]">취소 수수료 · 기사 지급</span>
            <span className="text-lg font-black text-[#BE123C]">{cancelFee.toFixed(7)} Pi</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[#64748B]">미청구 금액</span>
            <span className="text-sm font-bold text-[#047857]">{waived.toFixed(7)} Pi</span>
          </div>
          <p className="mt-3 text-[11px] font-bold text-[#7F1D1D]">기사 지급 {driverPayout.toFixed(7)} Pi · 미청구 {waived.toFixed(7)} Pi</p>
        </div>
        <button type="button" disabled={settling} onClick={onConfirm} className="mt-5 w-full rounded-2xl bg-[#BE123C] py-3.5 font-black text-white disabled:opacity-60">
          {settling ? '정산 중…' : '취소 수수료 내고 이용 취소'}
        </button>
        <button type="button" disabled={settling} onClick={onKeep} className="mt-3 w-full rounded-2xl border-2 border-[#CBD5E1] bg-white py-3.5 font-black text-[#475569]">
          운행 계속하기
        </button>
      </section>
    </div>
  )
}

function RideCompleteCancelBar({
  children,
  onCancel,
  hint,
}: {
  children?: ReactNode
  onCancel: () => void
  hint?: string
}) {
  return (
    <div className="sticky bottom-0 z-30 -mx-5 mt-3 space-y-2 border-t-2 border-[#FECDD3] bg-white px-5 pb-[max(0.9rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_20px_rgba(15,23,42,0.06)]">
      {children}
      <button
        type="button"
        onClick={onCancel}
        className="w-full rounded-2xl border-2 border-[#BE123C] bg-[#FFF1F2] py-3.5 text-base font-black text-[#BE123C] shadow-[0_4px_12px_rgba(190,18,60,0.12)]"
      >
        이용 취소
      </button>
      {hint ? <p className="text-center text-[11px] font-bold leading-5 text-[#BE123C]">{hint}</p> : null}
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
                <span className="text-sm font-semibold text-[#64748B] line-through">{estimated.toFixed(7)} Pi</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs font-bold text-[#0F172A]">실제 이용 요금</span>
                <span className="text-xl font-bold text-[#0F172A]">{amount.toFixed(7)} Pi</span>
              </div>
              <div className="mt-3 rounded-2xl bg-white px-3 py-3">
                <p className="text-[11px] font-semibold leading-5 text-[#334155]">실시간 주행 거리/시간에 따라 최종 요금이 산정되었습니다</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-[#4A82B8]">최종 청구 금액</span>
                  <span className="text-lg font-bold text-[#4A82B8]">{amount.toFixed(7)} Pi</span>
                </div>
              </div>
            </>
          ) : (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs font-medium text-[#64748B]">결제 금액</span>
              <span className="text-xl font-bold text-[#0F172A]">{amount.toFixed(7)} Pi</span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[#64748B]">결제 수단</span>
            <span className="text-sm font-bold text-[#0F172A]">Pi Network</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[#64748B]">남은 잔액</span>
            <span className="text-sm font-bold text-[#334155]">{remaining.toFixed(7)} Pi</span>
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
  onSettle: (amount: number, place: string, label: string, estimated: number | undefined, proof: { paymentId: string; txid: string }, rideId?: string) => void
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
  const place = destination.trim() ? destination : '선택한 목적지'
  const billed = isRidePayLabel(selectedService) ? settleRideFare(fare, `dest:${selectedService}:${place}`) : { estimate: fare, actual: fare }
  const callSelected = () => {
    if (!selectedService) return
    setMatchState('matching')
  }
  const confirmMatched = () => {
    setMatchState('matched')
    onNotice('기사 매칭이 완료되었습니다.')
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
            <h3 className="mt-5 text-xl font-black">기사님 매칭 대기 중</h3>
            <p className="mt-2 text-sm font-bold text-[#8b8495]">기사님이 콜을 수락할 때까지 이 화면을 유지합니다.</p>
            <button type="button" onClick={confirmMatched} className="mt-5 w-full rounded-2xl bg-[#4C1FB8] py-3.5 font-black text-white">
              매칭 완료 확인
            </button>
            <button onClick={cancelMatching} className="mt-3 w-full rounded-2xl border border-[#d8d1e5] bg-white py-3.5 font-black text-[#5f566d]">
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
            <BalanceCheckoutButton
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
            </BalanceCheckoutButton>
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


class MatchingMapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-[268px] items-center justify-center rounded-[24px] border-2 border-[#CBD5E1] bg-[#E2E8F0] px-4 text-center">
          <p className="rounded-full bg-white px-3 py-2 text-xs font-bold text-[#334155]">지도를 열지 못했어요. 아래 버튼은 그대로 사용할 수 있어요.</p>
        </div>
      )
    }
    return this.props.children
  }
}

function TaxiMatchingSheet({
  destination,
  pickupLat,
  pickupLng,
  waypoints,
  destLat,
  destLng,
  destAddress,
  pickupAddress,
  onClose,
  onNotice,
  balance,
  onPay,
  onSettle,
  onNeedCharge,
  onAskReview,
  onReceipt,
  onActivity,
  onRideSettled,
  onKeep,
  onEnd,
}: {
  destination: string
  pickupLat: number
  pickupLng: number
  waypoints?: RideCoords[]
  destLat: number
  destLng: number
  destAddress?: string
  pickupAddress: string
  onClose: () => void
  onNotice: (message: string) => void
  balance: number
  onPay: (amount: number, place: string, label: string, estimated?: number) => boolean | Promise<boolean>
  onSettle: (amount: number, place: string, label: string, estimated: number | undefined, proof: { paymentId: string; txid: string }, rideId?: string) => void
  onNeedCharge: () => void
  onAskReview: (target: RideReviewTarget) => void
  onReceipt: (ride: RideReceipt) => void
  onActivity?: (label: string, detail: string) => void
  onRideSettled?: (rideId: string, receipt: SettlementReceipt) => void
  onKeep?: () => void
  onEnd?: () => void
}) {
  const IS_TEST_MODE = true
  const [callOpen, setCallOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [ride, setRide] = useState<PublicRide | null>(null)
  const [matchError, setMatchError] = useState('')
  const passengerIdRef = useRef('')
  const rideIdRef = useRef(taxiSheetRideId)
  const matchedRef = useRef(false)
  // Single source of truth: progress phases are derived from the server ride record.
  const phase: TaxiMatchPhase =
    !ride || ride.status === 'searching' || ride.status === 'offered' || ride.status === 'unmatched'
      ? 'searching'
      : ride.readyToSettleAt
        ? 'moving'
        : ride.boardedAt
          ? 'boarding'
          : 'arriving'
  const matched = ride?.status === 'assigned' || ride?.status === 'completed'
  const dest = destination.trim() || '선택한 목적지'
  const live = resolveLiveRidePoints({
    originLat: pickupLat,
    originLng: pickupLng,
    destLat,
    destLng,
    originAddress: pickupAddress,
    destAddress,
    destLabel: dest,
  })
  const waypointSource: { lat?: number; lng?: number; address?: string; label?: string }[] =
    ride?.waypoints?.length ? ride.waypoints : (waypoints ?? [])
  const waypointLabels = waypointSource.map((wp) => wp.address || wp.label || '경유지')
  const route = rideRouteLabel(live.origin?.address || pickupAddress, dest, live.dest?.address || destAddress, waypointLabels)
  const mapWaypoints = waypointSource
    .filter((wp): wp is { lat: number; lng: number; address?: string; label?: string } => Number.isFinite(wp.lat) && Number.isFinite(wp.lng))
    .map((wp) => ({ lat: wp.lat, lng: wp.lng }))
  const [resolvedDest, setResolvedDest] = useState<RideCoords | null>(
    live.dest ? { lat: live.dest.lat, lng: live.dest.lng, address: live.dest.address } : null,
  )
  const [fareCfg, setFareCfg] = useState<FareConfig>(DEFAULT_FARE_CONFIG)
  useEffect(() => {
    void fetchFareConfig().then(setFareCfg).catch(() => undefined)
  }, [])
  const fare = ride?.estimatedFare ?? fareCfg.taxi.base
  const billed = settleRideFare(fare, ride?.id ?? route)
  const cancelSettlement = settleMidTripCancelFee(phase === 'moving' ? billed.actual : fare, { rate: fareCfg.cancel.rate / 100, min: fareCfg.cancel.min })
  const [accepting, setAccepting] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [cancelSettling, setCancelSettling] = useState(false)
  const settledRef = useRef(false)
  const payingRef = useRef(false)
  // 취소/종료된 세션 표시 — 취소 중 늦게 도착하는 create 응답이 좀비 콜을 남기지 않도록 한다.
  const endedRef = useRef(false)
  // 서버에서 먼저 완료된 운행의 정산 내역을 홈 '최근 이용'/활동 기록과 동기화한다.
  const settledSyncedRef = useRef('')
  const syncCompleted = useCallback(
    (rideId: string) => {
      if (!onRideSettled || !rideId || settledSyncedRef.current === rideId) return
      settledSyncedRef.current = rideId
      void fetchRideReceipt(rideId)
        .then((receipt) => {
          if (receipt) onRideSettled(rideId, receipt)
          else settledSyncedRef.current = ''
        })
        .catch(() => {
          settledSyncedRef.current = ''
        })
    },
    [onRideSettled],
  )
  const assigned = ride?.assignedDriver
  const driver = {
    name: assigned?.name || '배정 대기',
    vehicle: assigned?.vehicle || '택시',
    plate: assigned?.plate || '',
    rating: assigned?.rating || '5.00',
    eta: assigned ? `${assigned.etaMinutes}분` : '확인 중',
  }
  const statusLabel = phase === 'arriving' ? '기사 이동 중' : phase === 'boarding' ? '탑승 중' : '목적지 이동 중'
  const statusCaption =
    phase === 'arriving'
      ? `기사님이 ${driver.eta} 뒤 도착 예정이에요.`
      : phase === 'boarding'
        ? '탑승을 확인하고 목적지로 출발할 준비를 하고 있어요.'
        : `${dest}까지 안전하게 이동 중이에요.`

  const lockMatched = (next?: PublicRide | null) => {
    matchedRef.current = true
    if (next) setRide(next)
  }

  useEffect(() => {
    if (Number.isFinite(destLat) && Number.isFinite(destLng)) {
      setResolvedDest({ lat: destLat as number, lng: destLng as number, address: destAddress })
      writeRideSession({
        origin: live.origin ?? { lat: pickupLat, lng: pickupLng, address: pickupAddress },
        dest: { lat: destLat as number, lng: destLng as number, address: destAddress, label: dest },
      })
      return
    }
    let cancelled = false
    void resolveRidePlace(destination, pickupAddress).then((place) => {
      if (cancelled || !place) return
      setResolvedDest({ lat: place.lat, lng: place.lng, address: place.address })
      writeRideSession({ dest: { lat: place.lat, lng: place.lng, address: place.address, label: destination } })
    })
    return () => {
      cancelled = true
    }
  }, [destination, destLat, destLng, pickupAddress])

  const startNewRide = () => {
    const pickup = live.origin ?? { lat: pickupLat, lng: pickupLng, address: pickupAddress }
    const drop = resolvedDest ?? live.dest ?? { lat: destLat, lng: destLng, address: destAddress, label: dest }
    return createRideRequest({
      passengerId: passengerIdRef.current,
      kind: 'taxi',
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      pickupAddress: pickup.address,
      waypoints: (waypoints ?? []).filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lng)).slice(0, MAX_WAYPOINTS),
      destLat: drop.lat,
      destLng: drop.lng,
      destAddress: drop.address,
      destLabel: dest,
    })
  }

  useEffect(() => {
    let cancelled = false
    passengerIdRef.current = localPassengerId()
    const attach = (created: PublicRide) => {
      if (cancelled) return
      if (endedRef.current) {
        // 사용자가 생성 완료 전에 취소한 경우: 늦게 도착한 콜을 즉시 취소해 좀비 운행을 막는다.
        void cancelRideRequest(created.id, passengerIdRef.current || localPassengerId()).catch(() => undefined)
        return
      }
      taxiSheetRideId = created.id
      rideIdRef.current = created.id
      setRide(created)
      if (created.status === 'unmatched') setMatchError('지금은 배차 가능한 기사가 없어요.')
    }
    const createNew = () => {
      void startNewRide()
        .then((created) => {
          attach(created)
        })
        .catch((error) => {
          if (!cancelled && !endedRef.current) setMatchError(error instanceof Error ? error.message : '호출에 실패했어요.')
        })
    }
    if (taxiSheetRideId) {
      rideIdRef.current = taxiSheetRideId
      void fetchRideRequest(taxiSheetRideId).then((existing) => {
        if (cancelled) return
        // 이전 세션 id가 사라졌거나(조회 실패/404) 이미 종료된 경우 즉시 새 호출로 전환한다.
        if (!existing || existing.status === 'completed' || existing.status === 'cancelled') {
          if (existing?.status === 'completed') syncCompleted(existing.id)
          taxiSheetRideId = ''
          rideIdRef.current = ''
          writeStoredTaxi(null)
          createNew()
          return
        }
        attach(existing)
        if (existing.status === 'assigned') matchedRef.current = true
      }).catch(() => {
        // 조회 자체가 실패해도 세션을 버리지 않고 새 호출로 전환한다 —
        // 서버 dedupe가 살아있는 같은 콜을 돌려주므로 중복 생성되지 않는다.
        if (!cancelled) createNew()
      })
      return () => {
        cancelled = true
      }
    }
    createNew()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const rideId = ride?.id || rideIdRef.current
    if (!rideId) return
    const rank = (status: PublicRide['status']) =>
      status === 'completed' || status === 'cancelled' ? 2 : status === 'assigned' ? 1 : 0
    const apply = (next: PublicRide) => {
      if (next.status === 'cancelled') {
        endedRef.current = true
        taxiSheetRideId = ''
        rideIdRef.current = ''
        matchedRef.current = false
        writeStoredTaxi(null)
        onEnd?.()
        onClose()
        return
      }
      const setFresh = (incoming: PublicRide) =>
        setRide((current) => {
          if (!current || current.id !== incoming.id) return incoming
          if (rank(incoming.status) < rank(current.status)) return current
          const incomingLocked = incoming.escrow?.status === 'held' || incoming.escrow?.status === 'released'
          const knownLocked = current.escrow?.status === 'held' || current.escrow?.status === 'released'
          return {
            ...incoming,
            boardedAt: incoming.boardedAt ?? current.boardedAt ?? null,
            readyToSettleAt: incoming.readyToSettleAt ?? current.readyToSettleAt ?? null,
            escrow: knownLocked && !incomingLocked ? current.escrow : incoming.escrow,
          }
        })
      if (next.status === 'completed') {
        taxiSheetRideId = ''
        writeStoredTaxi(null)
        setFresh(next)
        syncCompleted(next.id)
        return
      }
      if (next.status === 'assigned') {
        if (!matchedRef.current) {
          matchedRef.current = true
          setRide(next)
          onActivity?.('배차 완료', `${next.assignedDriver?.name || '기사'} · ${route}`)
          onNotice('기사님이 콜을 수락했습니다. 탑승 후 이동을 시작해 주세요.')
          return
        }
        setFresh(next)
        return
      }
      setFresh(next)
      if (next.status === 'unmatched') setMatchError('주변 기사가 모두 응답하지 않아 배차에 실패했어요.')
    }
    const unsubscribe = subscribeRideLive(rideId, apply)
    const pull = () => {
      void fetchRideRequest(rideId).then((next) => {
        if (next) apply(next)
      }).catch(() => undefined)
    }
    const timer = window.setInterval(pull, 1500)
    window.addEventListener('online', pull)
    document.addEventListener('visibilitychange', pull)
    return () => {
      unsubscribe()
      window.clearInterval(timer)
      window.removeEventListener('online', pull)
      document.removeEventListener('visibilitychange', pull)
    }
  }, [ride?.id])

  const retryMatch = () => {
    if (accepting) return
    const staleId = ride?.id || rideIdRef.current
    setAccepting(true)
    setMatchError('')
    endedRef.current = false
    matchedRef.current = false
    settledRef.current = false
    payingRef.current = false
    settledSyncedRef.current = ''
    setRide(null)
    taxiSheetRideId = ''
    rideIdRef.current = ''
    writeStoredTaxi(null)
    // 이전 미배차 콜을 서버에서도 종료한다 — 기사가 늦게 온라인이 되면
    // unmatched가 다시 살아나 고스트 배차가 될 수 있다.
    if (staleId) void cancelRideRequest(staleId, passengerIdRef.current || localPassengerId()).catch(() => undefined)
    void startNewRide()
      .then((created) => {
        if (endedRef.current) {
          void cancelRideRequest(created.id, passengerIdRef.current || localPassengerId()).catch(() => undefined)
          return
        }
        taxiSheetRideId = created.id
        rideIdRef.current = created.id
        setRide(created)
        if (created.status === 'unmatched') setMatchError('지금은 배차 가능한 기사가 없어요. 다시 호출해 주세요.')
      })
      .catch((error) => {
        if (!endedRef.current) setMatchError(error instanceof Error ? error.message : '호출에 실패했어요.')
      })
      .finally(() => setAccepting(false))
  }

  const cancelRide = () => {
    endedRef.current = true
    const rideId = ride?.id || rideIdRef.current
    taxiSheetRideId = ''
    rideIdRef.current = ''
    matchedRef.current = false
    payingRef.current = false
    settledRef.current = false
    writeStoredTaxi(null)
    setMatchError('')
    setAccepting(false)
    setCancelConfirmOpen(false)
    setCancelSettling(false)
    if (rideId) void cancelRideRequest(rideId, passengerIdRef.current || localPassengerId()).catch(() => undefined)
    onActivity?.(matched ? '배차 취소' : '택시 호출 취소', route)
    onNotice(matched ? '배차를 취소했어요.' : '택시 호출을 취소했어요.')
    onEnd?.()
    onClose()
  }

  const confirmInTripCancel = async () => {
    if (cancelSettling || payingRef.current) return
    payingRef.current = true
    endedRef.current = true
    const rideId = ride?.id || rideIdRef.current
    if (!rideId) {
      taxiSheetRideId = ''
      rideIdRef.current = ''
      writeStoredTaxi(null)
      setCancelConfirmOpen(false)
      onEnd?.()
      onClose()
      return
    }
    setCancelSettling(true)
    try {
      const finished = await cancelRideRequest(rideId, passengerIdRef.current, { settleFee: true })
      if (finished?.status === 'completed') {
        onNotice('운행이 이미 완료되어 취소되지 않았어요. 영수증으로 정산 내역을 확인해 주세요.')
      } else {
        onActivity?.('이용 취소', `취소 수수료 ${cancelSettlement.cancelFee.toFixed(7)} Pi · 미청구 ${cancelSettlement.waived.toFixed(7)} Pi`)
        onNotice(
          `운행을 취소했습니다. 취소 수수료 ${cancelSettlement.cancelFee.toFixed(7)} Pi가 기사님께 지급되었고, 나머지 ${cancelSettlement.waived.toFixed(7)} Pi는 청구되지 않습니다.`,
        )
      }
    } catch (error) {
      console.error('[cancel] passenger taxi', error)
      onNotice(error instanceof Error ? error.message : '취소 처리 중 문제가 생겼지만 홈으로 돌아갑니다.')
    } finally {
      taxiSheetRideId = ''
      rideIdRef.current = ''
      writeStoredTaxi(null)
      setCancelConfirmOpen(false)
      setCancelSettling(false)
      onEnd?.()
      onClose()
    }
  }

  const acceptPendingOffer = () => {
    const rideId = ride?.id || rideIdRef.current
    if (!rideId || accepting || matched) return
    setAccepting(true)
    setMatchError('')
    void acceptRideOnDevice(
      rideId,
      ride
        ? {
            passengerId: ride.passengerId,
            pickup: ride.pickup,
            dest: ride.dest,
            estimatedFare: ride.estimatedFare,
            kind: ride.kind,
          }
        : undefined,
      localDriverId(loadPartnerProfile()?.uid),
    )
      .then((next) => {
        if (next.status !== 'assigned' && next.status !== 'completed') {
          throw new Error('배차가 완료되지 않았어요. 다시 수락해 주세요.')
        }
        lockMatched(next)
        onActivity?.('배차 완료', `${next.assignedDriver?.name || '기사'} · ${route}`)
        onNotice('기사님이 콜을 수락했습니다. 탑승 후 이동을 시작해 주세요.')
      })
      .catch((error) => {
        onNotice(error instanceof Error ? error.message : '콜 수락에 실패했어요. 배차 화면에서 계속 진행할 수 있습니다.')
      })
      .finally(() => setAccepting(false))
  }

  const confirmRideProgress = (step: 'boarded' | 'arrived') => {
    const rideId = ride?.id || rideIdRef.current
    if (!rideId || accepting) return
    setAccepting(true)
    void markRideProgress(rideId, ride?.passengerId || passengerIdRef.current || localPassengerId(), step, ride)
      .then((next) => {
        setRide(next)
        onNotice(step === 'boarded' ? '탑승을 확인했어요. 목적지에 도착하면 도착 확인을 눌러 주세요.' : '목적지 도착을 확인했어요. 이제 정산할 수 있어요.')
      })
      .catch((error) => onNotice(error instanceof Error ? error.message : '운행 상태를 저장하지 못했어요.'))
      .finally(() => setAccepting(false))
  }

  const finishPassengerTrip = () => {
    if (accepting || payingRef.current || settledRef.current) return
    if (!ride?.readyToSettleAt) {
      onNotice(ride?.boardedAt ? '목적지에 도착한 뒤에 이용 완료를 눌러 주세요.' : '탑승 확인과 목적지 도착 확인 후에 이용 완료를 눌러 주세요.')
      return
    }
    payingRef.current = true
    setAccepting(true)
    const amount = phase === 'moving' ? billed.actual : fare
    const openPayReceipt = (paymentId: string, txid: string) => {
      if (settledRef.current) return
      settledRef.current = true
      onSettle(amount, route, '택시 결제', billed.estimate, { paymentId, txid }, ride?.id)
    }
    const releasePayLock = () => {
      payingRef.current = false
      setAccepting(false)
    }
    const driverId = ride?.assignedDriver?.id
    if (!ride) {
      openPayReceipt(`pay-${Date.now()}`, `done-${Date.now()}`)
      return
    }
    if (!driverId) {
      // 서버에 운행이 있는데 배정 기사가 확인되지 않은 상태에서 완료 처리를
      // 건너뛰면 기사 화면은 'assigned' 카드에 영구히 갇힌다.
      onNotice('배정된 기사 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')
      releasePayLock()
      return
    }
    const abort = new AbortController()
    const timeout = window.setTimeout(() => abort.abort(), 60000)
    void (async () => {
      let proof: { paymentId: string; txid: string } | undefined
      if (ride.escrow?.status !== 'held' && ride.escrow?.status !== 'released') {
        // 앱 잔액에서 즉시 차감 — Pi SDK는 충전/출금에서만 쓰고 운행 요금은
        // 서버 잔액 장부가 권위다. 차감이 성공하면 서버가 에스크로를 잠근다.
        try {
          proof = await payFromBalance({ purpose: 'ride', rideId: ride.id, amount, label: '택시' })
        } catch (error) {
          if (!PI_SANDBOX) throw error
          // 테스트넷에서는 잔액이 없어도 완료 흐름을 검증할 수 있게 기존 모의 잠금을 유지한다.
          await lockRideEscrow({
            rideId: ride.id,
            passengerId: ride.passengerId,
            sandbox: true,
          }).catch(() => undefined)
        }
      }
      const result = await completeRideTrip(
        ride.id,
        driverId,
        proof
          ? {
              ...ride,
              escrow: {
                status: 'held',
                amount,
                lockTxid: proof.txid,
                lockPaymentId: proof.paymentId,
                payoutTxid: null,
                payoutWallet: null,
              } as PublicRide['escrow'],
            }
          : ride,
        { signal: abort.signal },
      )
      return { result, proof }
    })()
      .then(({ result, proof }) => {
        if (result.ride) setRide(result.ride)
        const txid = result.receipt?.payoutTxid || result.ride?.escrow?.payoutTxid || proof?.txid || `done-${ride.id.slice(0, 8)}`
        const paymentId = proof?.paymentId || result.receipt?.lockTxid || result.ride?.escrow?.lockTxid || txid
        openPayReceipt(paymentId, txid)
        onAskReview({
          rideId: ride.id,
          raterId: passengerIdRef.current || localPassengerId(),
          raterRole: 'passenger',
          targetName: assigned?.name || '기사',
          vehicle: assigned?.vehicle,
          plate: assigned?.plate,
        })
      })
      .catch((error) => {
        const timedOut = error instanceof Error && error.name === 'AbortError'
        onNotice(timedOut ? '정산 응답이 지연되고 있어요. 다시 눌러 주세요.' : error instanceof Error ? error.message : '정산에 실패했어요. 다시 한 번만 눌러 주세요.')
        releasePayLock()
      })
      .finally(() => window.clearTimeout(timeout))
  }

  useEffect(() => {
    if (ride?.id) onKeep?.()
  }, [ride?.id, phase])

  const openCompletedReceipt = () => {
    if (!ride || settledRef.current) return
    settledRef.current = true
    void fetchRideReceipt(ride.id).then((receipt) => {
      if (receipt) {
        onRideSettled?.(ride.id, receipt)
        onReceipt(receiptFromSettlement(receipt))
        onAskReview({
          rideId: ride.id,
          raterId: passengerIdRef.current,
          raterRole: 'passenger',
          targetName: receipt.driverName,
          vehicle: receipt.vehicle,
          plate: receipt.plate,
        })
      }
      onNotice('운행이 완료되었습니다. 영수증을 확인하세요.')
      onClose()
    }).catch(() => {
      settledRef.current = false
      onNotice('영수증을 불러오지 못했어요. 다시 눌러 주세요.')
    })
  }

  const escrowStatus = ride?.escrow?.status
  const escrowAmount = ride?.escrow?.amount ?? fare
  const rideDispatched = ride?.status === 'assigned' || ride?.status === 'completed'
  const showMatching = phase === 'searching' || !rideDispatched

  return (
    <div className="fixed inset-x-0 bottom-0 top-[var(--app-header-offset)] z-50 flex touch-none items-stretch overflow-hidden bg-[#241d35]/50">
      <section className="relative mx-auto flex h-[calc(100dvh-var(--app-header-offset))] max-h-[calc(100dvh-var(--app-header-offset))] w-full max-w-md flex-col overflow-hidden rounded-t-[32px] bg-white shadow-[0_-18px_40px_rgba(36,27,56,0.22)]">
        <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-5 pb-4 pt-3">
        <div className="pointer-events-none mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#ddd7e7]" aria-hidden />
        {showMatching ? (
          <div className="pb-4 pt-2 text-center">
            <p className="text-xs font-black text-[#4C1FB8]">LIVE MATCHING</p>
            <h2 className="mt-2 text-2xl font-black text-[#0F172A]">기사님 매칭 대기 중</h2>
            <p className="mt-2 text-sm font-bold text-[#64748B]">{route}</p>
            {ride ? <p className="mt-1 text-xs font-black text-[#4C1FB8]">예상 요금 {ride.estimatedFare.toFixed(7)} Pi</p> : null}
            {Number(ride?.avoidSurchargePi || 0) > 0 ? (
              <p className="mt-1 text-[11px] font-bold text-[#B45309]">기피 지역 할증 +{Number(ride?.avoidSurchargePi).toFixed(7)} Pi 포함</p>
            ) : null}
            {ride?.pendingOffer ? (
              <p className="mt-2 text-sm font-bold text-[#4C1FB8]">{ride.pendingOffer.driverName} 기사님에게 콜을 요청했어요. 수락을 기다리는 중입니다.</p>
            ) : (
              <p className="mt-2 text-sm font-bold text-[#64748B]">주변 기사님에게 호출을 보내고 있어요.</p>
            )}
            {matchError ? <p className="mt-2 text-xs font-bold text-[#B91C1C]">{matchError}</p> : null}
            <div className="pointer-events-auto relative z-0 isolate overflow-hidden">
              <MatchingMapBoundary>
                <TaxiLiveMap
                  kind="taxi"
                  phase="arriving"
                  journeyLabel="매칭 대기 중"
                  routeLabel={route}
                  statusLabel="매칭 대기 중"
                  originLat={live.origin?.lat ?? pickupLat}
                  originLng={live.origin?.lng ?? pickupLng}
                  destLat={destLat}
                  destLng={destLng}
                  originLabel={live.origin?.address || pickupAddress}
                  destLabel={resolvedDest?.address || live.dest?.address || dest}
                  waypoints={mapWaypoints}
                  {...liveVehicleFromRide(ride)}
                />
              </MatchingMapBoundary>
            </div>
            <p className="mt-6 text-xs font-bold text-[#8b8495]">기사님이 콜을 수락하면 실시간 위치가 지도에 표시됩니다. 테스트는 아래 버튼으로 바로 수락할 수 있습니다.</p>
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
            <TaxiLiveMap
              kind="taxi"
              phase={toTaxiLivePhase(phase)}
              routeLabel={route}
              statusLabel={statusLabel}
              originLat={live.origin?.lat ?? pickupLat}
              originLng={live.origin?.lng ?? pickupLng}
              destLat={destLat}
              destLng={destLng}
              originLabel={live.origin?.address || pickupAddress}
              destLabel={resolvedDest?.address || live.dest?.address || dest}
              waypoints={mapWaypoints}
              {...liveVehicleFromRide(ride)}
            />
            <div className="mt-4 rounded-[24px] border-2 border-[#E0D4FF] bg-[#F8F5FF] p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#4C1FB8] font-black text-white">{driver.name.slice(0, 1)}</div>
                <div className="min-w-0 flex-1">
                  <p className="font-black text-[#0F172A]">
                    {driver.name} 기사님 <span className="ml-1 text-xs text-[#CA8A04]">★ {driver.rating}</span>
                  </p>
                  <p className="mt-1 text-xs font-bold text-[#475569]">배차가 완료되었습니다</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white px-3 py-2.5">
                  <p className="text-[10px] font-bold text-[#8b8495]">차량명</p>
                  <p className="mt-1 text-sm font-black text-[#0F172A]">{driver.vehicle && driver.vehicle !== '택시' ? driver.vehicle : '확인 중'}</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-2.5">
                  <p className="text-[10px] font-bold text-[#8b8495]">차량번호</p>
                  <p className="mt-1 text-sm font-black tracking-wide text-[#0F172A]">{driver.plate && driver.plate !== '미등록' ? driver.plate : '확인 중'}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">예상 도착</p>
                  <p className="mt-1 text-sm font-black text-[#4C1FB8]">{phase === 'arriving' ? `${driver.eta} 후` : phase === 'boarding' ? '탑승 확인' : '이동 중'}</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">{phase === 'moving' ? '실제 이용 요금' : '예상 요금'}</p>
                  <p className="mt-1 text-sm font-black text-[#0F172A]">{(phase === 'moving' ? billed.actual : fare).toFixed(7)} Pi</p>
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
              {ride?.id ? (
                <div className="mt-2">
                  <RideSosButton
                    rideId={ride.id}
                    actorId={passengerIdRef.current || localPassengerId()}
                    role="passenger"
                    fallbackLat={live.origin?.lat ?? pickupLat}
                    fallbackLng={live.origin?.lng ?? pickupLng}
                    vehicle={driver.vehicle}
                    plate={driver.plate}
                    onNotice={onNotice}
                  />
                </div>
              ) : null}
            </div>
            <div className="mt-4 space-y-2">
              {/* TODO [정식 서비스 오픈 시 전환 필수]: 현재는 테스트용 수동 트리거임. 정식 오픈 시 기사 모드 서버/웹소켓 신호 수신 시 자동으로 넘어가도록 연동 필요 */}
              {phase === 'arriving' && (
                <button type="button" disabled={accepting} onClick={() => confirmRideProgress('boarded')} className="w-full rounded-2xl border-2 border-[#4C1FB8] bg-white py-3 font-black text-[#4C1FB8] disabled:opacity-60">
                  {accepting ? '확인 중…' : '탑승 확인'}
                </button>
              )}
              {phase === 'boarding' && (
                <button type="button" disabled={accepting} onClick={() => confirmRideProgress('arrived')} className="w-full rounded-2xl border-2 border-[#4C1FB8] bg-white py-3 font-black text-[#4C1FB8] disabled:opacity-60">
                  {accepting ? '확인 중…' : '목적지 도착'}
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
              <div className="rounded-[22px] border-2 border-[#BFDBFE] bg-[#F8FAFC] px-4 py-3 text-center">
                <p className="text-[11px] font-black text-[#4A82B8]">
                  {escrowStatus === 'held' ? '에스크로 보관 중' : escrowStatus === 'released' ? '기사 지갑 정산 완료' : '이용 완료 시 결제'}
                </p>
                <p className="mt-1 text-lg font-black text-[#0F172A]">{escrowAmount.toFixed(7)} Pi</p>
                <p className="mt-1 text-[11px] font-bold leading-5 text-[#64748B]">
                  {escrowStatus === 'held' || escrowStatus === 'released'
                    ? '기사님이 운행 완료를 승인하면 등록된 Pi 지갑으로 자동 이체됩니다.'
                    : '목적지 도착 후 이용 완료를 누르면 결제되고 기사님께 정산됩니다.'}
                </p>
              </div>
              <p className="text-center text-[11px] font-bold text-[#64748B]">목적지 도착 후 아래에서 이용 완료 또는 취소를 눌러 주세요</p>
            </div>
          </div>
        )}
        </div>
        {showMatching ? (
          <div className="pointer-events-auto relative z-[80] shrink-0 space-y-3 border-t border-[#E2E8F0] bg-white px-5 py-4">
            {matchError ? (
              <button
                type="button"
                disabled={accepting}
                onClick={retryMatch}
                className="pointer-events-auto w-full rounded-2xl bg-[#4C1FB8] py-3.5 font-black text-white disabled:opacity-60"
              >
                {accepting ? '다시 호출 중…' : '다시 호출'}
              </button>
            ) : null}
            {IS_TEST_MODE ? (
              <button
                type="button"
                disabled={accepting || !ride}
                onClick={acceptPendingOffer}
                className="pointer-events-auto w-full rounded-2xl bg-[#4C1FB8] py-3.5 font-black text-white disabled:opacity-60"
              >
                {accepting ? '수락 중…' : '이 기기에서 기사 콜 수락'}
              </button>
            ) : null}
            <button type="button" onClick={cancelRide} className="pointer-events-auto w-full rounded-2xl border-2 border-[#CBD5E1] bg-white py-3.5 font-black text-[#475569]">
              호출 취소
            </button>
            <button type="button" onClick={onClose} className="pointer-events-auto w-full rounded-2xl py-2 text-sm font-black text-[#64748B]">
              이전 화면으로
            </button>
          </div>
        ) : (
          <div className="pointer-events-auto relative z-[80] shrink-0 border-t border-[#FECDD3] bg-white px-5 py-4">
            {ride?.status === 'completed' ? (
              <button type="button" onClick={openCompletedReceipt} className="pointer-events-auto w-full rounded-2xl bg-[#4C1FB8] py-3.5 font-black text-white">
                운행 종료 · 영수증 보기
              </button>
            ) : (
              <RideCompleteCancelBar onCancel={() => setCancelConfirmOpen(true)}>
                <button type="button" disabled={accepting || !ride?.readyToSettleAt} aria-busy={accepting} onClick={finishPassengerTrip} className="pointer-events-auto w-full rounded-2xl bg-[#047857] py-4 text-lg font-black text-white disabled:cursor-not-allowed disabled:opacity-60">
                  {accepting ? '결제 진행 중…' : ride?.readyToSettleAt ? '이용 완료' : ride?.boardedAt ? '목적지 도착 후 완료 가능' : '탑승 확인 후 진행'}
                </button>
              </RideCompleteCancelBar>
            )}
          </div>
        )}
      </section>
      {callOpen && ride?.id ? (
        <RideSafeCall
          rideId={ride.id}
          actorId={passengerIdRef.current || localPassengerId()}
          role="passenger"
          peerName={`${driver.name} 기사님`}
          onHangup={() => setCallOpen(false)}
        />
      ) : null}
      {chatOpen && ride?.id ? (
        <RideChat
          rideId={ride.id}
          actorId={passengerIdRef.current || localPassengerId()}
          role="passenger"
          peerName={`${driver.name} 기사님`}
          onClose={() => setChatOpen(false)}
        />
      ) : null}
      <RideCommsAlerts
        rideId={ride?.status === 'assigned' ? ride.id : null}
        actorId={passengerIdRef.current || localPassengerId()}
        role="passenger"
        peerName={`${driver.name} 기사님`}
        chatOpen={chatOpen}
        callOpen={callOpen}
        onOpenChat={() => setChatOpen(true)}
        onOpenCall={() => setCallOpen(true)}
      />
      {cancelConfirmOpen && !showMatching && ride?.status !== 'completed' ? (
        <InTripCancelConfirmModal
          quoted={cancelSettlement.quoted}
          cancelFee={cancelSettlement.cancelFee}
          waived={cancelSettlement.waived}
          driverPayout={cancelSettlement.driverPayout}
          settling={cancelSettling}
          onKeep={() => setCancelConfirmOpen(false)}
          onConfirm={() => void confirmInTripCancel()}
        />
      ) : null}
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
  const { t } = useLocale()
  const [view, setView] = useState<MoreItemId | 'menu' | `notice:${string}` | `terms:${string}`>('menu')
  const [preparingOpen, setPreparingOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [view])
  return (
    <div ref={scrollRef} className="fixed inset-0 z-[96] overflow-y-auto overscroll-y-contain bg-[#241d35]/45 [-webkit-overflow-scrolling:touch]" onClick={onClose}>
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col">
      <section
        className={`mt-auto w-full overflow-hidden rounded-t-[32px] pt-3 shadow-[0_-16px_40px_rgba(36,27,56,0.2)] ${
          view === 'terms' || view.startsWith('terms:') ? 'bg-[#F5F6F8] px-0 pb-0' : 'bg-white px-5 pb-8'
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 shrink-0 rounded-full bg-[#ddd7e7]" />
        {view === 'menu' ? (
          <>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-black text-[#4C1FB8]">TAXITAGO SERVICE</p>
                <h2 className="mt-1 text-2xl font-black">{t('more.hub')}</h2>
              </div>
              <button type="button" onClick={onClose} className="rounded-full bg-[#f4f1f8] p-2 text-[#5f566d]" aria-label={t('more.close')}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))]">
              <p className="mb-2 mt-4 text-xs font-black text-[#475569]">{t('more.mobility')}</p>
              <div className="rounded-[22px] bg-[#E2E8F0] p-3">
                <div className="grid grid-cols-4 gap-x-2 gap-y-4">
                  {menuMobilityServices(false).map((item) => (
                    <ServiceIconButton
                      key={item.label}
                      service={item}
                      wrapLabel={isComingSoonService(item.label)}
                      onClick={() => {
                        if (isComingSoonService(item.label)) {
                          setPreparingOpen(true)
                          return
                        }
                        onSelectService(item.label)
                      }}
                    />
                  ))}
                </div>
              </div>
              <p className="mb-2 mt-5 text-xs font-black text-[#8b8495]">{t('more.guide')}</p>
              <div className="-mt-5">
                <MoreMenu onOpen={setView} />
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
        ) : view === 'terms' ? (
          <TermsListView onBack={() => setView('menu')} onOpen={(id) => setView(`terms:${id}`)} />
        ) : view.startsWith('terms:') ? (
          <TermsDetailView id={view.slice(6)} onBack={() => setView('terms')} />
        ) : (
          <SettingsView onBack={() => setView('menu')} onNotice={onNotice} />
        )}
      </section>
      </div>
      {preparingOpen ? <ServicePreparingModal onClose={() => setPreparingOpen(false)} /> : null}
    </div>
  )
}

function ServiceSheet({
  service,
  pickupLat,
  pickupLng,
  pickupAddress,
  destLat,
  destLng,
  destAddress,
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
  onRequireRoute,
  onDeliveryCreated,
  onActivity,
  onRideSettled,
}: {
  service: string
  pickupLat: number
  pickupLng: number
  pickupAddress: string
  destLat?: number
  destLng?: number
  destAddress?: string
  onClose: () => void
  onNotice: (message: string) => void
  balance: number
  onPay: (amount: number, place: string, label: string, estimated?: number) => boolean | Promise<boolean>
  onSettle: (amount: number, place: string, label: string, estimated: number | undefined, proof: { paymentId: string; txid: string }, rideId?: string) => void
  onNeedCharge: () => void
  onAskReview: (driver: { name: string; vehicle: string; plate: string }) => void
  initialPhase?: 'idle' | 'matching' | 'assigned'
  daeriTrip?: DaeriTrip | null
  onSelectService?: (label: string) => void
  onRequireRoute?: (kind: RouteGap) => void
  onDeliveryCreated?: (job: DeliveryJob) => void
  onActivity?: (label: string, detail: string) => void
  onRideSettled?: (rideId: string, receipt: SettlementReceipt) => void
}) {
  const { t } = useLocale()
  const IS_TEST_MODE = true
  const [phase, setPhase] = useState<'idle' | 'matching' | 'assigned'>(initialPhase)
  const [courier, setCourier] = useState<{ name: string; vehicle: string; plate: string } | null>(null)
  const deliveryServerId = useRef('')
  const [dispatchRide, setDispatchRide] = useState<PublicRide | null>(null)
  const [daeriMatchError, setDaeriMatchError] = useState('')
  const [daeriAccepting, setDaeriAccepting] = useState(false)
  const daeriPassengerIdRef = useRef('')
  const daeriRideIdRef = useRef(daeriSheetRideId)
  const daeriAcceptedRef = useRef(false)
  // 취소/종료된 세션 표시 — 늦게 도착하는 create 응답이 좀비 콜을 남기지 않도록 한다.
  const daeriEndedRef = useRef(false)
  const [deliveryVehicle, setDeliveryVehicle] = useState<DeliveryVehicle>('오토바이')
  const [packageSize, setPackageSize] = useState<PackageSizeId>('document')
  const [senderPhone, setSenderPhone] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [selectedItem, setSelectedItem] = useState('')
  const [mapFocusId, setMapFocusId] = useState('')
  const [qrOpen, setQrOpen] = useState(false)
  const [qrScanned, setQrScanned] = useState(false)
  const [parkingOption, setParkingOption] = useState<'prepaid' | 'postpaid'>('prepaid')
  const [prepaidSettled, setPrepaidSettled] = useState(false)
  // Derived from the server ride record — the single source of truth for progress.
  const rideStage: 'arriving' | 'moving' = dispatchRide?.boardedAt || dispatchRide?.readyToSettleAt ? 'moving' : 'arriving'
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [cancelSettling, setCancelSettling] = useState(false)
  const cancelLockRef = useRef(false)
  const [preparingOpen, setPreparingOpen] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [deviceFormOpen, setDeviceFormOpen] = useState(false)
  const finishedRef = useRef(false)
  const rentalSerialRef = useRef('')
  // 서버에서 먼저 완료된 운행의 정산 내역을 홈 '최근 이용'/활동 기록과 동기화한다.
  const daeriSettledSyncedRef = useRef('')
  const syncDaeriCompleted = useCallback(
    (rideId: string) => {
      if (!onRideSettled || !rideId || daeriSettledSyncedRef.current === rideId) return
      daeriSettledSyncedRef.current = rideId
      void fetchRideReceipt(rideId)
        .then((receipt) => {
          if (receipt) onRideSettled(rideId, receipt)
          else daeriSettledSyncedRef.current = ''
        })
        .catch(() => {
          daeriSettledSyncedRef.current = ''
        })
    },
    [onRideSettled],
  )
  const paymentPolicy = getPaymentPolicy(service)
  const ride = service === '대리운전'
  const vehicle = service === '자전거' || service === '킥보드'
  const more = service === '더보기'
  const selfServe = service === '주차' || service === '자전거' || service === '킥보드' || service === 'EV 충전'
  const nearbyKind = nearbyKindFromService(service)
  const [livePartners, setLivePartners] = useState<RegisteredNearbyPartner[]>([])
  useEffect(() => {
    const load = () => {
      const spot = partnerListingFromProfile(loadPartnerProfile(), service, pickupLat, pickupLng)
      const devices = vehicle ? mobilityPartnersForService(service) : []
      setLivePartners([...(spot ? [spot] : []), ...devices])
    }
    load()
    window.addEventListener(MOBILITY_DEVICES_EVENT, load)
    return () => window.removeEventListener(MOBILITY_DEVICES_EVENT, load)
  }, [service, pickupLat, pickupLng, vehicle])
  const nearbySpots = nearbyKind
    ? listNearbyServiceSpots(nearbyKind, pickupLat, pickupLng, nearbyKind === 'bike' || nearbyKind === 'scooter' ? 7 : 6, livePartners)
    : []
  const catalog = nearbySpots.map((item) => {
    const registered = item.id.startsWith('device-')
    const rentable = !registered || item.rentable === true
    return {
      id: item.id,
      name: item.name,
      distance: item.distanceLabel,
      extra: item.extra,
      rate: item.rate,
      available: item.listing === 'partner' && rentable && (!item.statusLabel || item.statusLabel === '이용 가능'),
      statusLabel: registered ? item.statusLabel : undefined,
      rentable,
    }
  })
  const selectedUsage = catalog.find((item) => item.id === selectedItem) ?? catalog[0]
  const packageOption = getPackageSize(packageSize)
  const deliveryFare = estimateDeliveryFare(deliveryVehicle, packageSize)
  const listedPi = Number(selectedUsage?.rate.match(/(\d+(?:\.\d+)?)/)?.[1])
  const [daeriFareCfg, setDaeriFareCfg] = useState<FareConfig>(DEFAULT_FARE_CONFIG)
  useEffect(() => {
    void fetchFareConfig().then(setDaeriFareCfg).catch(() => undefined)
  }, [])
  const policyBase = (key: FlatServiceId) => getPaymentPolicy(FLAT_SERVICE_LABEL[key])?.defaultAmount ?? daeriFareCfg.flatBase[key]
  const fare = ride ? (dispatchRide?.estimatedFare ?? daeriTrip?.fare ?? daeriFareCfg.daeri.base) : service === '주차' ? policyBase('parking') : service === 'EV 충전' ? policyBase('ev') : vehicle ? (Number.isFinite(listedPi) && listedPi > 0 ? listedPi : policyBase('bicycle')) : deliveryFare
  const settleTiming = service === '주차' ? parkingOption : paymentPolicy?.timing
  const rideOriginLat = daeriTrip?.pickupLat ?? pickupLat
  const rideOriginLng = daeriTrip?.pickupLng ?? pickupLng
  const rideDestLat = daeriTrip?.destLat ?? destLat
  const rideDestLng = daeriTrip?.destLng ?? destLng
  const place = ride
    ? rideRouteLabel(
        daeriTrip?.pickup || pickupAddress,
        daeriTrip?.dest || destAddress || '목적지',
        undefined,
        (daeriTrip?.waypoints ?? []).map((wp) => wp.address || ''),
      )
    : selectedUsage?.name || `${pickupAddress || '현재 위치'} → ${service} 이용`
  const billed = ride ? settleRideFare(fare, `daeri:${place}`) : { estimate: fare, actual: fare, adjusted: false }
  const chargeAmount = ride ? billed.actual : fare
  const cancelSettlement = settleMidTripCancelFee(billed.actual, { rate: daeriFareCfg.cancel.rate / 100, min: daeriFareCfg.cancel.min })
  const partner =
    ride
      ? {
          name: dispatchRide?.assignedDriver?.name || '배정 대기',
          vehicle: dispatchRide?.assignedDriver?.vehicle || '대리운전',
          plate: dispatchRide?.assignedDriver?.plate || '파이 모빌리티',
          kind: 'driver' as const,
        }
      : service === '택배'
        ? { name: courier?.name || '배정 대기', vehicle: courier?.vehicle || '확인 중', plate: courier?.plate || '확인 중', kind: 'driver' as const }
        : { name: selectedUsage?.name || service, vehicle: service, plate: selectedUsage?.rate || '', kind: 'service' as const }
  const contactRideId = ride ? dispatchRide?.id || daeriRideIdRef.current : ''
  const canStart = more || ride || service === '택배' || Boolean(selectedItem)
  const selectedDevice = vehicle && selectedItem.startsWith('device-') ? findDeviceBySpotId(selectedItem) : null
  const selectedRentable = !selectedDevice || isDeviceRentable(selectedDevice)
  useEffect(() => {
    if (!selfServe || !nearbySpots.length) return
    if (nearbySpots.some((item) => item.id === selectedItem)) return
    const next = phase === 'idle'
      ? nearbySpots.find((item) => !(vehicle && item.id.startsWith('device-') && item.rentable === false)) ?? nearbySpots[0]
      : nearbySpots[0]
    if (next.id !== selectedItem) setSelectedItem(next.id)
  }, [selfServe, vehicle, phase, nearbySpots, selectedItem])
  const action = (message: string) => {
    onNotice(message)
    onClose()
  }
  const releaseRental = () => {
    const selected = selectedItem.startsWith('device-') ? findDeviceBySpotId(selectedItem) : null
    const serial = rentalSerialRef.current || (selected?.status === 'rented' ? selected.serial : '')
    if (!serial) return
    rentalSerialRef.current = ''
    setMobilityDeviceStatus(serial, 'available')
  }
  const startService = (scanned?: boolean) => {
    if (service === '택배' || ride) {
      const gap = routeGap(daeriTrip?.pickup || pickupAddress, daeriTrip?.dest || destAddress)
      if (gap) {
        onRequireRoute?.(gap)
        return
      }
    }
    if (service === '택배') {
      if (!isValidKoreanPhone(senderPhone) || !isValidKoreanPhone(recipientPhone)) {
        setPhoneError('발신인과 수신인 연락처를 올바르게 입력해 주세요.')
        return
      }
      const job: DeliveryJob = {
        id: `delivery-${Date.now()}`,
        vehicle: deliveryVehicle,
        packageSize,
        packageLabel: packageOption.label,
        fare: deliveryFare,
        pickupAddress: pickupAddress.trim(),
        destAddress: (destAddress || '').trim(),
        senderPhone,
        recipientPhone,
        status: 'requested',
        createdAt: new Date().toISOString(),
      }
      saveDeliveryJob(job)
      onDeliveryCreated?.(job)
      void publishDelivery(job).then((published) => {
        deliveryServerId.current = published.id
      }).catch(() => undefined)
      setPhoneError('')
    }
    const didScan = scanned ?? qrScanned
    if (!canStart) return
    if (paymentPolicy?.requiresQr && !didScan) {
      setQrOpen(true)
      return
    }
    if (vehicle && selectedItem.startsWith('device-')) {
      const device = findDeviceBySpotId(selectedItem)
      if (!device || !isDeviceRentable(device)) {
        onNotice(device ? `${device.serial}은(는) ${MOBILITY_STATUS_LABEL[device.status]} 상태라 대여할 수 없어요.` : '이 기기는 지금 대여할 수 없어요.')
        return
      }
      setMobilityDeviceStatus(device.serial, 'rented')
      rentalSerialRef.current = device.serial
    }
    setPhase('matching')
    onActivity?.(selfServe ? `${service} 이용 시작` : `${service} 호출`, place)
    onNotice(selfServe ? `${service} 이용을 시작했어요.` : `${service} 호출을 시작했어요.`)
  }

  const startNewDaeriRide = () =>
    createRideRequest({
      passengerId: daeriPassengerIdRef.current,
      kind: 'daeri',
      pickupLat: rideOriginLat,
      pickupLng: rideOriginLng,
      pickupAddress: daeriTrip?.pickup || pickupAddress,
      waypoints: (daeriTrip?.waypoints ?? [])
        .filter((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lng))
        .slice(0, MAX_WAYPOINTS),
      destLat: rideDestLat ?? rideOriginLat,
      destLng: rideDestLng ?? rideOriginLng,
      destAddress: daeriTrip?.dest || destAddress,
      destLabel: daeriTrip?.dest || destAddress,
      estimatedFare: daeriTrip?.fare ?? daeriFareCfg.daeri.base,
    })

  useEffect(() => {
    if (!ride || (phase !== 'matching' && phase !== 'assigned')) return
    let cancelled = false
    daeriPassengerIdRef.current = localPassengerId()
    const attach = (created: PublicRide) => {
      if (cancelled) return
      if (daeriEndedRef.current) {
        void cancelRideRequest(created.id, daeriPassengerIdRef.current || localPassengerId()).catch(() => undefined)
        return
      }
      daeriSheetRideId = created.id
      daeriRideIdRef.current = created.id
      setDispatchRide(created)
      if (created.status === 'unmatched') setDaeriMatchError('지금은 배차 가능한 기사가 없어요.')
    }
    const createNew = () => {
      void startNewDaeriRide()
        .then(attach)
        .catch((error) => {
          if (!cancelled && !daeriEndedRef.current) setDaeriMatchError(error instanceof Error ? error.message : '호출에 실패했어요.')
        })
    }
    if (daeriSheetRideId) {
      daeriRideIdRef.current = daeriSheetRideId
      void fetchRideRequest(daeriSheetRideId).then((existing) => {
        if (cancelled) return
        // 이전 세션 id가 사라졌거나 이미 종료된 경우 즉시 새 호출로 전환한다.
        if (!existing || existing.status === 'completed' || existing.status === 'cancelled') {
          if (existing?.status === 'completed') syncDaeriCompleted(existing.id)
          daeriSheetRideId = ''
          daeriRideIdRef.current = ''
          createNew()
          return
        }
        attach(existing)
      }).catch(() => {
        if (!cancelled) createNew()
      })
      return () => {
        cancelled = true
      }
    }
    createNew()
    return () => {
      cancelled = true
    }
  }, [phase, ride])

  useEffect(() => {
    const rideId = dispatchRide?.id || daeriRideIdRef.current
    if (!ride || !rideId) return
    const apply = (next: PublicRide) => {
      if (next.status === 'cancelled') {
        daeriEndedRef.current = true
        daeriSheetRideId = ''
        daeriRideIdRef.current = ''
        daeriAcceptedRef.current = false
        setDaeriMatchError('')
        onClose()
        return
      }
      if (next.status === 'completed') {
        daeriSheetRideId = ''
        syncDaeriCompleted(next.id)
      }
      if ((next.status === 'assigned' || next.status === 'completed') && !daeriAcceptedRef.current) {
        daeriAcceptedRef.current = true
        setPhase('assigned')
        onActivity?.('배차 완료', `${next.assignedDriver?.name || '기사'} · ${place}`)
        onNotice(`${service} 배정이 완료되었습니다.`)
      }
      if (daeriAcceptedRef.current && next.status !== 'assigned' && next.status !== 'completed') return
      setDispatchRide(next)
      if (next.status === 'unmatched') setDaeriMatchError('주변 기사가 모두 응답하지 않아 배차에 실패했어요.')
    }
    const unsubscribe = subscribeRideLive(rideId, apply)
    const pull = () => {
      void fetchRideRequest(rideId).then((next) => {
        if (next) apply(next)
      }).catch(() => undefined)
    }
    const timer = window.setInterval(pull, 1500)
    window.addEventListener('online', pull)
    document.addEventListener('visibilitychange', pull)
    return () => {
      unsubscribe()
      window.clearInterval(timer)
      window.removeEventListener('online', pull)
      document.removeEventListener('visibilitychange', pull)
    }
  }, [dispatchRide?.id, ride])

  useEffect(() => {
    if (service !== '택배' || phase !== 'matching') return
    let stopped = false
    const pull = () => {
      const id = deliveryServerId.current
      if (!id) return
      void fetchDelivery(id).then((job) => {
        if (stopped || !job || job.status !== 'assigned' || !job.driverVehicle || !job.driverPlate) return
        setCourier({ name: job.driverName || '기사', vehicle: job.driverVehicle, plate: job.driverPlate })
        setPhase('assigned')
        onNotice('배차가 완료되었습니다.')
      }).catch(() => undefined)
    }
    pull()
    const timer = window.setInterval(pull, 2000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [service, phase])

  const confirmAssignment = () => {
    daeriAcceptedRef.current = true
    setPhase('assigned')
    onNotice(selfServe ? `${service} 이용이 시작되었습니다.` : `${service} 배정이 완료되었습니다.`)
  }
  const retryDaeriMatch = () => {
    if (daeriAccepting) return
    const staleId = dispatchRide?.id || daeriRideIdRef.current
    setDaeriAccepting(true)
    setDaeriMatchError('')
    daeriEndedRef.current = false
    daeriAcceptedRef.current = false
    setDispatchRide(null)
    daeriSheetRideId = ''
    daeriRideIdRef.current = ''
    // 이전 미배차 콜을 서버에서도 종료해 고스트 배차를 막는다.
    if (staleId) void cancelRideRequest(staleId, daeriPassengerIdRef.current || localPassengerId()).catch(() => undefined)
    void startNewDaeriRide()
      .then((created) => {
        if (daeriEndedRef.current) {
          void cancelRideRequest(created.id, daeriPassengerIdRef.current || localPassengerId()).catch(() => undefined)
          return
        }
        daeriSheetRideId = created.id
        daeriRideIdRef.current = created.id
        setDispatchRide(created)
        if (created.status === 'unmatched') setDaeriMatchError('지금은 배차 가능한 기사가 없어요. 다시 호출해 주세요.')
      })
      .catch((error) => {
        if (!daeriEndedRef.current) setDaeriMatchError(error instanceof Error ? error.message : '호출에 실패했어요.')
      })
      .finally(() => setDaeriAccepting(false))
  }
  const confirmInTripCancel = async () => {
    if (cancelSettling || cancelLockRef.current) return
    cancelLockRef.current = true
    daeriEndedRef.current = true
    const rideId = dispatchRide?.id || daeriRideIdRef.current
    if (!rideId) {
      daeriSheetRideId = ''
      daeriRideIdRef.current = ''
      setCancelConfirmOpen(false)
      onClose()
      return
    }
    setCancelSettling(true)
    try {
      const finished = await cancelRideRequest(rideId, daeriPassengerIdRef.current || localPassengerId(), { settleFee: true })
      if (finished?.status === 'completed') {
        onNotice('운행이 이미 완료되어 취소되지 않았어요. 영수증으로 정산 내역을 확인해 주세요.')
      } else {
        onActivity?.('이용 취소', `${service} · 취소 수수료 ${cancelSettlement.cancelFee.toFixed(7)} Pi`)
        onNotice(
          `운행을 취소했습니다. 취소 수수료 ${cancelSettlement.cancelFee.toFixed(7)} Pi가 기사님께 지급되었고, 나머지 ${cancelSettlement.waived.toFixed(7)} Pi는 청구되지 않습니다.`,
        )
      }
    } catch (error) {
      console.error('[cancel] passenger service', error)
      onNotice(error instanceof Error ? error.message : '취소 처리 중 문제가 생겼지만 홈으로 돌아갑니다.')
    } finally {
      daeriSheetRideId = ''
      daeriRideIdRef.current = ''
      daeriAcceptedRef.current = false
      setCancelConfirmOpen(false)
      setCancelSettling(false)
      onClose()
    }
  }
  return (
    <div className="fixed inset-x-0 bottom-0 top-[var(--app-header-offset)] z-[90] flex touch-none items-stretch overflow-hidden bg-[#241d35]/45">
      <div className="mx-auto flex h-[calc(100dvh-var(--app-header-offset))] max-h-[calc(100dvh-var(--app-header-offset))] w-full max-w-md flex-col overflow-hidden rounded-t-[32px] bg-white shadow-[0_-16px_40px_rgba(36,27,56,0.2)]">
      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-5 pb-8 pt-3">
        <div className="pointer-events-none mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#ddd7e7]" aria-hidden />
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-black text-[#4C1FB8]">
              {phase === 'matching' ? (selfServe ? 'READY' : 'CALLING') : phase === 'assigned' ? (ride ? (rideStage === 'moving' ? '운행 중' : '배차 완료') : selfServe ? '이용 중' : '배정 완료') : 'TAXITAGO SERVICE'}
            </p>
            <h2 className="mt-1 text-2xl font-black">
              {ride && phase === 'assigned' ? (rideStage === 'moving' ? '목적지 이동 중' : '기사 이동 중') : `${service} ${phase === 'matching' ? (selfServe ? '준비 중' : '호출 중') : phase === 'assigned' ? '이용 중' : '이용하기'}`}
            </h2>
          </div>
          <button onClick={() => { releaseRental(); onClose() }} className="rounded-full bg-[#f4f1f8] p-2 text-[#5f566d]" aria-label="닫기">
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
            <h3 className="mt-5 text-xl font-black">{selfServe ? '이용을 준비하고 있어요' : '기사님 매칭 대기 중'}</h3>
            <p className="mt-2 text-sm font-bold text-[#8b8495]">
              {ride ? place : selfServe ? `${service} 정보를 확인하고 있습니다.` : `${service} 담당자를 찾고 있어요.`}
            </p>
            {ride ? (
              <TaxiLiveMap
                kind="daeri"
                phase="arriving"
                routeLabel={place}
                statusLabel="호출 중"
                originLat={rideOriginLat}
                originLng={rideOriginLng}
                destLat={rideDestLat}
                destLng={rideDestLng}
                originLabel={daeriTrip?.pickup || pickupAddress}
                destLabel={daeriTrip?.dest || destAddress}
                waypoints={dispatchRide?.waypoints ?? daeriTrip?.waypoints ?? []}
                {...liveVehicleFromRide(dispatchRide)}
              />
            ) : null}
            {ride && dispatchRide?.pendingOffer ? (
              <p className="mt-3 text-sm font-bold text-[#4C1FB8]">{dispatchRide.pendingOffer.driverName} 기사님에게 콜을 요청했어요.</p>
            ) : null}
            {daeriMatchError ? <p className="mt-2 text-xs font-bold text-[#B91C1C]">{daeriMatchError}</p> : null}
            <div className="relative z-30 mt-3 space-y-3 pointer-events-auto">
            {IS_TEST_MODE ? (
              <button
                type="button"
                disabled={ride ? daeriAccepting || !dispatchRide : false}
                onClick={() => {
                  if (!ride) {
                    confirmAssignment()
                    return
                  }
                  if (!dispatchRide) return
                  setDaeriAccepting(true)
                  void acceptRideOnDevice(dispatchRide.id, {
                    passengerId: dispatchRide.passengerId,
                    pickup: dispatchRide.pickup,
                    dest: dispatchRide.dest,
                    estimatedFare: dispatchRide.estimatedFare,
                    kind: dispatchRide.kind,
                  }, localDriverId(loadPartnerProfile()?.uid))
                    .then((next) => {
                      daeriAcceptedRef.current = true
                      setDispatchRide(next)
                      setPhase('assigned')
                      onActivity?.('배차 완료', `${next.assignedDriver?.name || '기사'} · ${place}`)
                    })
                    .catch((error) => setDaeriMatchError(error instanceof Error ? error.message : '콜 수락에 실패했어요.'))
                    .finally(() => setDaeriAccepting(false))
                }}
                className="w-full rounded-2xl bg-[#4C1FB8] py-3.5 font-black text-white disabled:opacity-60"
              >
                {ride ? (daeriAccepting ? '수락 중…' : '이 기기에서 기사 콜 수락') : selfServe ? '이용 시작' : '배정 확인'}
              </button>
            ) : null}
            {ride && daeriMatchError ? (
              <button
                type="button"
                disabled={daeriAccepting}
                onClick={retryDaeriMatch}
                className="w-full rounded-2xl bg-[#4C1FB8] py-3.5 font-black text-white disabled:opacity-60"
              >
                {daeriAccepting ? '다시 호출 중…' : '다시 호출'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                daeriEndedRef.current = true
                const staleId = dispatchRide?.id || daeriRideIdRef.current
                daeriSheetRideId = ''
                daeriRideIdRef.current = ''
                daeriAcceptedRef.current = false
                setDaeriMatchError('')
                setDaeriAccepting(false)
                if (ride && staleId) {
                  void cancelRideRequest(staleId, daeriPassengerIdRef.current || localPassengerId()).catch(() => undefined)
                }
                releaseRental()
                onActivity?.(selfServe ? '이용 취소' : '호출 취소', place)
                onClose()
              }}
              className="w-full rounded-2xl border-2 border-[#CBD5E1] bg-white py-3.5 font-black text-[#475569]"
            >
              {selfServe ? '이용 취소' : '호출 취소'}
            </button>
            </div>
          </div>
        )}
        {!more && phase === 'assigned' && selfServe && (
          <div className="mt-5 space-y-3">
            <div className="rounded-[24px] border-2 border-[#E0D4FF] bg-[#F8F5FF] p-4">
              <p className="text-xs font-black text-[#4C1FB8]">{service} 이용 정보</p>
              <p className="mt-2 text-lg font-black text-[#0F172A]">{selectedUsage?.name}</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">{service === '주차' || service === 'EV 충전' ? '위치' : '거리'}</p>
                  <p className="mt-1 text-sm font-black text-[#0F172A]">{selectedUsage?.distance}</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">{service === '주차' ? '잔여 자리' : service === 'EV 충전' ? '잔여 전력' : '대여 상태'}</p>
                  <p className="mt-1 text-sm font-black text-[#4C1FB8]">{service === '자전거' || service === '킥보드' ? '대여 중' : selectedUsage?.extra}</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">{service === 'EV 충전' ? '충전 요금' : '이용 요금'}</p>
                  <p className="mt-1 text-sm font-black text-[#0F172A]">{selectedUsage?.rate}</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">{service === '자전거' || service === '킥보드' ? '배터리' : '진행 상태'}</p>
                  <p className="mt-1 text-sm font-black text-[#0F172A]">{service === '자전거' || service === '킥보드' ? selectedUsage?.extra : service === 'EV 충전' ? '충전 중' : '주차 이용 중'}</p>
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
            <BalanceCheckoutButton
              amount={chargeAmount}
              memo={`${service} ${chargeAmount} Pi`}
              metadata={{ kind: 'service-pay', place, label: `${service} 이용` }}
              className="w-full rounded-2xl bg-[#4A82B8] py-4 text-lg font-bold text-white shadow-[0_10px_22px_rgba(74,130,184,0.28)]"
              onPaid={(result) => {
                if (!result.paymentId || !result.txid) return
                if (vehicle) releaseRental()
                onSettle(chargeAmount, place, `${service} 이용`, ride ? billed.estimate : undefined, result, dispatchRide?.id || daeriRideIdRef.current || undefined)
              }}
              onFailed={(error) => onNotice(describePiUserMessage(error))}
            >
              {vehicle ? '이용 완료 · 반납 결제' : settleTiming === 'qr_auto' ? '이용 완료 · 자동결제' : settleTiming === 'postpaid' ? '이용 완료 · 후결제' : '이용 완료'}
            </BalanceCheckoutButton>
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
                originLat={rideOriginLat}
                originLng={rideOriginLng}
                destLat={rideDestLat}
                destLng={rideDestLng}
                originLabel={daeriTrip?.pickup || pickupAddress}
                destLabel={daeriTrip?.dest || destAddress}
                waypoints={dispatchRide?.waypoints ?? daeriTrip?.waypoints ?? []}
                {...liveVehicleFromRide(dispatchRide)}
              />
            ) : null}
            <div className="rounded-[24px] border-2 border-[#E0D4FF] bg-[#F8F5FF] p-4">
              <p className="text-xs font-black text-[#2d9a5e]">{ride ? (rideStage === 'moving' ? '운행 시작' : '배정 완료') : '배정 완료'}</p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#4C1FB8] font-black text-white">{partner.name.slice(0, 1)}</div>
                <div>
                  <p className="font-black text-[#0F172A]">{partner.name} 기사님</p>
                  <p className="mt-1 text-xs font-bold text-[#64748B]">배차가 완료되었습니다</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white px-3 py-2.5">
                  <p className="text-[10px] font-bold text-[#8b8495]">차량명</p>
                  <p className="mt-1 text-sm font-black text-[#0F172A]">{partner.vehicle || '확인 중'}</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-2.5">
                  <p className="text-[10px] font-bold text-[#8b8495]">차량번호</p>
                  <p className="mt-1 text-sm font-black tracking-wide text-[#0F172A]">{partner.plate || '확인 중'}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">{ride && rideStage === 'moving' ? '실제 이용 요금' : '예상 요금'}</p>
                  <p className="mt-1 text-sm font-black text-[#4C1FB8]">{(ride && rideStage === 'moving' ? billed.actual : fare).toFixed(7)} Pi</p>
                </div>
                <div className="rounded-2xl bg-white px-3 py-3">
                  <p className="text-[10px] font-bold text-[#8b8495]">이용 상태</p>
                  <p className="mt-1 text-sm font-black text-[#0F172A]">{ride ? (rideStage === 'moving' ? '목적지 이동 중' : '호출자에게 이동 중') : '이동/이용 중'}</p>
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
            {/* TODO [정식 서비스 오픈 시 전환 필수]: 현재는 테스트용 수동 트리거임. 정식 오픈 시 기사 모드 서버/웹소켓 신호 수신 시 자동으로 넘어가도록 연동 필요 */}
            {ride && !dispatchRide?.boardedAt ? (
              <button
                type="button"
                disabled={daeriAccepting}
                onClick={() => {
                  const rideId = dispatchRide?.id || daeriRideIdRef.current
                  if (!rideId) return
                  setDaeriAccepting(true)
                  void markRideProgress(rideId, daeriPassengerIdRef.current || localPassengerId(), 'boarded')
                    .then((next) => {
                      setDispatchRide(next)
                      onNotice('탑승을 확인했어요.')
                    })
                    .catch((error) => onNotice(error instanceof Error ? error.message : '탑승 확인에 실패했어요.'))
                    .finally(() => setDaeriAccepting(false))
                }}
                className="w-full rounded-2xl border-2 border-[#4A82B8] bg-white py-3.5 text-base font-bold text-[#4A82B8] disabled:opacity-60"
              >
                탑승 확인
              </button>
            ) : null}
            {ride && dispatchRide?.boardedAt && !dispatchRide.readyToSettleAt ? (
              <button
                type="button"
                disabled={daeriAccepting}
                onClick={() => {
                  const rideId = dispatchRide?.id || daeriRideIdRef.current
                  if (!rideId) return
                  setDaeriAccepting(true)
                  void markRideProgress(rideId, daeriPassengerIdRef.current || localPassengerId(), 'arrived')
                    .then((next) => {
                      setDispatchRide(next)
                      onNotice('목적지 도착을 확인했어요.')
                    })
                    .catch((error) => onNotice(error instanceof Error ? error.message : '도착 확인에 실패했어요.'))
                    .finally(() => setDaeriAccepting(false))
                }}
                className="w-full rounded-2xl border-2 border-[#4A82B8] bg-white py-3.5 text-base font-bold text-[#4A82B8] disabled:opacity-60"
              >
                목적지 도착
              </button>
            ) : null}
            {ride ? (
              dispatchRide?.status === 'completed' ? (
                <button
                  type="button"
                  onClick={() => {
                    if (dispatchRide?.id) syncDaeriCompleted(dispatchRide.id)
                    onAskReview(partner)
                    onClose()
                  }}
                  className="w-full rounded-2xl bg-[#4C1FB8] py-4 text-lg font-black text-white"
                >
                  운행 종료 · 기사 평가
                </button>
              ) : (
              <RideCompleteCancelBar
                onCancel={() => setCancelConfirmOpen(true)}
                hint={
                  rideStage === 'arriving'
                    ? '기사님이 도착하면 운행을 시작해 주세요 · 취소 시 수수료가 부과될 수 있습니다'
                    : '운행 중 취소 시 취소 수수료가 기사님께 지급되고 나머지는 청구되지 않습니다'
                }
              >
                <BalanceCheckoutButton
                  amount={rideStage === 'moving' ? billed.actual : fare}
                  memo={`${service} ${(rideStage === 'moving' ? billed.actual : fare)} Pi`}
                  metadata={{
                    kind: 'escrow-lock',
                    rideId: dispatchRide?.id || daeriRideIdRef.current,
                    place,
                    label: `${service} 이용`,
                  }}
                  disabled={!dispatchRide?.readyToSettleAt}
                  className="w-full rounded-2xl bg-[#4C1FB8] py-4 text-lg font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)]"
                  onPaid={(result) => {
                    if (!result.paymentId || !result.txid) return
                    const paid = rideStage === 'moving' ? billed.actual : fare
                    const snapshot = dispatchRide
                    const rideId = snapshot?.id || daeriRideIdRef.current
                    const driverId = snapshot?.assignedDriver?.id
                    daeriSheetRideId = ''
                    if (rideId && driverId) {
                      const proof = snapshot
                        ? {
                            ...snapshot,
                            escrow: {
                              status: 'held',
                              amount: paid,
                              lockTxid: result.txid,
                              lockPaymentId: result.paymentId,
                              payoutTxid: null,
                              payoutWallet: null,
                            } as PublicRide['escrow'],
                          }
                        : undefined
                      const abort = new AbortController()
                      const timeout = window.setTimeout(() => abort.abort(), 25000)
                      const attempt = (): Promise<{ ride?: PublicRide }> =>
                        completeRideTrip(rideId, driverId, proof, { signal: abort.signal })
                      const retry = (left: number): Promise<{ ride?: PublicRide }> =>
                        attempt().catch((error) =>
                          left > 0
                            ? new Promise<{ ride?: PublicRide }>((resolve) => window.setTimeout(resolve, 2000)).then(() =>
                                retry(left - 1),
                              )
                            : Promise.reject(error),
                        )
                      void retry(2)
                        .then((completed) => {
                          if (completed.ride) setDispatchRide(completed.ride)
                        })
                        .catch((error) => {
                          console.error('[daeri] ride complete failed', error)
                          onNotice('결제는 완료되었어요. 운행 완료 처리는 기사 화면에서도 확인됩니다.')
                        })
                        .finally(() => window.clearTimeout(timeout))
                    }
                    onSettle(paid, place, `${service} 이용`, billed.estimate, result, rideId)
                    onAskReview(partner)
                  }}
                  onFailed={(error) => onNotice(describePiUserMessage(error))}
                >
                  이용 완료
                </BalanceCheckoutButton>
              </RideCompleteCancelBar>
              )
            ) : (
              <>
                <BalanceCheckoutButton
                  amount={fare}
                  memo={`${service} ${fare} Pi`}
                  metadata={{ kind: 'service-pay', place, label: `${service} 이용` }}
                  className="w-full rounded-2xl bg-[#4C1FB8] py-4 text-lg font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)]"
                  onPaid={(result) => {
                    if (!result.paymentId || !result.txid) return
                    onSettle(fare, place, `${service} 이용`, undefined, result)
                  }}
                  onFailed={(error) => onNotice(describePiUserMessage(error))}
                >
                  이용 완료
                </BalanceCheckoutButton>
                <p className="text-center text-[11px] font-bold text-[#8b8495]">도착 후 눌러 주세요 · 하차 완료</p>
              </>
            )}
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
                  <p className="text-lg font-black">{fare.toFixed(7)} Pi</p>
                </div>
              </div>
            </div>
            <button type="button" onClick={() => startService()} className="w-full rounded-2xl bg-[#4C1FB8] py-4 text-lg font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)]">
              대리운전 호출하기
            </button>
            <p className="text-center text-[11px] font-bold text-[#8b8495]">호출 후 기사 배정이 시작됩니다.</p>
          </div>
        )}
        {phase === 'idle' && selfServe && (
          <div className="mt-5 space-y-3">
            {vehicle ? (
              <button
                type="button"
                onClick={() => setDeviceFormOpen(true)}
                className="w-full rounded-2xl border-2 border-[#4A82B8] bg-[#E8F1FA] py-3 text-sm font-black text-[#4A82B8]"
              >
                파트너 기기 등록
              </button>
            ) : null}
            <div className="relative w-full shrink-0 overflow-hidden rounded-3xl" style={{ height: 160, minHeight: 160 }}>
              <NearbyServiceMap
                key={`service-map-${service}`}
                originLat={pickupLat}
                originLng={pickupLng}
                spots={nearbySpots}
                selectedId={selectedItem}
                focusId={mapFocusId}
                onSelect={(id) => {
                  setSelectedItem(id)
                  setMapFocusId(id)
                }}
                className="h-full w-full"
              />
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {catalog.map((item, index) => {
                const active = selectedItem === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedItem(item.id)
                      setMapFocusId(item.id)
                    }}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${active ? 'border-[#7046dc] bg-[#f1ebff] ring-2 ring-[#7046dc]/15' : 'border-[#ece8f4] bg-white'}`}
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black ${active ? 'bg-[#4C1FB8] text-white' : vehicle ? 'bg-[#edf8f0] text-[#36a76b]' : 'bg-[#F1F5F9] text-[#0F172A]'}`}>
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block break-words text-sm font-black">
                        {item.name}
                        {item.available ? <span className="font-black text-[#0F766E]"> (이용가능)</span> : null}
                        {item.statusLabel && item.statusLabel !== '이용 가능' ? (
                          <span className={`font-black ${item.statusLabel === '배터리 부족' ? 'text-[#B45309]' : item.statusLabel === '대여 중' ? 'text-[#1D4ED8]' : 'text-[#9F1239]'}`}> ({item.statusLabel})</span>
                        ) : null}
                      </strong>
                      <span className="mt-1 block text-xs font-bold text-[#8b8495]">
                        {item.distance} · <b className="text-[#36a76b]">{item.extra}</b>
                      </span>
                    </span>
                    <span className="text-xs font-black text-[#7046dc]">{item.rate}</span>
                  </button>
                )
              })}
            </div>
            {vehicle && selectedItem.startsWith('device-') && !selectedRentable ? (
              <p className="text-center text-sm font-black text-[#9F1239]">이 기기는 지금 대여할 수 없어요.</p>
            ) : null}
            <PaymentHandler
              service={service}
              amount={fare}
              balance={balance}
              place={place}
              qrScanned={qrScanned}
              parkingOption={parkingOption}
              prepaidSettled={prepaidSettled}
              continueLabel={!selectedItem ? (vehicle ? '차량을 선택해 주세요' : '장소를 선택해 주세요') : selectedRentable ? '이용 시작' : '대여할 수 없는 기기'}
              canProceed={Boolean(selectedItem) && selectedRentable}
              onParkingOption={setParkingOption}
              onRequestQr={() => {
                if (!selectedItem) {
                  onNotice(vehicle ? '먼저 차량을 선택해 주세요.' : '먼저 장소를 선택해 주세요.')
                  return
                }
                setQrOpen(true)
              }}
              onPay={onPay}
              onNeedCharge={onNeedCharge}
              onContinue={() => startService(vehicle)}
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
                {DELIVERY_VEHICLES.map((item) => (
                  <button key={item} onClick={() => setDeliveryVehicle(item)} className={`rounded-2xl border p-3 text-xs font-black ${deliveryVehicle === item ? 'border-[#7046dc] bg-[#7046dc] text-white' : 'border-[#ece8f4] bg-white'}`}>
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-black">상품 크기</p>
              <div className="flex flex-col gap-2">
                {PACKAGE_SIZES.map((item) => {
                  const selected = packageSize === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setPackageSize(item.id)}
                      className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${selected ? 'border-[#7046dc] bg-[#f1ebff] ring-2 ring-[#7046dc]/15' : 'border-[#ece8f4] bg-white'}`}
                    >
                      <span className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 p-1 ${selected ? 'border-[#7046dc]' : 'border-[#cfc7db]'}`}>
                        <span className={`block h-full w-full rounded-full ${selected ? 'bg-[#7046dc]' : 'bg-transparent'}`} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block text-sm font-black leading-5 text-[#1f1630]">{item.label}</strong>
                        <span className={`mt-1 block whitespace-normal break-keep text-xs font-bold leading-5 ${selected ? 'text-[#6b57a8]' : 'text-[#8b8495]'}`}>
                          ({item.hint})
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-black">연락처</p>
              <label className="block">
                <span className="text-[10px] font-black text-[#8b8495]">발신인 연락처</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={senderPhone}
                  onChange={(event) => {
                    setSenderPhone(formatKoreanPhone(event.target.value))
                    setPhoneError('')
                  }}
                  placeholder="010-1234-5678"
                  className="mt-1.5 w-full rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] px-4 py-3 text-sm font-black tracking-wide outline-none focus:border-[#7046dc]"
                />
              </label>
              <label className="mt-3 block">
                <span className="text-[10px] font-black text-[#8b8495]">수신인 연락처</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={recipientPhone}
                  onChange={(event) => {
                    setRecipientPhone(formatKoreanPhone(event.target.value))
                    setPhoneError('')
                  }}
                  placeholder="010-9876-5432"
                  className="mt-1.5 w-full rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] px-4 py-3 text-sm font-black tracking-wide outline-none focus:border-[#7046dc]"
                />
              </label>
              {phoneError ? <p className="mt-2 text-xs font-bold text-[#BE123C]">{phoneError}</p> : null}
            </div>
            <div className="rounded-3xl bg-[#f7f3ff] p-4">
              <div className="flex justify-between">
                <span className="font-black">예상 배송 요금</span>
                <strong className="text-xl text-[#7046dc]">{formatDeliveryFare(deliveryFare)} Pi</strong>
              </div>
              <p className="mt-2 whitespace-normal break-keep text-xs font-bold leading-5 text-[#8b8495]">
                {deliveryVehicle} · {packageOption.label} ({packageOption.hint}) · 30분 내 배차
              </p>
            </div>
            <button type="button" onClick={() => startService()} className="w-full rounded-2xl bg-[#4C1FB8] py-4 font-black text-white">
              배송 요청하기
            </button>
          </div>
        )}
        {more && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-black text-[#475569]">{t('more.mobility')}</p>
            <div className="rounded-[22px] bg-[#E2E8F0] p-3">
              <div className="grid grid-cols-4 gap-x-2 gap-y-4">
                {menuMobilityServices(false).map((item) => (
                  <ServiceIconButton
                    key={item.label}
                    service={item}
                    wrapLabel={isComingSoonService(item.label)}
                    onClick={() => {
                      if (isComingSoonService(item.label)) {
                        setPreparingOpen(true)
                        return
                      }
                      if (onSelectService) onSelectService(item.label)
                      else action(`${item.label} 서비스를 선택했어요.`)
                    }}
                  />
                ))}
              </div>
            </div>
            <p className="mb-2 mt-5 text-xs font-black text-[#8b8495]">{t('more.guide')}</p>
            <MoreMenu />
          </div>
        )}
      </div>
      {preparingOpen ? <ServicePreparingModal onClose={() => setPreparingOpen(false)} /> : null}
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
      {cancelConfirmOpen && ride ? (
        <InTripCancelConfirmModal
          quoted={cancelSettlement.quoted}
          cancelFee={cancelSettlement.cancelFee}
          waived={cancelSettlement.waived}
          driverPayout={cancelSettlement.driverPayout}
          settling={cancelSettling}
          onKeep={() => setCancelConfirmOpen(false)}
          onConfirm={() => void confirmInTripCancel()}
        />
      ) : null}
      {callOpen ? (
        contactRideId ? (
          <RideSafeCall
            rideId={contactRideId}
            actorId={daeriPassengerIdRef.current || localPassengerId()}
            role="passenger"
            peerName={`${partner.name} 기사님`}
            onHangup={() => setCallOpen(false)}
          />
        ) : (
          <SafeCallModal driverName={partner.name} onHangup={() => setCallOpen(false)} />
        )
      ) : null}
      {chatOpen ? (
        contactRideId ? (
          <RideChat
            rideId={contactRideId}
            actorId={daeriPassengerIdRef.current || localPassengerId()}
            role="passenger"
            peerName={`${partner.name} 기사님`}
            onClose={() => setChatOpen(false)}
          />
        ) : (
          <DriverChatModal driverName={partner.name} onClose={() => setChatOpen(false)} />
        )
      ) : null}
      <RideCommsAlerts
        rideId={ride && dispatchRide?.status === 'assigned' ? contactRideId : null}
        actorId={daeriPassengerIdRef.current || localPassengerId()}
        role="passenger"
        peerName={`${partner.name} 기사님`}
        chatOpen={chatOpen}
        callOpen={callOpen}
        onOpenChat={() => setChatOpen(true)}
        onOpenCall={() => setCallOpen(true)}
      />
      {deviceFormOpen && vehicle ? (
        <MobilityDeviceFormModal
          initialKind={service === '킥보드' ? '퀵보드' : '자전거'}
          onClose={() => setDeviceFormOpen(false)}
        />
      ) : null}
      </div>
    </div>
  )
}

function DaeriCallSetupSheet({
  destination,
  originLat,
  originLng,
  originAddress,
  initialWaypoints,
  destLat,
  destLng,
  onClose,
  onCall,
  onRequireRoute,
}: {
  destination: string
  originLat: number
  originLng: number
  originAddress: string
  initialWaypoints?: string[]
  destLat?: number
  destLng?: number
  onClose: () => void
  onCall: (trip: DaeriTrip) => void
  onRequireRoute?: (kind: RouteGap) => void
}) {
  const [pickup, setPickup] = useState(originAddress)
  const [waypoints, setWaypoints] = useState<string[]>((initialWaypoints ?? []).slice(0, MAX_WAYPOINTS))
  const waypointPlaces = useRef(new Map<string, RideCoords>())
  const [waypointSearchIndex, setWaypointSearchIndex] = useState<number | null>(null)
  const [wpFavorites, setWpFavorites] = useState<FavoritePlace[]>([])
  const [wpRecents, setWpRecents] = useState<RecentPlace[]>([])
  useEffect(() => {
    setWpFavorites(readFavoritePlaces())
    setWpRecents(readRecentPlaces())
  }, [])
  const [pickupPoint, setPickupPoint] = useState<RideCoords>({ lat: originLat, lng: originLng })
  const [longDist, setLongDist] = useState<{ point: RideCoords; destName: string; km: number; regionExit: boolean; destRegion: string } | null>(null)
  const [dest, setDest] = useState(destination.trim() || '')
  const [plan, setPlan] = useState<'착한요금' | '빠른배정'>('착한요금')
  const [mapPicker, setMapPicker] = useState(false)
  const [pickerMapSession, setPickerMapSession] = useState(0)
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
  const pickSeq = useRef(0)
  const pickMapPoint = (nextLat: number, nextLng: number) => {
    const seq = ++pickSeq.current
    const fallback = pickup.trim() || virtualPickupAddress(nextLat, nextLng)
    setPendingPick({ lat: nextLat, lng: nextLng, address: fallback })
    void reverseGeocode(nextLat, nextLng).then((nextAddress) => {
      if (seq !== pickSeq.current || !nextAddress) return
      setPendingPick((current) =>
        current && current.lat === nextLat && current.lng === nextLng ? { ...current, address: nextAddress } : current,
      )
    })
  }
  const closePicker = () => {
    pickSeq.current += 1
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
  }, [pickup, waypoints, dest, plan, mapPicker])
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
  const proceedCall = (point: RideCoords, destName: string) => {
    // 경유지 입력 텍스트를 좌표로 변환한다. 좌표 확인에 실패한 경유지는 제외한다.
    const waypointTexts = waypoints.map((item) => item.trim()).filter(Boolean).slice(0, MAX_WAYPOINTS)
    void Promise.all(
      waypointTexts.map(
        async (text) =>
          waypointPlaces.current.get(text) ?? coordsFromPlaceQuery(text) ?? (await resolveRidePlace(text, pickup)),
      ),
    ).then((resolved) => {
      onCall({
        pickup: pickup.trim(),
        dest: destName,
        plan: selected.id,
        fare: selected.fare,
        pickupLat: pickupPoint.lat,
        pickupLng: pickupPoint.lng,
        waypoints: resolved.filter((wp): wp is NonNullable<typeof wp> => wp !== null),
        destLat: point.lat,
        destLng: point.lng,
      })
    })
  }
  const finishCall = (point: RideCoords, destName: string) => {
    // 장거리 콜(직선 25km+ 또는 타 시/도 권역)이면 이용자 확인을 먼저 받는다.
    const flag = longDistanceCheck({ lat: pickupPoint.lat, lng: pickupPoint.lng, address: pickup }, point)
    if (flag.far) {
      setLongDist({ point, destName, ...flag })
      return
    }
    proceedCall(point, destName)
  }
  return (
    <div className="fixed inset-0 z-[52] bg-[#1e1033]/40">
      <div className="relative mx-auto h-full max-w-md overflow-hidden bg-[#E2E8F0]">
        <LocationTileMap
          key={mapPicker ? `daeri-pick-${pickerMapSession}` : 'daeri-preview'}
          lat={pickupPoint.lat}
          lng={pickupPoint.lng}
          pinLat={pendingPick?.lat ?? pickupPoint.lat}
          pinLng={pendingPick?.lng ?? pickupPoint.lng}
          className="h-full"
          interactive
          pulsePin
          bottomInset={bottomInset}
          onActivate={mapPicker ? undefined : () => {
            setPickerMapSession((value) => value + 1)
            setMapPicker(true)
          }}
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
                setPickupPoint({ lat: pendingPick.lat, lng: pendingPick.lng })
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
          className={`absolute inset-x-0 bottom-0 z-30 flex max-h-[calc(100%-var(--app-header-offset))] h-[calc(100%-var(--app-header-offset))] flex-col overflow-y-auto rounded-t-[28px] bg-white px-5 pb-7 pt-1 shadow-[0_-16px_32px_rgba(36,27,56,0.16)] ${sheetDragging ? '' : 'transition-transform duration-300 ease-out'}`}
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
          <div className="mt-3 block">
            <span className="text-[10px] font-black text-[#8b8495]">경유지 (선택 · 최대 {MAX_WAYPOINTS}곳)</span>
            {waypoints.map((waypoint, index) => (
              <div key={index} className="mt-2 flex items-center gap-2 rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] px-4 py-3">
                <MapPin className="h-4 w-4 shrink-0 text-[#EA580C]" />
                <input
                  value={waypoint}
                  onChange={(event) => setWaypoints((list) => list.map((item, i) => (i === index ? event.target.value : item)))}
                  placeholder={`경유지 ${index + 1}`}
                  aria-label={`경유지 ${index + 1}`}
                  className="min-w-0 flex-1 bg-transparent text-sm font-black outline-none"
                />
                <button
                  type="button"
                  onClick={() => setWaypointSearchIndex(index)}
                  aria-label={`경유지 ${index + 1} 검색`}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EDE5FF] text-[#6D28D9] transition hover:bg-[#E0D4FF] active:scale-95"
                >
                  <Search className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setWaypoints((list) => list.filter((_, i) => i !== index))}
                  aria-label={`경유지 ${index + 1} 삭제`}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-[#64748B] transition hover:bg-[#E2E8F0] active:scale-95"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {waypoints.length < MAX_WAYPOINTS ? (
              <button
                type="button"
                onClick={() => setWaypoints((list) => [...list, ''])}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-[#C4B5FD] bg-white py-2.5 text-xs font-black text-[#6D28D9] transition hover:bg-[#F8F5FF] active:scale-[0.99]"
              >
                <Plus className="h-4 w-4" />
                경유지 추가
              </button>
            ) : null}
          </div>
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
            onClick={() => {
              const destName = dest.trim()
              const gap = routeGap(pickup, destName)
              if (gap) {
                onRequireRoute?.(gap)
                return
              }
              const known =
                coordsFromPlaceQuery(destName) ??
                (Number.isFinite(destLat) && Number.isFinite(destLng)
                  ? { lat: destLat as number, lng: destLng as number }
                  : null)
              if (known) {
                finishCall(known, destName)
                return
              }
              void resolveRidePlace(destName, pickup).then((place) => {
                if (place) finishCall(place, destName)
                else onRequireRoute?.('dest')
              })
            }}
            className="mt-4 w-full rounded-2xl bg-[#4C1FB8] py-4 font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)]"
          >
            대리 호출하기
          </button>
        </section>
        {longDist ? (
          <LongDistanceConfirmModal
            km={longDist.km}
            regionExit={longDist.regionExit}
            destRegion={longDist.destRegion}
            onEdit={() => setLongDist(null)}
            onConfirm={() => {
              const pending = longDist
              setLongDist(null)
              proceedCall(pending.point, pending.destName)
            }}
          />
        ) : null}
        {waypointSearchIndex !== null ? (
          <DestinationSearchModal
            destination={waypoints[waypointSearchIndex] ?? ''}
            favorites={wpFavorites}
            recents={wpRecents}
            originLat={pickupPoint.lat}
            originLng={pickupPoint.lng}
            originAddress={pickup}
            searchPlaceholder="경유지를 검색해 주세요"
            onClose={() => setWaypointSearchIndex(null)}
            onSelect={(name, address, coords) => {
              const index = waypointSearchIndex
              const text = (address || name).trim()
              if (text) {
                setWaypoints((list) => list.map((item, i) => (i === index ? text : item)))
                if (coords) waypointPlaces.current.set(text, coords)
                const next = [{ id: `${Date.now()}`, name, address: text }, ...wpRecents.filter((place) => place.name !== name && place.address !== text)]
                setWpRecents(next)
                writeRecentPlaces(next)
              }
              setWaypointSearchIndex(null)
            }}
            onAddFavorite={() => undefined}
            onRemoveFavorite={(id) => {
              const next = wpFavorites.filter((place) => place.id !== id)
              setWpFavorites(next)
              writeFavoritePlaces(next)
            }}
            onRemoveRecent={(id) => {
              const next = wpRecents.filter((place) => place.id !== id)
              setWpRecents(next)
              writeRecentPlaces(next)
            }}
          />
        ) : null}
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

const HOME_EVENT_BANNERS = [
  {
    id: 'first-ride',
    badge: 'EVENT',
    title: '첫 호출 50% Pi 할인',
    subtitle: '신규 탑승 쿠폰이 자동 적용돼요',
    cta: '지금 호출',
    action: '택시' as ServiceLabel,
    icon: Sparkles,
    className: 'from-[#6D28D9] via-[#5B21B6] to-[#1E1B4B]',
  },
  {
    id: 'daeri-night',
    badge: 'AD',
    title: '심야 대리 3,000원 쿠폰',
    subtitle: '늦은 밤에도 편하게 집까지',
    cta: '대리 보기',
    action: '대리운전' as ServiceLabel,
    icon: Car,
    className: 'from-[#0F766E] via-[#0F172A] to-[#1E1B4B]',
  },
  {
    id: 'invite-pi',
    badge: 'EVENT',
    title: '친구 초대하고 Pi 적립',
    subtitle: '친구 초대 시 각각 0.5 Pi가 지급됩니다',
    cta: '혜택 보기',
    action: '더보기' as ServiceLabel,
    icon: Gift,
    className: 'from-[#DB2777] via-[#7C3AED] to-[#312E81]',
  },
] as const

function HomeEventBanners({ onAction }: { onAction: (service: ServiceLabel) => void }) {
  const [inviteOpen, setInviteOpen] = useState(false)
  return (
    <section className="mt-3" aria-label="이벤트 및 광고">
      <div className="flex items-end justify-between px-0.5">
        <h2 className="text-sm font-black tracking-tight text-[#0F172A]">이벤트 · 혜택</h2>
        <span className="text-[10px] font-bold text-[#64748B]">좌우로 넘겨 보세요</span>
      </div>
      <div className="mt-2 flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {HOME_EVENT_BANNERS.map((banner) => {
          const Icon = banner.icon
          return (
            <button
              key={banner.id}
              type="button"
              onClick={() => {
                if (banner.id === 'invite-pi') {
                  setInviteOpen(true)
                  return
                }
                onAction(banner.action)
              }}
              className={`relative min-h-[7.5rem] w-[min(86%,19rem)] shrink-0 snap-start overflow-hidden rounded-[22px] bg-gradient-to-br p-4 text-left text-white shadow-[0_12px_24px_rgba(76,31,184,0.22)] ${banner.className}`}
              aria-label={`${banner.badge} ${banner.title}`}
            >
              <span className="pointer-events-none absolute -right-4 -top-6 h-24 w-24 rounded-full bg-white/10" />
              <span className="pointer-events-none absolute bottom-[-1.5rem] right-8 h-20 w-20 rounded-full bg-white/10" />
              <span className="inline-flex items-center gap-1 rounded-full bg-white/18 px-2 py-0.5 text-[10px] font-black tracking-wide">
                <Icon className="h-3 w-3" />
                {banner.badge}
              </span>
              <p className="mt-2.5 text-[17px] font-black leading-snug tracking-tight">{banner.title}</p>
              <p className="mt-1 text-[12px] font-bold leading-5 text-white/80">{banner.subtitle}</p>
              <span className="mt-3 inline-flex items-center gap-0.5 text-[12px] font-black">
                {banner.cta}
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </button>
          )
        })}
      </div>
      {inviteOpen ? <InviteLaunchModal onClose={() => setInviteOpen(false)} /> : null}
    </section>
  )
}

const HOME_PARTNER_BANNERS: {
  id: string
  name: string
  subtitle: string
  cta: string
  href: string | null
  logoSrc: string
}[] = [
  {
    id: 'baroonda',
    name: 'BaroOnda',
    subtitle: 'Pi 생태계 파트너 스토어로 이동합니다',
    cta: '스토어 방문하기',
    href: 'https://apppistorekoreay8282.pinet.com',
    logoSrc: '/ads/baroonda-logo.svg?v=cart-pi',
  },
]

/** 이벤트 · 혜택 카드와 동일한 크기/비율 — 광고/파트너 카드 전부 이 클래스를 공유한다. */
const PARTNER_CARD_BASE =
  'relative flex min-h-[7.5rem] w-[min(86%,19rem)] shrink-0 snap-start flex-col overflow-hidden rounded-[22px] p-4 text-left'

function HomePartnerBanners() {
  const [adInfoOpen, setAdInfoOpen] = useState(false)
  return (
    <section className="mt-3" aria-label="광고 / 파트너 배너">
      <div className="flex items-end justify-between px-0.5">
        <h2 className="text-sm font-black tracking-tight text-[#0F172A]">광고 / 파트너 배너</h2>
        <span className="text-[10px] font-bold text-[#64748B]">좌우로 넘겨 보세요</span>
      </div>
      <div className="mt-2 flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {HOME_PARTNER_BANNERS.map((banner) => (
          <a
            key={banner.id}
            href={banner.href ?? undefined}
            target={banner.href ? '_blank' : undefined}
            rel={banner.href ? 'noopener noreferrer' : undefined}
            onClick={(event) => {
              if (!banner.href) event.preventDefault()
            }}
            className={`${PARTNER_CARD_BASE} border-2 border-[#DDD6FE] bg-gradient-to-br from-[#F8F5FF] via-white to-[#EDE5FF] text-[#0F172A] shadow-[0_12px_24px_rgba(76,31,184,0.12)] transition ${banner.href ? 'cursor-pointer hover:border-[#4C1FB8] hover:shadow-[0_14px_28px_rgba(76,31,184,0.22)] active:scale-[0.98]' : 'cursor-default'}`}
            aria-label={`${banner.name} ${banner.subtitle}`}
          >
            <img src={banner.logoSrc} alt="BaroOnda 쇼핑 카트와 파이 로고" className="h-12 w-auto max-w-full object-contain object-left" />
            <p className="mt-2 text-[15px] font-black leading-snug tracking-tight">{banner.name}</p>
            <p className="mt-1 text-[12px] font-bold leading-5 text-[#64748B]">{banner.subtitle}</p>
            <span className="mt-2 inline-flex items-center gap-0.5 text-[12px] font-black text-[#4C1FB8]">
              {banner.cta}
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </a>
        ))}
        <button
          type="button"
          onClick={() => setAdInfoOpen(true)}
          className={`${PARTNER_CARD_BASE} cursor-pointer items-center justify-center border-2 border-dashed border-[#C4B5FD] bg-white/70 text-center transition hover:border-[#4C1FB8] hover:bg-[#F8F5FF] active:scale-[0.98]`}
          aria-label="광고 등록 안내"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EDE9FE]">
            <Sparkles className="h-4 w-4 text-[#4C1FB8]" />
          </span>
          <p className="mt-2 text-[13px] font-black leading-snug text-[#4C1FB8]">여기는 당신의 광고를<br />올리는 곳입니다</p>
          <span className="mt-2 inline-flex items-center gap-0.5 text-[11px] font-black text-[#64748B]">
            광고 등록 안내
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>
      {adInfoOpen ? <AdInquiryModal onClose={() => setAdInfoOpen(false)} /> : null}
    </section>
  )
}

function AdInquiryModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-[#241d35]/50 sm:items-center sm:p-4" onClick={onClose}>
      <section className="w-full max-w-md rounded-t-[28px] bg-white p-5 sm:rounded-[28px]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-black text-[#4C1FB8]">광고 / 파트너 배너</p>
            <h3 className="mt-1 text-lg font-black">이 자리에 광고를 등록하는 방법</h3>
          </div>
          <button type="button" onClick={onClose} className="text-sm font-black text-[#64748B]" aria-label="닫기">닫기</button>
        </div>
        <ol className="mt-4 space-y-3">
          {[
            { step: '1', text: '홍보할 서비스명 · 배너 이미지 · 연결할 링크를 준비해 주세요.' },
            { step: '2', text: '아래 문의 이메일로 광고 신청을 보내 주세요. 제목에 [광고등록]을 붙여 주시면 빠르게 처리됩니다.' },
            { step: '3', text: '담당자 검토·심사 후 이 영역에 광고 배너가 노출됩니다.' },
          ].map((row) => (
            <li key={row.step} className="flex items-start gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#4C1FB8] text-[11px] font-black text-white">{row.step}</span>
              <p className="text-[13px] font-bold leading-5 text-[#334155]">{row.text}</p>
            </li>
          ))}
        </ol>
        <a
          href={`${SUPPORT_MAILTO}?subject=${encodeURIComponent('[광고등록] TaxiTago 배너 광고 문의')}`}
          className="mt-4 block rounded-2xl bg-[#4C1FB8] py-3 text-center text-sm font-black text-white"
        >
          이메일로 광고 신청하기
        </a>
        <p className="mt-2 break-all text-center text-[10px] font-bold text-[#94A3B8]">{SUPPORT_EMAIL}</p>
      </section>
    </div>
  )
}

function Home({
  destination,
  pickup,
  pickupLat,
  pickupLng,
  gpsStatus = 'ready',
  pickupFromMap = false,
  waypoints = [],
  onWaypointsChange,
  onWaypointPicked,
  onDestination,
  onService,
  onReceipt,
  onOpenMap,
  destSearchTick = 0,
  recentUse = null,
  onQrPaid,
}: {
  destination: string
  pickup: string
  pickupLat: number
  pickupLng: number
  gpsStatus?: GpsFix['status']
  pickupFromMap?: boolean
  waypoints?: string[]
  onWaypointsChange?: (value: string[]) => void
  onWaypointPicked?: (text: string, coords: RideCoords) => void
  onDestination: (value: string, coords?: RideCoords) => void
  onService: (value: string) => void
  onReceipt: (ride: RideReceipt) => void
  onOpenMap: () => void
  destSearchTick?: number
  recentUse?: RecentUse | null
  /** QR 현장 결제 완료 — 루트의 settlePiLedger로 지갑 차감·내역을 기록한다. */
  onQrPaid?: (record: { driverName: string; amount: number; memo: string }, proof: { paymentId: string; txid: string }) => void
}) {
  const { t } = useLocale()
  const [searchOpen, setSearchOpen] = useState(false)
  const [waypointSearchIndex, setWaypointSearchIndex] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [qrPayOpen, setQrPayOpen] = useState(false)
  const [favorites, setFavorites] = useState<FavoritePlace[]>([])
  const [recents, setRecents] = useState<RecentPlace[]>([])

  useEffect(() => {
    setFavorites(readFavoritePlaces())
    setRecents(readRecentPlaces())
  }, [])

  useEffect(() => {
    if (destSearchTick) setSearchOpen(true)
  }, [destSearchTick])

  const rememberRecent = (name: string, address?: string) => {
    const next = [{ id: `${Date.now()}`, name, address: address || name }, ...recents.filter((place) => place.name !== name && place.address !== address)]
    setRecents(next)
    writeRecentPlaces(next)
  }
  const select = (name: string, address?: string, coords?: RideCoords) => {
    const chosen = (address || name).trim()
    rememberRecent(name, chosen)
    onDestination(chosen, coords)
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
    onService('택시')
  }
  const callDaeri = () => {
    onService('대리운전')
  }
  const suggestedDestinations = suggestedDestinationsFor(pickup, pickupLat, pickupLng)
  const pickSuggested = (name: string, address: string) => {
    rememberRecent(name, address)
    onDestination(name, coordsFromPlaceQuery(name) ?? coordsFromPlaceQuery(address) ?? undefined)
  }
  const pickupHint =
    pickupFromMap || gpsStatus === 'ready'
      ? null
      : gpsStatus === 'pending'
        ? 'GPS로 위치를 확인하는 중이에요'
        : '탭해서 지도에서 출발지를 지정하세요'

  return (
    <main
      className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth bg-white px-3 pb-[max(6.25rem,calc(5.25rem+env(safe-area-inset-bottom)))] pt-2 [-webkit-overflow-scrolling:touch]"
      aria-label={t('home.content')}
    >
        <div className="rounded-[16px] border border-[#E2E8F0] bg-[#F8FAFC] p-1.5">
          <button
            type="button"
            onClick={() => onOpenMap()}
            className="flex w-full items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-left shadow-[0_3px_8px_rgba(15,23,42,0.05)]"
            aria-label={`${t('home.pickup')} ${pickup}`}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EEF2FF] text-[#4C1FB8]">
              <LocateFixed className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 py-0.5">
              <span className="block text-[10px] font-bold leading-3 text-[#64748B]">{t('home.pickup')}</span>
              <span className="mt-0.5 block truncate text-[13px] font-black leading-4 text-[#0F172A]">{pickup}</span>
              {pickupHint ? <span className="mt-0.5 block truncate text-[10px] font-bold leading-3 text-[#64748B]">{pickupHint}</span> : null}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#94A3B8]" />
          </button>
          {waypoints.map((waypoint, index) => (
            <div key={index} className="mt-1 flex w-full items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 shadow-[0_3px_8px_rgba(15,23,42,0.05)]">
              <button
                type="button"
                onClick={() => setWaypointSearchIndex(index)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                aria-label={`경유지 ${index + 1} 검색`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#FFF7ED] text-[#EA580C]">
                  <MapPin className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 py-0.5">
                  <span className="block text-[10px] font-bold leading-3 text-[#64748B]">경유지 {index + 1}</span>
                  <span className={`mt-0.5 block truncate text-[13px] font-black leading-4 ${waypoint ? 'text-[#0F172A]' : 'font-bold text-[#94A3B8]'}`}>
                    {waypoint || '경유할 곳을 검색해 주세요'}
                  </span>
                </span>
                <Search className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" />
              </button>
              <button
                type="button"
                onClick={() => onWaypointsChange?.(waypoints.filter((_, i) => i !== index))}
                aria-label={`경유지 ${index + 1} 삭제`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-[#64748B] transition hover:bg-[#E2E8F0] active:scale-95"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {onWaypointsChange && waypoints.length < MAX_WAYPOINTS ? (
            <button
              type="button"
              onClick={() => {
                onWaypointsChange([...waypoints, ''])
                setWaypointSearchIndex(waypoints.length)
              }}
              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#C4B5FD] bg-white px-2.5 py-1.5 text-[11px] font-black text-[#6D28D9] transition hover:bg-[#F8F5FF] active:scale-[0.99]"
            >
              <Plus className="h-3.5 w-3.5" />
              경유지 추가
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="mt-1 flex w-full items-stretch overflow-hidden rounded-lg border-2 border-[#7C3AED] bg-white text-left shadow-[0_6px_12px_rgba(124,58,237,0.1)]"
            style={{ WebkitTextSizeAdjust: '100%', textSizeAdjust: '100%' }}
            aria-label={destination ? `${t('home.dest')} ${destination}` : t('home.destSearch')}
          >
            <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2.5 py-1.5">
              <span className="block shrink-0 text-[11px] font-bold leading-4 text-[#7C3AED]">{t('home.dest')}</span>
              <span className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EDE5FF] text-[#6D28D9]">
                  <Search className="h-3.5 w-3.5" />
                </span>
                <span className={`min-w-0 flex-1 truncate text-sm font-black leading-4 ${destination ? 'text-[#0F172A]' : 'text-[#94A3B8]'}`}>
                  {destination || t('home.destPlaceholder')}
                </span>
              </span>
            </span>
            <DestinationTaxiLoop className="w-[6.75rem] shrink-0 self-stretch overflow-hidden" />
          </button>
        </div>
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {suggestedDestinations.map((place) => {
            const active = destination === place.name || destination === place.address
            return (
              <button
                key={place.name}
                type="button"
                onClick={() => pickSuggested(place.name, place.address)}
                className={`inline-flex min-h-8 shrink-0 items-center rounded-full px-3 text-[12px] font-black transition active:scale-95 ${
                  active ? 'bg-[#4C1FB8] text-white shadow-[0_6px_12px_rgba(76,31,184,0.24)]' : 'bg-[#F1F5F9] text-[#1E293B]'
                }`}
              >
                {place.name}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex w-full flex-row flex-nowrap gap-2">
          <button
            type="button"
            onClick={callTaxi}
            className="flex min-h-12 min-w-0 flex-1 items-center justify-center rounded-2xl bg-[#4C1FB8] px-2 text-[14px] font-black tracking-tight text-white shadow-[0_8px_18px_rgba(76,31,184,0.28)] transition hover:bg-[#3B16A8] active:scale-[0.99]"
          >
            {t('home.callTaxi')}
          </button>
          <button
            type="button"
            onClick={callDaeri}
            className="flex min-h-12 min-w-0 flex-1 items-center justify-center rounded-2xl border-2 border-[#4C1FB8] bg-white px-2 text-[14px] font-black tracking-tight text-[#4C1FB8] transition hover:bg-[#F8F5FF] active:scale-[0.99]"
          >
            {t('home.callDaeri')}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setQrPayOpen(true)}
          className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#4A82B8] px-3 py-3 text-[13px] font-black text-white shadow-[0_8px_18px_rgba(74,130,184,0.28)] transition hover:bg-[#3F74A8] active:scale-[0.99]"
        >
          <ScanLine className="h-5 w-5" />
          QR 코드로 결제하기
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-black">현장 결제</span>
        </button>
        <section className="mt-4">
          <div className="flex items-end justify-between px-0.5">
            <h2 className="text-sm font-black tracking-tight text-[#0F172A]">{t('home.whatToUse')}</h2>
            <span className="text-[10px] font-bold text-[#475569]">{t('home.serviceCount', { count: '8' })}</span>
          </div>
          <div className="mt-2 rounded-[22px] bg-[#E2E8F0] p-3">
            <div className="grid grid-cols-4 gap-x-2 gap-y-4">
              {services.map((item) => (
                <ServiceIconButton key={item.label} service={item} onClick={() => onService(item.label)} />
              ))}
            </div>
          </div>
        </section>
        <button type="button" onClick={() => onReceipt(recentUse ? receiptFromRecent(recentUse) : SAMPLE_RIDES[0])} className="mt-3 w-full rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-left shadow-[0_4px_10px_rgba(15,23,42,0.04)]">
          <p className="text-[10px] font-bold text-[#64748B]">{t('home.recent')}</p>
          <p className="line-clamp-2 text-[13px] font-black leading-tight">
            {recentUse ? `${recentUse.route} · ${formatRecentFare(recentUse.fare)}` : '서울시청 → 강남역 · 3.2 Pi'}
          </p>
        </button>
        <HomeEventBanners onAction={onService} />
        <HomePartnerBanners />
      {searchOpen ? (
        <DestinationSearchModal
          destination={destination}
          favorites={favorites}
          recents={recents}
          originLat={pickupLat}
          originLng={pickupLng}
          originAddress={pickup}
          onClose={() => setSearchOpen(false)}
          onSelect={select}
          onAddFavorite={() => setFormOpen(true)}
          onRemoveFavorite={removeFavorite}
          onRemoveRecent={removeRecent}
          onOpenMap={onOpenMap}
        />
      ) : null}
      {qrPayOpen ? <QrPayScanModal onClose={() => setQrPayOpen(false)} onPaid={onQrPaid} /> : null}
      {waypointSearchIndex !== null ? (
        <DestinationSearchModal
          destination={waypoints[waypointSearchIndex] ?? ''}
          favorites={favorites}
          recents={recents}
          originLat={pickupLat}
          originLng={pickupLng}
          originAddress={pickup}
          searchPlaceholder="경유지를 검색해 주세요"
          onClose={() => setWaypointSearchIndex(null)}
          onSelect={(name, address, coords) => {
            const index = waypointSearchIndex
            const text = (address || name).trim()
            if (text) {
              onWaypointsChange?.(waypoints.map((item, i) => (i === index ? text : item)))
              if (coords) onWaypointPicked?.(text, coords)
              rememberRecent(name, text)
            }
            setWaypointSearchIndex(null)
          }}
          onAddFavorite={() => setFormOpen(true)}
          onRemoveFavorite={removeFavorite}
          onRemoveRecent={removeRecent}
        />
      ) : null}
      {formOpen ? <FavoritePlaceModal onClose={() => setFormOpen(false)} onSave={addFavorite} /> : null}
    </main>
  )
}

function ReceiptModal({ ride, onClose, onNotice, onLostItem }: { ride: RideReceipt; onClose: () => void; onNotice: (message: string) => void; onLostItem?: (prefill: LostPrefill) => void }) {
  const shareReceipt = async () => {
    const title = '택시타고 영수증'
    const text = `택시타고 영수증 ${ride.transactionId}\n${[ride.origin, ...(ride.waypoints ?? []), ride.dest].join(' → ')}\n결제 ${ride.fare} · ${ride.method}\n${ride.driver} 기사님 · ${ride.car} ${ride.plate}\n${ride.date}`
    const url = typeof window !== 'undefined' ? window.location.href : ''
    const copiedMessage = '링크가 클립보드에 복사되었습니다'

    const isAbort = (error: unknown) =>
      (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError'

    const tryNativeShare = async (data: ShareData) => {
      if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false
      if (typeof navigator.canShare === 'function') {
        try {
          if (!navigator.canShare(data)) return false
        } catch {
          return false
        }
      }
      try {
        await navigator.share(data)
        return true
      } catch (error) {
        if (isAbort(error)) return true
        return false
      }
    }

    const copyLink = async (value: string) => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value)
          return true
        }
      } catch {
        /* fall through */
      }
      try {
        const input = document.createElement('textarea')
        input.value = value
        input.setAttribute('readonly', '')
        input.style.position = 'fixed'
        input.style.left = '-9999px'
        document.body.appendChild(input)
        input.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(input)
        return ok
      } catch {
        return false
      }
    }

    if (await tryNativeShare({ title, text, url })) return
    if (await tryNativeShare({ title, text })) return

    const copied = await copyLink(url || text)
    onNotice(copiedMessage)
    if (!copied) window.alert(copiedMessage)
  }
  return (
    <div className="fixed inset-0 z-[98] flex items-end bg-[#1e1033]/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto max-h-[92vh] w-full max-w-md overflow-x-hidden overflow-y-auto rounded-t-[32px] bg-white p-5 shadow-2xl sm:rounded-[32px]" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
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
          {ride.trafficSurcharge ? (
            <p className="mt-1 text-[11px] font-bold text-[#FDE68A]">정체 지연 추가 요금 {ride.trafficSurcharge}</p>
          ) : null}
          <p className="mt-2 text-xs font-black text-[#E8DCFF]">결제 수단 · {ride.method}</p>
        </div>
        <div className="mt-4 min-w-0 overflow-hidden rounded-[24px] border-2 border-[#E0D4FF] bg-[#F8F5FF] p-4">
          <p className="text-xs font-black text-[#4C1FB8]">이동 경로</p>
          <div className="mt-3 flex min-w-0 items-start gap-3">
            <div className="flex shrink-0 flex-col items-center pt-1">
              <span className="h-2.5 w-2.5 rounded-full bg-[#4C1FB8]" />
              {(ride.waypoints ?? []).map((_, index) => (
                <Fragment key={index}>
                  <span className="my-1 h-8 w-0.5 bg-[#C4B5FD]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#EA580C]" />
                </Fragment>
              ))}
              <span className="my-1 h-8 w-0.5 bg-[#C4B5FD]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#0F172A]" />
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">
              <p className="text-[11px] font-bold text-[#8b8495]">출발지</p>
              <p className="mt-0.5 break-all font-black leading-5 text-[#0F172A] [overflow-wrap:anywhere] line-clamp-3" title={ride.origin}>
                {ride.origin}
              </p>
              {(ride.waypoints ?? []).map((waypoint, index) => (
                <Fragment key={index}>
                  <p className="mt-3 text-[11px] font-bold text-[#8b8495]">
                    {(ride.waypoints?.length ?? 0) > 1 ? `경유지 ${index + 1}` : '경유지'}
                  </p>
                  <p className="mt-0.5 break-all font-black leading-5 text-[#0F172A] [overflow-wrap:anywhere] line-clamp-3" title={waypoint}>
                    {waypoint}
                  </p>
                </Fragment>
              ))}
              <p className="mt-3 text-[11px] font-bold text-[#8b8495]">도착지</p>
              <p className="mt-0.5 break-all font-black leading-5 text-[#0F172A] [overflow-wrap:anywhere] line-clamp-3" title={ride.dest}>
                {ride.dest}
              </p>
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
            <dt className="shrink-0 font-bold text-[#64748B]">영수증 번호</dt>
            <dd className="min-w-0 break-all text-right font-mono text-xs font-black leading-5 text-[#0F172A] [overflow-wrap:anywhere]">{ride.transactionId}</dd>
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
          <button
            type="button"
            onClick={() => {
              onLostItem?.({
                rideId: ride.rideId,
                route: ride.route,
                driverName: ride.driver,
                plate: ride.plate,
                vehicle: ride.car,
              })
              onClose()
            }}
            className="rounded-2xl border-2 border-[#4C1FB8] bg-white py-3.5 text-sm font-black text-[#4C1FB8]"
          >
            분실물 접수
          </button>
        </div>
        <button type="button" onClick={onClose} className="mt-2 w-full rounded-2xl bg-[#4C1FB8] py-3.5 text-sm font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.35)]">
          내역 닫기
        </button>
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

const INBOX_RIDE_STATUS: Record<string, string> = {
  searching: '호출 중',
  offered: '배차 제안',
  assigned: '운행 중',
  unmatched: '배차 실패',
  cancelled: '취소됨',
  completed: '이용 완료',
}

function receiptFromRideHistory(ride: PublicRide): RideReceipt {
  const origin = ride.pickup.address || ride.pickup.label || '출발지'
  const waypoints = (ride.waypoints ?? []).map((point) => point.label || point.address || '경유지').filter(Boolean)
  const dest = ride.dest.label || ride.dest.address || '목적지'
  const paid = ride.escrow?.amount ?? ride.estimatedFare
  return {
    rideId: ride.id,
    route: [origin, ...waypoints, dest].join(' → '),
    origin,
    waypoints: waypoints.length ? waypoints : undefined,
    dest,
    fare: `${paid.toFixed(7)} Pi`,
    estimatedFare: `${ride.estimatedFare.toFixed(7)} Pi`,
    vehicle: ride.kind === 'daeri' ? '대리' : '택시',
    date: new Date(ride.updatedAt).toLocaleString('ko-KR'),
    distance: '-',
    duration: '-',
    driver: ride.assignedDriver?.name || '기사 배정 전',
    car: ride.assignedDriver?.vehicle || '-',
    plate: ride.assignedDriver?.plate || '-',
    transactionId: ride.escrow?.payoutTxid || ride.escrow?.lockTxid || ride.id,
    method: 'Pi 월렛',
  }
}

type InboxIdentity = { id: string; role: 'passenger' | 'driver' }

const PAYMENT_ACTIVITY_LABELS = new Set(['결제 완료', '취소 수수료 결제', 'Pi 충전 완료', 'Pi 환불'])

function ActivityInbox({
  tabRides,
  readNoticeIds,
  onOpenInbox,
  identities,
  activities,
  transactions,
}: {
  tabRides: (ride: RideReceipt) => void
  readNoticeIds: string[]
  onOpenInbox: (item: Notice) => void
  identities: InboxIdentity[]
  activities: ActivityEntry[]
  transactions: PiTransaction[]
}) {
  const [view, setView] = useState<'rides' | 'inbox'>('rides')
  const [history, setHistory] = useState<PublicRide[]>([])
  const [historyReady, setHistoryReady] = useState(false)
  const unreadCount = notices.filter((item) => !readNoticeIds.includes(item.id)).length
  const identitiesKey = JSON.stringify(identities)

  useEffect(() => {
    const ids = JSON.parse(identitiesKey) as InboxIdentity[]
    let stopped = false
    const refresh = () => {
      void Promise.all(ids.map((item) => fetchRideHistory(item.id, item.role)))
        .then((lists) => {
          if (stopped) return
          const seen = new Set<string>()
          const merged: PublicRide[] = []
          for (const ride of lists.flat()) {
            if (seen.has(ride.id)) continue
            seen.add(ride.id)
            merged.push(ride)
          }
          merged.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          setHistory(merged)
          setHistoryReady(true)
        })
        .catch(() => {
          if (!stopped) setHistoryReady(true)
        })
    }
    refresh()
    const timer = window.setInterval(refresh, 5000)
    const wake = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    // 지갑/정산 변경 브로드캐스트 — 5초 폴링을 기다리지 않고 즉시 갱신한다.
    window.addEventListener('taxitago:ledger-changed', refresh)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('taxitago:ledger-changed', refresh)
    }
  }, [identitiesKey])

  const kindClass = (kind: Notice['kind']) =>
    kind === '이벤트' ? 'bg-[#FEF3C7] text-[#B45309]' : kind === '업데이트' ? 'bg-[#DBEAFE] text-[#1D4ED8]' : 'bg-[#EDE5FF] text-[#4C1FB8]'
  const localEntries = [
    ...transactions.map((tx, index) => ({ id: `tx-${index}`, label: tx.label, detail: tx.detail || tx.place, amount: tx.amount, at: tx.at, ts: tx.ts ?? 0 })),
    ...activities
      .filter((entry) => !PAYMENT_ACTIVITY_LABELS.has(entry.label))
      .map((entry) => ({ id: entry.id, label: entry.label, detail: entry.detail, amount: null as number | null, at: entry.at, ts: entry.ts ?? 0 })),
  ].sort((a, b) => b.ts - a.ts)

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-4 pb-8 [-webkit-overflow-scrolling:touch]">
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
          {history.map((ride) => {
            const receipt = receiptFromRideHistory(ride)
            const statusLabel = INBOX_RIDE_STATUS[ride.status] ?? ride.status
            return (
              <button key={ride.id} type="button" onClick={() => tabRides(receipt)} className="mt-3 w-full rounded-3xl border-2 border-[#CBD5E1] bg-white p-4 text-left shadow-[0_8px_18px_rgba(15,23,42,0.1)] transition hover:border-[#4C1FB8] active:scale-[0.99]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 overflow-hidden pr-1">
                    <p className="break-all font-black leading-5 text-[#1E293B] [overflow-wrap:anywhere] line-clamp-2">{receipt.route}</p>
                    <p className="mt-2 truncate text-xs font-bold text-[#64748B]">
                      {receipt.vehicle} · {receipt.date}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <strong className="block whitespace-nowrap tabular-nums text-[#7046dc]">{receipt.fare}</strong>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-black ${ride.status === 'completed' ? 'bg-[#ECFDF5] text-[#047857]' : ride.status === 'cancelled' || ride.status === 'unmatched' ? 'bg-[#F1F5F9] text-[#64748B]' : 'bg-[#FEF3C7] text-[#B45309]'}`}>{statusLabel}</span>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-[#E2E8F0] pt-3 text-xs font-bold text-[#8b8495]">
                  <span>{receipt.driver !== '기사 배정 전' ? `${receipt.driver} 기사` : receipt.driver}</span>
                  <span className="text-[#7046dc]">영수증 보기 ›</span>
                </div>
              </button>
            )
          })}
          {localEntries.length ? (
            <div className="mt-3 space-y-2">
              {localEntries.slice(0, 30).map((entry) => (
                <div key={entry.id} className="rounded-2xl border-2 border-[#E2E8F0] bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-black text-[#0F172A]">{entry.label}</p>
                    {entry.amount != null ? (
                      <span className={`shrink-0 text-sm font-black tabular-nums ${entry.amount < 0 ? 'text-[#0F172A]' : 'text-[#047857]'}`}>{entry.amount > 0 ? '+' : ''}{entry.amount.toFixed(7)} Pi</span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-xs font-bold text-[#64748B]">{entry.detail}</p>
                    <span className="shrink-0 text-[11px] font-bold text-[#8b8495]">{entry.at}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {historyReady && !history.length && !localEntries.length ? (
            <p className="mt-3 rounded-3xl border-2 border-dashed border-[#CBD5E1] bg-white p-5 text-center text-sm font-bold text-[#64748B]">아직 이용 내역이 없습니다.</p>
          ) : null}
        </>
      ) : (
        <div className="mt-3 space-y-3">
          {activities.slice(0, 15).map((entry) => (
            <div key={entry.id} className="rounded-[24px] border-2 border-[#CBD5E1] bg-white p-4 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-[#EDE5FF] px-2 py-1 text-[10px] font-black text-[#4C1FB8]">{entry.label}</span>
                <span className="text-[11px] font-bold text-[#8b8495]">{entry.at}</span>
              </div>
              <p className="mt-2 text-xs font-bold leading-5 text-[#64748B]">{entry.detail}</p>
            </div>
          ))}
          {activities.length ? <p className="pt-1 text-xs font-black text-[#4C1FB8]">공지</p> : null}
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
  inboxIdentities,
  activities,
  transactions,
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
  inboxIdentities: InboxIdentity[]
  activities: ActivityEntry[]
  transactions: PiTransaction[]
}) {
  const { t } = useLocale()
  const [preparingOpen, setPreparingOpen] = useState(false)
  if (tab === '전체보기') {
    return (
      <>
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth px-4 pb-8 pt-1 [-webkit-overflow-scrolling:touch]" aria-label={t('nav.all')}>
        <h2 className="pt-2 text-2xl font-black">{t('nav.all')}</h2>
        <p className="mt-1 text-sm font-bold text-[#64748B]">{t('nav.allCaption')}</p>
        <section className="mt-4 pb-2">
          <p className="mb-2 text-xs font-black text-[#475569]">{t('more.guide')}</p>
          <MoreMenu />
          <p className="mb-2 mt-5 text-xs font-black text-[#475569]">{t('more.mobility')}</p>
          <div className="rounded-[22px] bg-[#E2E8F0] p-3 pb-5">
            <div className="grid grid-cols-4 gap-x-2 gap-y-4">
              {menuMobilityServices(true).map((item) => (
                <ServiceIconButton
                  key={item.label}
                  service={item}
                  wrapLabel={isComingSoonService(item.label)}
                  onClick={() => {
                    if (isComingSoonService(item.label)) {
                      setPreparingOpen(true)
                      return
                    }
                    onService(item.label)
                  }}
                />
              ))}
            </div>
          </div>
        </section>
      </main>
      {preparingOpen ? <ServicePreparingModal onClose={() => setPreparingOpen(false)} /> : null}
      </>
    )
  }
  if (tab === '이용/알림') {
    return <ActivityInbox tabRides={onReceipt} readNoticeIds={readNoticeIds} onOpenInbox={onOpenInbox} identities={inboxIdentities} activities={activities} transactions={transactions} />
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
      activities={activities}
      transactions={transactions}
    />
    </div>
  )
}

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
  onDeposit: (amount: number, ts?: number) => void
  onWithdraw: (amount: number, address: string) => Promise<{ txid?: string } | void>
  transactions: PiTransaction[]
  onNotice: (message: string) => void
  onReceipt: (ride: RideReceipt) => void
}) {
  const [tab, setTab] = useState<'charge' | 'refund' | 'history'>('charge')
  const [chargeValue, setChargeValue] = useState<number | ''>(10)
  // 출금 주소 — Pi 연동 지갑으로 자동 채워지고, 이용자가 수정해 저장할 수 있다.
  const [address, setAddress] = useState('')
  const [addressDraft, setAddressDraft] = useState('')
  const [editingAddress, setEditingAddress] = useState(false)
  const [amount, setAmount] = useState('')
  const [depositAddress, setDepositAddress] = useState(DEFAULT_DEPOSIT_ADDRESS)
  const [process, setProcess] = useState<{ kind: 'charge' | 'withdraw'; phase: 'pending' | 'done'; amount: number; txid?: string } | null>(null)
  const [historyRange, setHistoryRange] = useState<'all' | 'week' | 'month' | 'year'>('all')
  const chargeUnits = [5, 10, 25, 50]
  // 최근 24시간 충전 누적 — 한도는 최대 50 Pi로 고정(지갑 내역은 localStorage에 보존됨).
  const chargeNow = Date.now()
  const charged24h = transactions
    .filter((tx) => tx.label === 'Pi 충전' && typeof tx.ts === 'number' && chargeNow - tx.ts >= 0 && chargeNow - tx.ts < 24 * 60 * 60 * 1000)
    .reduce((sum, tx) => sum + Math.max(0, tx.amount), 0)
  const chargeCapRemaining = Math.max(0, Math.round((PI_CHARGE_MAX_PI - charged24h) * 1_000_000) / 1_000_000)
  const chargeAmount = typeof chargeValue === 'number' ? chargeValue : Number.NaN
  const chargeOverCap = Number.isFinite(chargeAmount) && chargeAmount > chargeCapRemaining + 1e-9
  const chargeValid = Number.isFinite(chargeAmount) && chargeAmount > 0 && !chargeOverCap
  const withdrawValue = Number(amount)

  const applyChargeAmount = (value: number) => {
    setChargeValue(Math.round(value * 100) / 100)
  }

  useEffect(() => {
    const saved = loadDepositAddress()
    setDepositAddress(saved)
    // 플랫폼 공식 수신 지갑을 서버에서 가져와 저장된 임시/구형 주소를 갱신한다.
    // 모달이 열려 있는 동안 주기적으로 다시 확인해 관리자 변경이 즉시 반영되게 한다.
    let stopped = false
    const sync = async () => {
      const official = await fetchDepositWallet()
      if (stopped || !isPiWalletAddress(official)) return
      setDepositAddress((prev) => {
        if (prev === official) return prev
        saveDepositAddress(official)
        return official
      })
    }
    void sync()
    const timer = window.setInterval(sync, 10_000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [])

  const depositAddressValid = isPiWalletAddress(depositAddress)

  // 출금 주소 초기화 — 저장된 지정 주소를 우선 쓰되, 다른 uid의 저장값은
  // 재사용하지 않는다(계정 전환 시 타인 주소가 남는 사고 방지). 없으면
  // Pi 연동으로 확인된 본인 지갑 주소를 자동 기입한다.
  useEffect(() => {
    const identity = loadPiIdentity()
    const uid = identity?.uid?.trim() || ''
    const linked = identity?.wallet?.trim() || ''
    let saved = ''
    try {
      const parsed = JSON.parse(localStorage.getItem(WITHDRAW_ADDRESS_KEY) || 'null') as { uid?: string; address?: string } | null
      if (parsed?.address && (!parsed.uid || parsed.uid === uid)) saved = parsed.address.trim()
    } catch {
      /* ignore malformed cache */
    }
    setAddress(saved || linked)
    setAddressDraft(saved || linked)
  }, [])

  const saveWithdrawAddress = () => {
    const next = addressDraft.trim()
    if (!isPiWalletAddress(next)) {
      onNotice('Pi 지갑 주소 형식을 확인해 주세요. (G로 시작하는 56자리)')
      return
    }
    try {
      localStorage.setItem(WITHDRAW_ADDRESS_KEY, JSON.stringify({ uid: loadPiIdentity()?.uid || '', address: next }))
    } catch {
      /* storage may be unavailable */
    }
    setAddress(next)
    setEditingAddress(false)
    onNotice('출금 주소를 저장했습니다.')
  }

  const copyWithdrawAddress = async () => {
    try {
      await navigator.clipboard.writeText(address)
    } catch {
      /* clipboard may be unavailable in some browsers */
    }
    onNotice('출금 주소가 복사되었습니다')
  }

  // 자동 입금 감지 — 연동된 내 Pi 지갑에서 플랫폼 수신지로 들어온 온체인 결제를
  // 서버가 Horizon으로 스캔해 장부화하고, 여기서 잔액에 즉시 반영한다.
  useEffect(() => {
    const identity = loadPiIdentity()
    const wallet = identity?.wallet?.trim() || ''
    const uid = identity?.uid?.trim() || ''
    // uid만 있어도 폴러가 돌아야 한다 — 지갑 주소가 유사주소·미설정이면 서버가
    // uid 귀속(fromUid·지갑↔uid 매핑)으로 입금을 찾아준다.
    if (!uid && !isPiWalletAddress(wallet)) return
    let stopped = false
    const scan = () =>
      scanPiDeposits(isPiWalletAddress(wallet) ? wallet : '', uid, (amount, _txid, ts) => {
        if (stopped) return
        onDeposit(amount, ts)
        setProcess((prev) => (prev?.phase === 'pending' ? prev : { kind: 'charge', phase: 'done', amount }))
      })
    void scan()
    const timer = window.setInterval(scan, 8000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
    // onDeposit은 매 렌더 새로 만들어지지만 스캔 루프는 마운트 시 한 번이면 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (process?.phase !== 'pending' || process.kind !== 'withdraw') return
    const value = process.amount
    const dest = address.trim()
    let cancelled = false
    // 서버 A2U 송금이 실제로 성공해야만 완료 처리 — 실패 시 차감 없이 에러 안내.
    void Promise.resolve(onWithdraw(value, dest))
      .then((result) => {
        if (!cancelled) setProcess({ kind: 'withdraw', phase: 'done', amount: value, txid: result?.txid })
      })
      .catch((error) => {
        if (cancelled) return
        setProcess(null)
        onNotice(error instanceof Error ? error.message : '출금 전송에 실패했어요.')
      })
    return () => {
      cancelled = true
    }
    // Callbacks are recreated each parent render; only restart when a new pending request starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [process?.phase, process?.kind, process?.amount])

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(depositAddress)
    } catch {
      /* clipboard may be unavailable in some browsers */
    }
    onNotice('주소가 복사되었습니다')
  }

  const setQuickAmount = (ratio: number) => {
    const value = Math.round(balance * ratio * 100) / 100
    setAmount(value > 0 ? value.toFixed(7) : '0')
  }

  const requestWithdraw = () => {
    if (process) return
    const dest = address.trim()
    if (dest && !isPiWalletAddress(dest)) {
      onNotice('저장된 출금 주소 형식이 올바르지 않습니다. 주소를 다시 확인해 주세요.')
      return
    }
    if (!(dest || loadPiIdentity()?.uid) || !withdrawValue || withdrawValue <= 0 || withdrawValue > balance) {
      onNotice('Pi 계정 연동과 출금 가능 금액을 확인해 주세요.')
      return
    }
    setProcess({ kind: 'withdraw', phase: 'pending', amount: withdrawValue })
  }

  const tabs = [
    { id: 'charge' as const, label: '충전' },
    { id: 'refund' as const, label: '출금ㆍ환불' },
    { id: 'history' as const, label: '이용 내역' },
  ]

  const historyRanges = [
    { id: 'all' as const, label: '전체' },
    { id: 'week' as const, label: '주간' },
    { id: 'month' as const, label: '월간' },
    { id: 'year' as const, label: '년간' },
  ]
  const historyNow = new Date()
  const historyStart =
    historyRange === 'week'
      ? historyNow.getTime() - 7 * 24 * 60 * 60 * 1000
      : historyRange === 'month'
        ? new Date(historyNow.getFullYear(), historyNow.getMonth(), 1).getTime()
        : historyRange === 'year'
          ? new Date(historyNow.getFullYear(), 0, 1).getTime()
          : 0
  const historyTransactions = transactions.filter((tx) => {
    if (historyRange === 'all') return true
    const ts = typeof tx.ts === 'number' ? tx.ts : 0
    return ts >= historyStart
  })
  const historySum = (match: (tx: (typeof transactions)[number]) => boolean) =>
    historyTransactions.filter(match).reduce((total, tx) => total + Math.abs(tx.amount), 0)
  const historyCategorized = (tx: (typeof transactions)[number]) =>
    (tx.label === 'Pi 충전' && tx.amount > 0) ||
    ((tx.label === 'Pi 환불' || tx.label === 'Pi 출금') && tx.amount < 0) ||
    (tx.label === '리뷰 적립' && tx.amount > 0) ||
    (tx.amount < 0 && /택시|대리/.test(tx.label))
  const historyStats = [
    { label: '총 충전', value: historySum((tx) => tx.label === 'Pi 충전' && tx.amount > 0), tone: 'text-[#059669]' },
    { label: '총 출금·환불', value: historySum((tx) => (tx.label === 'Pi 환불' || tx.label === 'Pi 출금') && tx.amount < 0), tone: 'text-[#DC2626]' },
    { label: '총 리뷰 이벤트', value: historySum((tx) => tx.label === '리뷰 적립' && tx.amount > 0), tone: 'text-[#D97706]' },
    { label: '총 택시 이용', value: historySum((tx) => tx.amount < 0 && /택시|대리/.test(tx.label)), tone: 'text-[#2563EB]' },
  ]
  // 분류되지 않는 나머지(택배·자전거·킥보드·EV·주차·취소 수수료 등)도 합계에 포함해
  // 기초 잔액 + 전체 기간 순변동이 '사용 가능 잔액'과 정확히 일치하도록 한다.
  const historyOtherNet = historyTransactions.filter((tx) => !historyCategorized(tx)).reduce((total, tx) => total + tx.amount, 0)
  const historyNet = historyTransactions.reduce((total, tx) => total + tx.amount, 0)
  const historyOpening = Math.round((balance - transactions.reduce((total, tx) => total + tx.amount, 0)) * 1_000_000) / 1_000_000

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
            {balance.toFixed(7)} <span className="text-lg text-[#E8DCFF]">Pi</span>
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
          <div className="mt-4 flex flex-col gap-3">
            <section className="order-3 rounded-3xl border-2 border-[#E0D4FF] bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-black">입금 주소</p>
                <span className="rounded-full bg-[#EDE5FF] px-2 py-1 text-[10px] font-black text-[#4C1FB8]">입금 전용</span>
              </div>
              <p className="mt-2 text-xs font-bold text-[#8b8495]">Pi Wallet 앱에서 아래 주소(G로 시작하는 56자리 Pi 주소)로 송금하면 잔액이 충전됩니다.</p>
              {!depositAddressValid ? (
                <p className="mt-2 rounded-xl bg-[#FFFBEB] px-3 py-2 text-[11px] font-black leading-4 text-[#B45309]">
                  플랫폼 입금 지갑이 아직 등록되지 않았습니다. 아래 임시 표시는 실제 Pi 주소가 아니므로 송금하지 마세요. Pi Browser에서는 위 충전 버튼의 SDK 결제로 바로 충전할 수 있습니다.
                </p>
              ) : null}
              <div className="mt-3 flex items-center gap-2 rounded-2xl border-2 border-[#D8CCF5] bg-[#F8F5FF] px-3 py-3">
                <p className="min-w-0 flex-1 break-all font-mono text-xs font-bold text-[#3B16A8]">{depositAddress}</p>
                <button type="button" disabled={!depositAddressValid} onClick={copyAddress} className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-[#4C1FB8] px-3 py-2 text-[11px] font-black text-white disabled:opacity-40">
                  <Copy className="h-3.5 w-3.5" />
                  복사
                </button>
              </div>
            </section>
            <p className="order-2 rounded-2xl border border-[#F2DCB8] bg-[#FFFBEB] px-4 py-2.5 text-center text-xs font-black text-[#B45309]">
              파이 충전이 안 될 시 아래 입금 주소로 수동 충전 하세요
            </p>
            <section className="order-1 rounded-3xl border-2 border-[#E0D4FF] bg-white p-3.5">
              <p className="font-black">파이 충전 단위</p>
              <p className="mt-1 text-xs font-bold text-[#8b8495]">빠른 선택을 누르거나, 원하는 수량을 직접 입력해 주세요. 24시간 충전 한도는 {PI_CHARGE_MAX_PI} Pi입니다.</p>
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#F1EBFF] px-3 py-1.5 text-[11px] font-black text-[#4C1FB8]">
                <WalletCards className="h-3.5 w-3.5" />
                파이 지갑과 연동되어 충전 됩니다
              </p>
              <p className={`mt-1.5 text-xs font-black ${chargeCapRemaining > 0 ? 'text-[#4C1FB8]' : 'text-[#DC2626]'}`}>
                {chargeCapRemaining > 0 ? `남은 한도 ${chargeCapRemaining.toFixed(7)} Pi` : '24시간 충전 한도를 모두 사용했어요'}
              </p>
              <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                {chargeUnits.map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    disabled={unit > chargeCapRemaining}
                    onClick={() => applyChargeAmount(unit)}
                    className={`rounded-xl py-2.5 text-sm font-black disabled:opacity-40 ${chargeValid && chargeAmount === unit ? 'bg-[#4C1FB8] text-white shadow-[0_8px_16px_rgba(76,31,184,0.28)]' : 'bg-[#F1EBFF] text-[#4C1FB8]'}`}
                  >
                    {unit}
                  </button>
                ))}
              </div>
              <label className="mt-3 block" htmlFor="pi-charge-amount">
                <span className="text-xs font-black text-[#334155]">직접 입력</span>
                <div className="mt-1.5 flex items-center gap-2 rounded-xl border-2 border-[#D8CCF5] bg-[#F8F5FF] px-3 py-2 focus-within:border-[#4C1FB8]">
                  <input
                    id="pi-charge-amount"
                    name="chargeAmount"
                    type="number"
                    min={0.01}
                    max={PI_CHARGE_MAX_PI}
                    step="any"
                    inputMode="decimal"
                    autoComplete="off"
                    value={chargeValue}
                    onChange={(event) => {
                      const raw = event.target.value
                      if (raw === '') {
                        setChargeValue('')
                        return
                      }
                      const next = event.target.valueAsNumber
                      setChargeValue(Number.isFinite(next) ? next : '')
                    }}
                    placeholder="원하는 수량"
                    aria-label="충전할 Pi 수량 직접 입력"
                    className="min-w-0 flex-1 bg-transparent text-base font-black tabular-nums text-[#0F172A] outline-none [appearance:auto]"
                  />
                  <span className="shrink-0 text-sm font-black text-[#4C1FB8]">Pi</span>
                </div>
              </label>
              {chargeOverCap ? (
                <p className="mt-2 rounded-xl bg-[#FEF2F2] px-3 py-2 text-[11px] font-black text-[#DC2626]">
                  24시간 충전 한도 {PI_CHARGE_MAX_PI} Pi를 초과할 수 없어요. {chargeCapRemaining > 0 ? `남은 한도는 ${chargeCapRemaining.toFixed(7)} Pi입니다.` : '한도를 모두 사용했습니다.'}
                </p>
              ) : null}
              <div className="mt-3 flex items-center justify-between rounded-xl bg-[#F8F5FF] px-3.5 py-2.5">
                <span className="text-xs font-bold text-[#64748B]">신청 수량</span>
                <strong className="text-base font-black text-[#4C1FB8]">{chargeValid ? `${chargeAmount.toFixed(7)} Pi` : '—'}</strong>
              </div>
              <button
                type="button"
                disabled={Boolean(process) || !chargeValid}
                className="mt-3 w-full rounded-xl bg-[#4C1FB8] py-3 text-sm font-black text-white shadow-[0_12px_24px_rgba(76,31,184,0.35)] disabled:opacity-60"
                onClick={() => {
                  if (process || !chargeValid) {
                    if (chargeOverCap) onNotice(`24시간 충전 한도 ${PI_CHARGE_MAX_PI} Pi를 초과할 수 없어요.`)
                    return
                  }
                  const amount = Math.min(Math.round(chargeAmount * 100) / 100, chargeCapRemaining)
                  if (!(amount > 0)) {
                    onNotice('24시간 충전 한도를 모두 사용했어요.')
                    return
                  }
                  setProcess({ kind: 'charge', phase: 'pending', amount })
                  void chargePiWallet(amount)
                    .then((result) => {
                      const txid = typeof result?.txid === 'string' ? result.txid : ''
                      // 서버 크레딧 보증 — after() 크레딧이나 스캐너가 놓쳐도 paymentId
                      // 소유권 증명으로 입금을 내 uid에 귀속시킨다(txid 멱등).
                      const claimUid = loadPiIdentity()?.uid?.trim() || ''
                      const claimPaymentId = typeof result?.paymentId === 'string' ? result.paymentId : ''
                      if (claimUid && claimPaymentId) {
                        void fetch('/api/wallet/deposits', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ paymentId: claimPaymentId, txid, uid: claimUid, sandbox: PI_SANDBOX }),
                        }).catch(() => undefined)
                      }
                      // 이미 Horizon 폴러가 온체인 입금으로 충전한 건이면 중복 반영하지 않는다.
                      if (!isPiDepositCredited(txid)) {
                        markPiDepositCredited(txid)
                        onDeposit(amount)
                      }
                      setProcess({ kind: 'charge', phase: 'done', amount })
                    })
                    .catch((error) => {
                      setProcess(null)
                      onNotice(describePiUserMessage(error))
                    })
                }}
              >
                {chargeValid ? `${chargeAmount.toFixed(7)} Pi 충전 신청` : '충전 신청'}
              </button>
            </section>
          </div>
        )}
        {tab === 'refund' && (
          <section className="mt-4 rounded-3xl border-2 border-[#E0D4FF] bg-white p-4">
            <p className="font-black">출금ㆍ환불</p>
            <p className="mt-1 text-xs font-bold text-[#8b8495]">보유 Pi를 저장된 출금 주소로 보내거나, 결제 금액을 환불받을 때 사용합니다. 실제 블록체인 전송 후 txid가 기록에 남습니다.</p>
            <div className="mt-4 rounded-2xl border-2 border-[#D8CCF5] bg-[#F8F5FF] p-3.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black text-[#334155]">내 출금 주소</p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={copyWithdrawAddress}
                    disabled={!address}
                    className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-[#4C1FB8] disabled:opacity-50"
                  >
                    복사
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddressDraft(address)
                      setEditingAddress((value) => !value)
                    }}
                    className="rounded-full bg-[#EDE5FF] px-2.5 py-1 text-[10px] font-black text-[#4C1FB8]"
                  >
                    {editingAddress ? '취소' : '수정'}
                  </button>
                </div>
              </div>
              {editingAddress ? (
                <>
                  <input
                    value={addressDraft}
                    onChange={(event) => setAddressDraft(event.target.value)}
                    placeholder="G로 시작하는 56자리 Pi 지갑 주소"
                    spellCheck={false}
                    autoComplete="off"
                    className="mt-2 w-full rounded-xl border-2 border-[#D8CCF5] bg-white px-3 py-2 font-mono text-xs font-bold text-[#0F172A] outline-none focus:border-[#4C1FB8]"
                  />
                  {addressDraft.trim() && !isPiWalletAddress(addressDraft) ? (
                    <p className="mt-1 text-[10px] font-black text-[#DC2626]">
                      ⚠ {piWalletError(addressDraft) ?? 'Pi 지갑 주소 형식이 올바르지 않습니다.'}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={!isPiWalletAddress(addressDraft)}
                    onClick={saveWithdrawAddress}
                    className="mt-2 w-full rounded-xl bg-[#4C1FB8] py-2 text-xs font-black text-white disabled:opacity-50"
                  >
                    주소 저장
                  </button>
                </>
              ) : (
                <p className="mt-1.5 break-all font-mono text-[11px] font-bold leading-4 text-[#0F172A]">
                  {address || '연동된 Pi 계정 지갑'}
                </p>
              )}
              <p className="mt-1.5 text-[10px] font-bold text-[#8b8495]">
                {isPiWalletAddress(address)
                  ? '이 주소로 출금됩니다. 주소를 다시 한 번 확인해 주세요.'
                  : '주소가 없으면 연동된 Pi 계정 지갑으로 출금됩니다.'}
              </p>
            </div>
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
            <div className="flex gap-1.5 rounded-2xl bg-white p-1 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
              {historyRanges.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setHistoryRange(item.id)}
                  className={`flex-1 rounded-xl py-2 text-xs font-black transition ${historyRange === item.id ? 'bg-[#4C1FB8] text-white shadow-[0_8px_16px_rgba(76,31,184,0.28)]' : 'text-[#64748B]'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <section className="rounded-2xl border border-[#E2E8F0] bg-white p-3.5 shadow-[0_8px_18px_rgba(15,23,42,0.06)]">
              <p className="text-[11px] font-black text-[#64748B]">기간 요약</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {historyStats.map((stat) => (
                  <div key={stat.label} className="rounded-xl bg-[#F8FAFC] px-3 py-2.5">
                    <p className="text-[10px] font-bold text-[#64748B]">{stat.label}</p>
                    <p className={`mt-0.5 text-sm font-black tabular-nums ${stat.tone}`}>{stat.value.toFixed(7)} Pi</p>
                  </div>
                ))}
                <div className="col-span-2 rounded-xl bg-[#F8FAFC] px-3 py-2.5">
                  <p className="text-[10px] font-bold text-[#64748B]">기타 결제·조정</p>
                  <p className="mt-0.5 text-sm font-black tabular-nums text-[#475569]">
                    {historyOtherNet >= 0 ? '+' : ''}{historyOtherNet.toFixed(7)} Pi
                  </p>
                </div>
              </div>
              {historyRange === 'all' ? (
                <p className="mt-2.5 rounded-xl bg-[#F1F5F9] px-3 py-2 text-[11px] font-black leading-4 text-[#334155]">
                  기초 지급·조정 {historyOpening.toFixed(7)} + 기간 합계 {(historyNet >= 0 ? '+' : '')}{historyNet.toFixed(7)} = 현재 잔액 {balance.toFixed(7)} Pi
                </p>
              ) : (
                <p className="mt-2.5 rounded-xl bg-[#F1F5F9] px-3 py-2 text-[11px] font-black text-[#334155]">
                  기간 순변동 {(historyNet >= 0 ? '+' : '')}{historyNet.toFixed(7)} Pi
                </p>
              )}
            </section>
            {historyTransactions.length === 0 && (
              <p className="rounded-2xl border-2 border-dashed border-[#D8CCF5] bg-white p-5 text-center text-sm font-bold text-[#64748B]">
                해당 기간에 이용 내역이 없습니다.
              </p>
            )}
            {historyTransactions.map((transaction, index) => (
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
                    {transaction.amount.toFixed(7)} Pi
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
              {process.kind === 'charge' ? '충전' : '출금ㆍ환불'} {process.amount.toFixed(7)} Pi 트랜잭션을 Pi Network에서 확인하고 있습니다.
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
            <h3 className="mt-4 text-xl font-black text-[#0F172A]">{process.kind === 'charge' ? '충전이 완료되었습니다!' : '출금이 완료되었습니다'}</h3>
            <p className="mt-2 text-sm font-bold text-[#64748B]">
              {process.kind === 'charge' ? '충전' : '출금ㆍ환불'} {process.amount.toFixed(7)} Pi가 월렛에 반영되었습니다.
            </p>
            {process.txid ? (
              <p className="mt-2 break-all rounded-xl bg-[#F8F5FF] px-3 py-2 text-[11px] font-black text-[#4C1FB8]">
                전송 해시 {process.txid.slice(0, 20)}…
              </p>
            ) : null}
            {process.kind === 'charge' ? (
              <p className="mt-2 rounded-xl bg-[#F8F5FF] px-3 py-2 text-sm font-black text-[#4C1FB8]">현재 잔액 {balance.toFixed(7)} Pi</p>
            ) : null}
            <button type="button" onClick={() => setProcess(null)} className="mt-5 w-full rounded-2xl bg-[#4C1FB8] py-3.5 font-black text-white">
              확인
            </button>
          </section>
        </div>
      )}
    </div>
  )
}

function WithdrawConfirmModal({ busy, onConfirm, onClose }: { busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[97] flex items-center justify-center bg-[#1e1033]/55 px-5" onClick={onClose}>
      <section className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <h2 className="text-lg font-bold leading-snug text-[#0F172A]">정말로 회원 탈퇴 하시겠습니까?</h2>
        <p className="mt-2 text-sm font-medium leading-6 text-[#64748B]">승인하면 계정 연동이 해제되고 로그아웃됩니다. 지갑 잔액이 남아있으면 탈퇴할 수 없습니다.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-2xl border-2 border-[#CBD5E1] bg-white py-3 text-sm font-bold text-[#334155] disabled:opacity-60">
            돌아가기
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className="rounded-2xl bg-[#B91C1C] py-3 text-sm font-bold text-white disabled:opacity-60">
            {busy ? '처리 중…' : '회원탈퇴'}
          </button>
        </div>
      </section>
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
  activities = [],
}: {
  kind: 'activity' | 'account'
  username: string
  piLinked: boolean
  onClose: () => void
  onLinkPi: () => void | Promise<void>
  onUnlinkPi: () => void | Promise<void | boolean>
  activities?: ActivityEntry[]
}) {
  const isActivity = kind === 'activity'
  const [linking, setLinking] = useState(false)
  const [unlinkConfirm, setUnlinkConfirm] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const showLinked = piLinked
  const connect = () => {
    if (linking || piLinked) return
    setLinking(true)
    void Promise.resolve(onLinkPi()).finally(() => setLinking(false))
  }
  const unlink = () => {
    if (withdrawing) return
    setWithdrawing(true)
    void Promise.resolve(onUnlinkPi())
      // 거부(false)면 확인 모달을 닫지 않는다 — 사유는 logoutMember가 표시.
      .then((ok) => { if (ok !== false) setUnlinkConfirm(false) })
      .catch(() => undefined)
      .finally(() => setWithdrawing(false))
  }
  return (
    <>
    {unlinkConfirm ? <WithdrawConfirmModal busy={withdrawing} onConfirm={unlink} onClose={() => { if (!withdrawing) setUnlinkConfirm(false) }} /> : null}
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
          <div className="mt-5 max-h-[50vh] space-y-3 overflow-y-auto">
            {activities.length === 0 ? (
              <p className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-4 text-sm font-bold text-[#64748B]">아직 활동이 없어요. 호출, 결제, 취소가 여기에 쌓입니다.</p>
            ) : (
              activities.map((item) => (
                <div key={item.id} className="flex gap-3 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <span className="shrink-0 font-mono text-xs font-bold text-[#4A82B8]">{item.at}</span>
                  <div>
                    <p className="text-sm font-bold text-[#0F172A]">{item.label}</p>
                    <p className="mt-1 text-xs font-medium text-[#64748B]">{item.detail}</p>
                  </div>
                </div>
              ))
            )}
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
            <button
              type="button"
              onClick={() => setUnlinkConfirm(true)}
              className="flex min-h-12 w-full items-center justify-center rounded-2xl border-2 border-[#FECACA] bg-[#FEF2F2] px-3 py-3.5 text-sm font-bold text-[#B91C1C] transition hover:bg-[#FEE2E2] active:scale-[0.99]"
            >
              회원 탈퇴
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4">
              <p className="text-lg font-bold leading-snug text-[#0F172A]">파이 계정으로 로그인할까요?</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#334155]">Pi Sign-in이 끝나면 고유 UID와 지갑 주소가 프로필·정산에 연동됩니다.</p>
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
              {linking ? 'Pi Sign-in 중…' : '파이 계정 로그인'}
            </button>
            <button type="button" onClick={onClose} className="w-full py-2 text-sm font-bold text-[#64748B]">
              나중에
            </button>
          </div>
        )}
      </section>
    </div>
    </>
  )
}

function PiIdentityCard({ session }: { session: PiSession }) {
  return (
    <div className="rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] p-4">
      <p className="text-[11px] font-black text-[#4A82B8]">Pi Sign-in 완료</p>
      <p className="mt-1 text-sm font-black text-[#0F172A]">@{session.username}</p>
      <p className="mt-2 break-all text-[11px] font-bold leading-5 text-[#334155]">UID {session.uid}</p>
      <p className="mt-1 break-all text-[11px] font-bold leading-5 text-[#334155]">Wallet {session.wallet}</p>
    </div>
  )
}

function PartnerSignupModal({
  onClose,
  onDone,
  onRegistered,
  onPiLinked,
}: {
  onClose: () => void
  onDone: (message: string) => void
  onRegistered: (role: '기사' | '파트너', session: PiSession) => void
  onPiLinked: (session: PiSession) => void
}) {
  const [step, setStep] = useState<'pi' | 'profile'>('pi')
  const [session, setSession] = useState<PiSession | null>(null)
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState('')
  const [role, setRole] = useState<'기사' | '파트너'>('기사')
  const [serviceType, setServiceType] = useState<'택시' | '대리운전' | '택배'>('택시')
  const [facilityType, setFacilityType] = useState<'주차' | '자전거' | '킥보드' | 'EV 충전'>('주차')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [vehicleName, setVehicleName] = useState('')
  const [plateNumber, setPlateNumber] = useState('')
  const [region, setRegion] = useState('서울')
  const [photo, setPhoto] = useState<string | null>(null)
  const [insuranceCompany, setInsuranceCompany] = useState('')
  const [insurancePolicyNo, setInsurancePolicyNo] = useState('')
  const [insuranceExpiresAt, setInsuranceExpiresAt] = useState('')
  const [insuranceDoc, setInsuranceDoc] = useState<{ name: string; mime: string; dataUrl: string } | null>(null)
  const [formError, setFormError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)
  const insuranceDocInput = useRef<HTMLInputElement>(null)
  const skipVehicle = role === '기사' && serviceType === '대리운전'
  const canSubmit = Boolean(session) && name.trim() && phone.trim() && (role === '기사' ? skipVehicle || (vehicleName.trim() && plateNumber.trim()) : vehicleName.trim())

  const startPiLogin = async () => {
    if (signing) return
    setSigning(true)
    setSignError('')
    try {
      const next = await signInWithPi()
      setSession(next)
      savePiIdentity(next)
      onPiLinked(next)
      setStep('profile')
    } catch (error) {
      setSignError(describePiUserMessage(error))
    } finally {
      setSigning(false)
    }
  }

  const submit = () => {
    if (!canSubmit || !session) return
    const insuranceTouched = Boolean(insuranceCompany.trim() || insurancePolicyNo.trim() || insuranceExpiresAt.trim())
    if (insuranceTouched && !(insuranceCompany.trim() && insurancePolicyNo.trim() && insuranceExpiresAt.trim())) {
      setFormError('보험 정보를 입력하려면 보험사·증권번호·유효기간을 모두 채워 주세요.')
      return
    }
    const profile = {
      ...session,
      role,
      name: name.trim(),
      phone: phone.trim(),
      detail: role === '기사' ? (skipVehicle ? '' : `${vehicleName.trim()} · ${plateNumber.trim()}`) : vehicleName.trim(),
      vehicle: role === '기사' && !skipVehicle ? vehicleName.trim() : '',
      plate: role === '기사' && !skipVehicle ? plateNumber.trim() : '',
      region: region.trim() || '서울',
      serviceType: role === '기사' ? serviceType : facilityType,
      insuranceCompany: insuranceCompany.trim(),
      insurancePolicyNo: insurancePolicyNo.trim(),
      insuranceExpiresAt: insuranceExpiresAt.trim(),
      insuranceDocName: insuranceDoc?.name,
      linkedAt: new Date().toISOString(),
    }
    savePartnerProfile(profile)
    void syncPartnerLink(profile)
    if (insuranceDoc) void uploadInsuranceDoc(session.uid, insuranceDoc).catch(() => undefined)
    setSubmitted(true)
    onRegistered(role, session)
    window.setTimeout(() => {
      onDone(`${role} 등록이 완료되었어요. 파이 UID와 지갑이 정산 계정에 연결되었습니다.`)
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
  const onInsuranceDoc = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!(file.type.startsWith('image/') || file.type === 'application/pdf')) {
      setFormError('보험증권은 이미지 또는 PDF 파일만 첨부할 수 있어요.')
      return
    }
    if (file.size > 2.5 * 1024 * 1024) {
      setFormError('파일이 너무 큽니다. 2.5MB 이하 파일을 올려 주세요.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setInsuranceDoc({ name: file.name, mime: file.type, dataUrl: reader.result })
        setFormError('')
      }
    }
    reader.readAsDataURL(file)
  }
  return (
    <div className="fixed inset-0 z-[94] flex items-end bg-[#1e1033]/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-white p-5 shadow-2xl sm:rounded-[32px]" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
        {submitted ? (
          <div className="py-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#4A82B8] text-white">
              <Check className="h-8 w-8" strokeWidth={3} />
            </div>
            <h2 className="mt-4 text-2xl font-black text-[#0F172A]">파이 계정으로 등록 완료</h2>
            <p className="mt-2 text-sm font-bold text-[#475569]">UID와 지갑 주소가 파트너 프로필·정산에 연동되었어요.</p>
          </div>
        ) : step === 'pi' ? (
          <>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-black text-[#4A82B8]">PI SIGN-IN</p>
                <h2 className="mt-1 text-2xl font-black text-[#0F172A]">파이 계정으로 안전하게 시작</h2>
                <p className="mt-1 text-sm font-bold leading-6 text-[#64748B]">기사/파트너 등록의 첫 단계는 Pi Network 로그인입니다.</p>
              </div>
              <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="닫기">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 space-y-2 rounded-[22px] border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4 text-sm font-bold leading-6 text-[#334155]">
              <p>1. Pi Sign-in으로 고유 UID를 받습니다.</p>
              <p>2. 같은 계정의 지갑 주소가 정산 DB에 연결됩니다.</p>
              <p>3. 그다음 기사/가맹점 정보를 입력합니다.</p>
            </div>
            {signError ? <p className="mt-3 text-sm font-bold text-[#B91C1C]">{signError}</p> : null}
            <button
              type="button"
              onClick={() => void startPiLogin()}
              disabled={signing}
              className="mt-5 w-full rounded-2xl bg-[#4A82B8] py-3.5 font-black text-white shadow-[0_12px_24px_rgba(74,130,184,0.35)] disabled:opacity-70"
            >
              {signing ? 'Pi Sign-in 중…' : '파이 계정 로그인'}
            </button>
            {PI_SANDBOX ? <p className="mt-3 text-center text-[11px] font-bold text-[#8b8495]">개발 샌드박스에서는 Pi Browser가 없어도 테스트 계정으로 이어갈 수 있어요.</p> : null}
          </>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-black text-[#4A82B8]">PARTNER PROFILE</p>
                <h2 className="mt-1 text-2xl font-black text-[#0F172A]">파트너 정보 입력</h2>
                <p className="mt-1 text-sm font-bold text-[#64748B]">파이 UID·지갑이 이미 연결되었습니다.</p>
              </div>
              <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="닫기">
                <X className="h-5 w-5" />
              </button>
            </div>
            {session ? <div className="mt-4"><PiIdentityCard session={session} /></div> : null}
            <div className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-[#E8F1FA] p-1">
              {(['기사', '파트너'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRole(item)}
                  className={`rounded-xl py-2.5 text-xs font-black ${role === item ? 'bg-[#4A82B8] text-white shadow-[0_8px_16px_rgba(74,130,184,0.28)]' : 'text-[#64748B]'}`}
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
                      className={`rounded-2xl border-2 py-3 text-xs font-black ${serviceType === item ? 'border-[#4A82B8] bg-[#4A82B8] text-white' : 'border-[#BFDBFE] bg-[#E8F1FA] text-[#4A82B8]'}`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <label className="mt-4 block">
              <span className="text-xs font-black text-[#334155]">{role === '기사' ? '기사 성함' : '대표자 성함'}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="홍길동" className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8]" />
            </label>
            {role === '기사' ? (
              <div className="mt-3">
                <p className="text-xs font-black text-[#334155]">등록자 사진</p>
                <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
                <button
                  type="button"
                  onClick={() => photoInput.current?.click()}
                  className="mt-2 flex w-full items-center gap-3 rounded-[22px] border-2 border-dashed border-[#4A82B8] bg-[#E8F1FA] px-4 py-3 text-left"
                >
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white text-[#4A82B8] shadow-[0_6px_14px_rgba(74,130,184,0.12)]">
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
                      className={`rounded-2xl border-2 py-3 text-xs font-black ${facilityType === item ? 'border-[#4A82B8] bg-[#4A82B8] text-white shadow-[0_8px_16px_rgba(74,130,184,0.22)]' : 'border-[#BFDBFE] bg-[#E8F1FA] text-[#4A82B8]'}`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="mt-3 block">
              <span className="text-xs font-black text-[#334155]">연락처</span>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="010-0000-0000" className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8]" />
            </label>
            {role === '기사' ? (
              <div className="mt-3 grid grid-cols-1 gap-3">
                <label className="block">
                  <span className="text-xs font-black text-[#334155]">차량명</span>
                  <input
                    value={skipVehicle ? '' : vehicleName}
                    onChange={(event) => setVehicleName(event.target.value)}
                    disabled={skipVehicle}
                    placeholder={skipVehicle ? '대리운전은 차량 정보 입력 제외' : '현대 아슬란'}
                    className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8] disabled:opacity-60"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-black text-[#334155]">차량번호</span>
                  <input
                    value={skipVehicle ? '' : plateNumber}
                    onChange={(event) => setPlateNumber(event.target.value)}
                    disabled={skipVehicle}
                    placeholder={skipVehicle ? '대리운전은 차량 정보 입력 제외' : '서울 31바 1842'}
                    className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8] disabled:opacity-60"
                  />
                </label>
                {skipVehicle ? <p className="text-[11px] font-bold text-[#8b8495]">* 대리운전은 차량 정보 입력 제외</p> : null}
              </div>
            ) : (
            <label className="mt-3 block">
              <span className="text-xs font-black text-[#334155]">업체/가맹점명</span>
              <input
                value={vehicleName}
                onChange={(event) => setVehicleName(event.target.value)}
                placeholder="파이 모빌리티 강남점"
                className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8]"
              />
            </label>
            )}
            <label className="mt-3 block">
              <span className="text-xs font-black text-[#334155]">활동 지역</span>
              <input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="서울" className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8]" />
            </label>
            <div className="mt-4 rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4">
              <p className="text-xs font-black text-[#334155]">운행 안전·법적 책임 보험 (선택)</p>
              <p className="mt-1 text-[11px] font-bold text-[#8b8495]">입력 시 보험사·증권번호·유효기간을 모두 채워 주세요.</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-black text-[#334155]">보험사</span>
                  <input value={insuranceCompany} onChange={(event) => setInsuranceCompany(event.target.value)} placeholder="KB손해보험" className="mt-1.5 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-2.5 text-sm font-bold outline-none focus:border-[#4A82B8]" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-black text-[#334155]">보험 증권번호</span>
                  <input value={insurancePolicyNo} onChange={(event) => setInsurancePolicyNo(event.target.value)} placeholder="증권번호 입력" className="mt-1.5 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-2.5 text-sm font-bold outline-none focus:border-[#4A82B8]" />
                </label>
              </div>
              <label className="mt-3 block">
                <span className="text-[11px] font-black text-[#334155]">보험 유효기간(만료일)</span>
                <input type="date" value={insuranceExpiresAt} onChange={(event) => setInsuranceExpiresAt(event.target.value)} className="mt-1.5 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-2.5 text-sm font-bold outline-none focus:border-[#4A82B8]" />
              </label>
              <div className="mt-3">
                <span className="text-[11px] font-black text-[#334155]">보험증권 사본 (이미지·PDF, 최대 2.5MB)</span>
                <input ref={insuranceDocInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={onInsuranceDoc} />
                <button
                  type="button"
                  onClick={() => insuranceDocInput.current?.click()}
                  className="mt-1.5 w-full rounded-2xl border-2 border-dashed border-[#4A82B8] bg-[#E8F1FA] px-4 py-3 text-left text-xs font-bold text-[#64748B]"
                >
                  {insuranceDoc ? <span className="text-[#4A82B8]">첨부됨 · {insuranceDoc.name}</span> : '보험증권 파일 선택'}
                </button>
              </div>
            </div>
            {formError ? <p className="mt-3 text-sm font-bold text-[#B91C1C]">{formError}</p> : null}
            <button type="button" onClick={submit} disabled={!canSubmit} className="mt-5 w-full rounded-2xl bg-[#4A82B8] py-3.5 font-black text-white shadow-[0_12px_24px_rgba(74,130,184,0.35)] disabled:cursor-not-allowed disabled:opacity-40">
              파이 계정으로 등록 완료
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

function PartnerHub({ onSignup, onStartTrial }: { onSignup: () => void; onStartTrial: () => void }) {
  const [deviceFormOpen, setDeviceFormOpen] = useState(false)
  return (
    <>
    <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-4" aria-label="기사 파트너">
      <section className="rounded-[28px] bg-[#243044] p-5 text-white shadow-[0_14px_32px_rgba(15,23,42,0.16)]">
        <p className="text-xs font-semibold text-[#93C5FD]">Pi Network · 파트너</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight">파이 계정으로 안전하게 시작하는 파트너 등록</h2>
        <p className="mt-2 text-sm font-medium leading-6 text-[#CBD5E1]">기사/파트너는 반드시 Pi Sign-in을 거친 뒤 UID와 지갑 주소가 정산 계정에 연결됩니다.</p>
      </section>
      <section className="mt-4 rounded-[26px] border-2 border-[#CBD5E1] bg-white p-5 shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
        <p className="text-xs font-black text-[#4A82B8]">1단계 · 파이 로그인</p>
        <h3 className="mt-1 text-lg font-black text-[#0F172A]">Pi Sign-in으로 파트너 시작</h3>
        <p className="mt-2 text-sm font-bold leading-6 text-[#64748B]">로그인 후 고유 UID와 지갑이 프로필에 붙고, 그다음 기사/가맹점 정보를 입력합니다.</p>
        <button
          type="button"
          onClick={onSignup}
          className="mt-5 w-full rounded-2xl bg-[#4A82B8] py-3.5 text-base font-black text-white shadow-[0_10px_22px_rgba(74,130,184,0.28)]"
        >
          파이 계정으로 파트너 등록
        </button>
      </section>
      <section className="mt-4 rounded-[26px] border-2 border-[#BBF7D0] bg-white p-5 shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
        <p className="text-xs font-black text-[#047857]">시뮬레이션 1단계</p>
        <h3 className="mt-1 text-lg font-black text-[#0F172A]">자전거 · 퀵보드 기기 등록</h3>
        <p className="mt-2 text-sm font-bold leading-6 text-[#64748B]">시리얼, 종류, 위치, 배터리와 상태를 등록하고, 목록에서 수정·삭제·상태 변경을 할 수 있습니다. 이용 가능한 기기만 대여되고, 이용 완료 시 Pi 결제 후 반납됩니다.</p>
        <button
          type="button"
          onClick={() => setDeviceFormOpen(true)}
          className="mt-5 w-full rounded-2xl bg-[#047857] py-3.5 text-base font-black text-white"
        >
          기기 등록하기
        </button>
      </section>
      <section className="mt-4 rounded-[26px] border-2 border-[#F59E0B] bg-[#FFFBEB] p-5 shadow-[0_10px_24px_rgba(245,158,11,0.22)]">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-black text-[#B45309]">미리 체험</p>
          <span className="rounded-full bg-[#F59E0B] px-2.5 py-1 text-[10px] font-black text-white">Pi 로그인 전 미리보기</span>
        </div>
        <h3 className="mt-1 text-lg font-black text-[#0F172A]">기사/파트너 체험판</h3>
        <p className="mt-2 text-sm font-bold leading-6 text-[#92400E]">콜·내비게이션·수익 화면만 먼저 볼 수 있어요. 실제 정산과 콜 수락은 파이 계정 로그인이 필요합니다.</p>
        <button
          type="button"
          onClick={onStartTrial}
          className="mt-5 w-full rounded-2xl bg-[#EA580C] py-3.5 text-base font-black text-white shadow-[0_10px_22px_rgba(234,88,12,0.28)]"
        >
          체험판 시작하기
        </button>
      </section>
    </main>
    {deviceFormOpen ? <MobilityDeviceFormModal onClose={() => setDeviceFormOpen(false)} /> : null}
    </>
  )
}

const TRIAL_PICKUP = { label: '해운대 해수욕장' }
const TRIAL_DEST = { label: '서면 롯데백화점' }

type TrialStatRange = 'daily' | 'monthly' | 'yearly'

const TRIAL_STATS: Record<
  TrialStatRange,
  {
    rangeLabel: string
    period: string
    revenue: number
    trips: number
    done: number
    cancel: number
    series: { label: string; revenue: number; trips: number }[]
  }
> = {
  daily: {
    rangeLabel: '일일',
    period: '2026. 9. 19 (토)',
    revenue: 45.2,
    trips: 9,
    done: 8,
    cancel: 1,
    series: [
      { label: '14', revenue: 38.6, trips: 7 },
      { label: '15', revenue: 51.4, trips: 10 },
      { label: '16', revenue: 32.8, trips: 7 },
      { label: '17', revenue: 45.2, trips: 8 },
      { label: '18', revenue: 28.4, trips: 5 },
      { label: '오늘', revenue: 45.2, trips: 9 },
    ],
  },
  monthly: {
    rangeLabel: '월별',
    period: '2026년 9월',
    revenue: 298.8,
    trips: 58,
    done: 54,
    cancel: 4,
    series: [
      { label: '4월', revenue: 412.1, trips: 78 },
      { label: '5월', revenue: 488.4, trips: 91 },
      { label: '6월', revenue: 521.0, trips: 97 },
      { label: '7월', revenue: 571.3, trips: 116 },
      { label: '8월', revenue: 642.5, trips: 129 },
      { label: '9월', revenue: 298.8, trips: 58 },
    ],
  },
  yearly: {
    rangeLabel: '연간',
    period: '2026년',
    revenue: 2010.6,
    trips: 406,
    done: 379,
    cancel: 27,
    series: [
      { label: '22', revenue: 4210.4, trips: 812 },
      { label: '23', revenue: 5388.2, trips: 1024 },
      { label: '24', revenue: 6124.8, trips: 1188 },
      { label: '25', revenue: 6842.1, trips: 1361 },
      { label: '26', revenue: 2010.6, trips: 406 },
    ],
  },
}

function PartnerTrialStats() {
  const [range, setRange] = useState<TrialStatRange>('daily')
  const [metric, setMetric] = useState<'revenue' | 'trips'>('revenue')
  const stats = TRIAL_STATS[range]
  const completion = stats.trips > 0 ? (stats.done / stats.trips) * 100 : 0
  const peak = Math.max(...stats.series.map((item) => (metric === 'revenue' ? item.revenue : item.trips)), 1)
  const tabs: { id: TrialStatRange; label: string }[] = [
    { id: 'daily', label: '일일' },
    { id: 'monthly', label: '월별' },
    { id: 'yearly', label: '연간' },
  ]

  return (
    <section className="mt-4 rounded-[26px] border-2 border-[#99F6E4] bg-white p-4 shadow-[0_10px_24px_rgba(15,118,110,0.12)]" aria-label="체험판 정산 대시보드">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-black tracking-wide text-[#0F766E]">정산 · 수익 대시보드</p>
          <h3 className="mt-0.5 text-lg font-black text-[#0F172A]">가상 통계</h3>
          <p className="mt-1 text-xs font-bold text-[#64748B]">{stats.period} 기준 미리보기</p>
        </div>
        <span className="rounded-full bg-[#CCFBF1] px-2.5 py-1 text-[10px] font-black text-[#0F766E]">데모 데이터</span>
      </div>
      <div className="mt-3 grid grid-cols-3 rounded-2xl bg-[#F1F5F9] p-1" role="tablist" aria-label="통계 기간">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={range === tab.id}
            onClick={() => setRange(tab.id)}
            className={`rounded-xl py-2 text-[13px] font-black transition ${range === tab.id ? 'bg-white text-[#0F766E] shadow-sm' : 'text-[#64748B]'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-[#99F6E4] bg-[#F0FDFA] p-3">
          <p className="text-[10px] font-black text-[#0F766E]">{stats.rangeLabel} 수익</p>
          <p className="mt-1 text-xl font-black text-[#0F172A]">{stats.revenue.toFixed(1)} <span className="text-sm">Pi</span></p>
        </div>
        <div className="rounded-2xl border border-[#BFDBFE] bg-[#F8FAFC] p-3">
          <p className="text-[10px] font-black text-[#0369A1]">{stats.rangeLabel} 운행</p>
          <p className="mt-1 text-xl font-black text-[#0F172A]">{stats.trips.toLocaleString()} <span className="text-sm">회</span></p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-[#FECACA] bg-[#FEF2F2] p-3">
          <p className="text-[10px] font-black text-[#B91C1C]">취소 건수</p>
          <p className="mt-1 text-xl font-black text-[#0F172A]">{stats.cancel.toLocaleString()} <span className="text-sm">건</span></p>
        </div>
        <div className="rounded-2xl border border-[#BBF7D0] bg-[#F0FDF4] p-3">
          <p className="text-[10px] font-black text-[#15803D]">완료율</p>
          <p className="mt-1 text-xl font-black text-[#0F172A]">{completion.toFixed(1)}<span className="text-sm">%</span></p>
          <p className="mt-1 text-[10px] font-bold text-[#64748B]">완료 {stats.done.toLocaleString()} / 전체 {stats.trips.toLocaleString()}</p>
        </div>
      </div>
      <div className="mt-3 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-black text-[#334155]">{metric === 'revenue' ? '수익 추이' : '운행 추이'}</p>
          <div className="flex rounded-full bg-white p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => setMetric('revenue')}
              className={`rounded-full px-2.5 py-1 text-[10px] font-black ${metric === 'revenue' ? 'bg-[#0F766E] text-white' : 'text-[#64748B]'}`}
            >
              수익
            </button>
            <button
              type="button"
              onClick={() => setMetric('trips')}
              className={`rounded-full px-2.5 py-1 text-[10px] font-black ${metric === 'trips' ? 'bg-[#0369A1] text-white' : 'text-[#64748B]'}`}
            >
              운행
            </button>
          </div>
        </div>
        <div className="mt-3 flex h-28 items-end gap-1.5">
          {stats.series.map((item, index) => {
            const value = metric === 'revenue' ? item.revenue : item.trips
            const height = Math.max(12, Math.round((value / peak) * 100))
            const active = index === stats.series.length - 1
            return (
              <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center justify-end">
                <p className="mb-1 text-[9px] font-black text-[#475569]">{metric === 'revenue' ? value.toFixed(0) : value}</p>
                <div
                  className={`w-full max-w-7 rounded-t-lg ${active ? (metric === 'revenue' ? 'bg-[#0F766E]' : 'bg-[#0369A1]') : 'bg-[#CBD5E1]'}`}
                  style={{ height: `${height}%` }}
                  title={`${item.label} ${metric === 'revenue' ? `${value.toFixed(1)} Pi` : `${value}회`}`}
                />
                <p className={`mt-1 truncate text-[10px] font-black ${active ? 'text-[#0F172A]' : 'text-[#94A3B8]'}`}>{item.label}</p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function PartnerTrialNav({ phase }: { phase: 'pickup' | 'moving' }) {
  const heading = phase === 'pickup' ? '승객 위치로 이동' : '목적지로 주행'
  const nextTurn = phase === 'pickup' ? '200m 앞 우회전 후 해운대해변로' : '1.2km 직진 후 가야대로 진입'
  const eta = phase === 'pickup' ? '3분' : '18분'
  const progress = phase === 'pickup' ? 'w-1/3' : 'w-2/3'
  return (
    <div className="relative mt-4 overflow-hidden rounded-[24px] border-2 border-[#334155] bg-[#0F172A] p-4 text-white shadow-[0_10px_24px_rgba(15,23,42,0.28)]">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-black tracking-wide text-[#93C5FD]">TAXITAGO NAV · 체험</p>
        <span className="rounded-full bg-[#4A82B8] px-2.5 py-1 text-[10px] font-black">{eta} 남음</span>
      </div>
      <p className="mt-3 text-lg font-black">{heading}</p>
      <p className="mt-1 text-sm font-bold text-[#CBD5E1]">{nextTurn}</p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15">
        <div className={`h-full rounded-full bg-[#38BDF8] ${progress}`} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-bold">
        <div className="rounded-2xl bg-white/10 px-3 py-2.5">
          <p className="text-[10px] text-[#93C5FD]">{phase === 'pickup' ? '승객 위치' : '출발'}</p>
          <p className="mt-1 leading-5">{TRIAL_PICKUP.label}</p>
        </div>
        <div className="rounded-2xl bg-white/10 px-3 py-2.5">
          <p className="text-[10px] text-[#FCD34D]">{phase === 'pickup' ? '목적지' : '하차'}</p>
          <p className="mt-1 leading-5">{TRIAL_DEST.label}</p>
        </div>
      </div>
    </div>
  )
}

function PartnerTrialDemo({ onClose, onNotice }: { onClose: () => void; onNotice: (message: string) => void }) {
  const [phase, setPhase] = useState<'waiting' | 'incoming' | 'pickup' | 'moving' | 'settle'>('waiting')
  const [callKey, setCallKey] = useState(0)
  const fare = 3.8

  useEffect(() => {
    if (phase !== 'waiting') return
    const timer = window.setTimeout(() => setPhase('incoming'), 1200)
    return () => window.clearTimeout(timer)
  }, [phase, callKey])

  return (
    <div className="fixed inset-0 z-[96] flex items-end justify-center bg-[#1e1033]/55 sm:items-center sm:p-4">
      <section className="flex h-[min(96dvh,100%)] w-full max-w-md flex-col overflow-hidden rounded-t-[32px] bg-[#F8FAFC] shadow-2xl sm:h-[min(92dvh,820px)] sm:rounded-[32px]">
        <header className="shrink-0 border-b border-[#FDE68A] bg-[#FFFBEB] px-5 pb-3 pt-3">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[#FCD34D]" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black tracking-wide text-[#B45309]">기사/파트너 체험판</p>
              <h2 className="mt-0.5 text-xl font-black text-[#0F172A]">미리보기 · 파이 계정으로 정식 등록</h2>
              <p className="mt-1 text-xs font-bold text-[#92400E]">체험은 화면만 보여 줍니다. 실제 정산은 Pi Sign-in 후 UID·지갑이 연결되어야 합니다.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full bg-white p-2 text-[#334155] shadow-sm" aria-label="체험판 닫기">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {phase === 'waiting' ? (
            <div className="rounded-[26px] border-2 border-[#CBD5E1] bg-white p-5 text-center shadow-[0_8px_22px_rgba(15,23,42,0.08)]">
              <span className="inline-flex animate-pulse rounded-full bg-[#D1FAE5] px-3 py-1 text-[11px] font-black text-[#047857]">영업 중</span>
              <h3 className="mt-4 text-lg font-black text-[#0F172A]">가상 콜을 기다리는 중이에요</h3>
              <p className="mt-2 text-sm font-bold leading-6 text-[#64748B]">잠시 후면 근처 승객의 체험 호출이 도착합니다.</p>
            </div>
          ) : null}
          {phase === 'incoming' ? (
            <section className="rounded-[26px] border-2 border-[#F59E0B] bg-white p-5 shadow-[0_10px_24px_rgba(245,158,11,0.18)]">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black text-[#EA580C]">새로운 운행 요청</p>
                <span className="animate-pulse rounded-full bg-[#EA580C] px-2 py-1 text-[10px] font-black text-white">가상 콜</span>
              </div>
              <p className="mt-3 text-lg font-black text-[#0F172A]">{TRIAL_PICKUP.label} → {TRIAL_DEST.label}</p>
              <p className="mt-1 text-sm font-bold text-[#64748B]">승객 박서연 · 예상 7.4 km</p>
              <div className="mt-2 flex justify-between text-sm font-semibold text-[#475569]">
                <span>승객까지 1.1 km</span>
                <strong className="text-[#0F172A]">{fare.toFixed(1)} Pi</strong>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPhase('pickup')}
                  className="rounded-2xl bg-[#4A82B8] py-3.5 font-black text-white"
                >
                  수락
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onNotice('체험 콜을 거절했어요. 다음 가상 콜을 기다립니다.')
                    setPhase('waiting')
                    setCallKey((value) => value + 1)
                  }}
                  className="rounded-2xl border-2 border-[#CBD5E1] bg-white py-3.5 font-black text-[#475569]"
                >
                  거절
                </button>
              </div>
            </section>
          ) : null}
          {phase === 'pickup' || phase === 'moving' ? (
            <div>
              <p className="text-xs font-black text-[#4A82B8]">{phase === 'pickup' ? '배차 완료' : '운행 중'}</p>
              <h3 className="mt-1 text-xl font-black text-[#0F172A]">{phase === 'pickup' ? '승객에게 이동 중' : '목적지 이동 중'}</h3>
              <p className="mt-1 text-sm font-bold text-[#64748B]">
                {phase === 'pickup' ? '내비게이션으로 승객 위치로 이동해 보세요.' : `${TRIAL_DEST.label}까지 가상 운행을 이어갑니다.`}
              </p>
              <PartnerTrialNav phase={phase} />
              <button
                type="button"
                onClick={() => setPhase(phase === 'pickup' ? 'moving' : 'settle')}
                className="mt-4 w-full rounded-2xl bg-[#4A82B8] py-3.5 text-base font-black text-white"
              >
                {phase === 'pickup' ? '승객 탑승 완료' : '운행 완료 · 정산하기'}
              </button>
            </div>
          ) : null}
          {phase === 'settle' ? (
            <section className="rounded-[26px] border-2 border-[#99F6E4] bg-white p-5 shadow-[0_10px_24px_rgba(15,118,110,0.12)]">
              <p className="text-xs font-black text-[#0F766E]">가상 정산</p>
              <h3 className="mt-1 text-xl font-black text-[#0F172A]">이번 운행 수익</h3>
              <p className="mt-3 text-3xl font-black text-[#0F766E]">+{fare.toFixed(1)} Pi</p>
              <ul className="mt-4 space-y-2 text-sm font-bold text-[#475569]">
                <li className="flex justify-between"><span>운임</span><span>{fare.toFixed(1)} Pi</span></li>
                <li className="flex justify-between"><span>플랫폼 수수료</span><span>0.0 Pi (체험)</span></li>
                <li className="flex justify-between text-[#0F172A]"><span>기사 정산</span><span>{fare.toFixed(1)} Pi</span></li>
              </ul>
              <p className="mt-4 text-xs font-bold leading-5 text-[#64748B]">이 금액은 데모용이며 실제 지갑에 입금되지 않습니다.</p>
              <button
                type="button"
                onClick={() => {
                  onNotice('체험판을 마쳤습니다. 실제 콜·정산은 파이 계정으로 파트너 등록해 주세요.')
                  onClose()
                }}
                className="mt-5 w-full rounded-2xl bg-[#0F766E] py-3.5 text-base font-black text-white"
              >
                체험 종료
              </button>
            </section>
          ) : null}
          <PartnerTrialStats />
        </div>
      </section>
    </div>
  )
}

function DriverNeedSignupModal({ onClose, onSignup }: { onClose: () => void; onSignup: () => void }) {
  return (
    <div className="fixed inset-0 z-[94] flex items-end bg-[#1e1033]/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto w-full max-w-md rounded-t-[32px] bg-white p-5 shadow-2xl sm:rounded-[32px]" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
        <p className="text-xs font-bold text-[#4A82B8]">Pi Sign-in 필요</p>
        <h2 className="mt-1 text-2xl font-bold text-[#0F172A]">파이 계정으로 파트너를 시작하세요</h2>
        <p className="mt-2 text-sm font-medium leading-6 text-[#475569]">
          기사/파트너는 Pi Network 로그인이 먼저입니다. UID와 지갑이 정산 계정에 연결됩니다.
        </p>
        <button
          type="button"
          onClick={onSignup}
          className="mt-5 w-full rounded-2xl bg-[#4A82B8] py-3.5 text-base font-bold text-white shadow-[0_10px_22px_rgba(74,130,184,0.28)]"
        >
          파이 계정으로 로그인
        </button>
        <button type="button" onClick={onClose} className="mt-2 w-full rounded-2xl py-3 text-sm font-bold text-[#64748B]">
          나중에
        </button>
      </section>
    </div>
  )
}

/** Headless listener that keeps an online driver reachable while they browse other tabs. */
function DriverOfferWatcher({
  lat,
  lng,
  onOpenDesk,
  onNotice,
  onActivity,
}: {
  lat: number
  lng: number
  onOpenDesk: () => void
  onNotice: (message: string) => void
  onActivity?: (label: string, detail: string) => void
}) {
  const [driverId, setDriverId] = useState('')
  const driverAliasRef = useRef('')
  const [incoming, setIncoming] = useState<PublicRide | null>(null)
  const [offerKm, setOfferKm] = useState<number | null>(null)
  const [activeRide, setActiveRide] = useState<PublicRide | null>(null)
  const [busy, setBusy] = useState(false)
  const notifiedRef = useRef('')
  // 거절한 콜 id — 응답이 서버에 반영되는 동안 폴링/푸시가 같은 콜을 다시 띄우지 않게 막는다.
  const dismissedRef = useRef(new Set<string>())
  const onActivityRef = useRef(onActivity)
  onActivityRef.current = onActivity

  useEffect(() => {
    const profile = loadPartnerProfile()
    const id = localDriverId(profile?.uid)
    const legacyId = readOrCreateLocalId(DRIVER_ID_KEY, 'driver')
    driverAliasRef.current = legacyId !== id ? legacyId : ''
    setDriverId(id)
    const stored = readStoredDriverRide(id)
    if (stored) setActiveRide(stored)
  }, [])

  // 콜 알림음은 기사가 화면 어디든 인터랙션하는 순간 즉시 멈춘다.
  useEffect(() => {
    const stop = () => stopDriverOfferAlarm()
    window.addEventListener('pointerdown', stop, true)
    window.addEventListener('touchstart', stop, true)
    window.addEventListener('keydown', stop, true)
    return () => {
      window.removeEventListener('pointerdown', stop, true)
      window.removeEventListener('touchstart', stop, true)
      window.removeEventListener('keydown', stop, true)
      stopDriverOfferAlarm()
    }
  }, [])

  // 오퍼가 사라지면(수락/거절/만료) 반복 알림음도 함께 정지.
  useEffect(() => {
    if (!incoming) stopDriverOfferAlarm()
  }, [incoming])

  useEffect(() => {
    if (driverId && activeRide) writeStoredDriverRide(driverId, activeRide)
  }, [driverId, activeRide])

  useEffect(() => {
    if (!driverId) return
    const partner = loadPartnerProfile()
    let stopped = false
    let timer = 0
    let delay = 1000
    let sending = false
    const beat = () => {
      if (stopped || sending) return
      sending = true
      const fleet = partnerVehicle(partner)
      void sendDriverPresence({
        driverId,
        altDriverId: driverAliasRef.current,
        lat,
        lng,
        online: true,
        name: partner?.name,
        vehicle: fleet.vehicle,
        plate: fleet.plate,
        wallet: partner?.wallet,
        piUid: partner?.uid,
      }).then(() => {
        delay = document.visibilityState === 'visible' ? 12000 : 20000
      }).catch(() => {
        delay = Math.min(delay * 2, 30000)
      }).finally(() => {
        sending = false
        if (!stopped) timer = window.setTimeout(beat, delay)
      })
    }
    const wake = () => {
      window.clearTimeout(timer)
      delay = 1000
      beat()
    }
    beat()
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [driverId, lat, lng])

  useEffect(() => {
    if (!driverId) return
    primeDriverAlertAudio()
    const applyOffer = (pending: { ride: PublicRide | null; offer?: { pickupDistanceKm?: number; expiresAt?: string } | null; active?: PublicRide | null } | null) => {
      const fetched = pending?.ride ?? null
      const ride = fetched && dismissedRef.current.has(fetched.id) ? null : fetched
      const active = pending?.active && pending.active.status === 'assigned' ? pending.active : null
      setActiveRide((current) => {
        if (!active) return null
        if (!current || current.id !== active.id) return active
        return { ...active, boardedAt: active.boardedAt ?? current.boardedAt ?? null, readyToSettleAt: active.readyToSettleAt ?? current.readyToSettleAt ?? null }
      })
      if (!ride) {
        setIncoming(null)
        setOfferKm(null)
        notifiedRef.current = ''
        return
      }
      setIncoming(ride)
      setOfferKm(pending?.offer?.pickupDistanceKm ?? ride.assignedDriver?.pickupDistanceKm ?? null)
      if (notifiedRef.current === ride.id) return
      notifiedRef.current = ride.id
      alertDriverOffer(ride.id)
      onActivityRef.current?.('호출 접수', rideStops(ride).chain)
      onNotice('새로운 콜 요청이 들어왔어요.')
      void showDriverOfferNotification(ride.id, rideStops(ride).chain)
    }
    let requestSeq = 0
    const pull = () => {
      const request = ++requestSeq
      void fetchDriverOffer(driverId).then((pending) => {
        if (request !== requestSeq || pending === undefined) return
        applyOffer(pending)
      }).catch(() => undefined)
    }
    const unsubscribe = subscribeDriverLive(driverId, (snapshot) => applyOffer(snapshot), driverAliasRef.current ? [driverAliasRef.current] : [])
    void enableDriverPush(driverId).catch(() => undefined)
    const onAlert = (event: MessageEvent) => {
      if (event.data?.type !== 'driver-offer') return
      const pushed = rideFromPushedOffer(event.data.offer)
      if (!pushed) {
        pull()
        return
      }
      applyOffer({ ride: pushed.ride, offer: pushed.offer })
    }
    pull()
    const timer = window.setInterval(pull, 2000)
    window.addEventListener('online', pull)
    document.addEventListener('visibilitychange', pull)
    navigator.serviceWorker?.addEventListener('message', onAlert)
    return () => {
      unsubscribe()
      window.clearInterval(timer)
      window.removeEventListener('online', pull)
      document.removeEventListener('visibilitychange', pull)
      navigator.serviceWorker?.removeEventListener('message', onAlert)
    }
  }, [driverId, onNotice])

  const respond = (action: 'accept' | 'reject') => {
    if (!incoming || busy) return
    stopDriverOfferAlarm()
    const partner = loadPartnerProfile()
    const fleet = partnerVehicle(partner)
    setBusy(true)
    // 수락한 콜도 즉시 오퍼 큐에서 제거 — 수락 응답이 서버에 반영되기 전 폴링/푸시 재도착을 차단한다.
    dismissedRef.current.add(incoming.id)
    setIncoming(null)
    setOfferKm(null)
    void respondToRideOffer(
      incoming.id,
      incoming.pendingOffer?.driverId || driverId,
      action,
      {
        passengerId: incoming.passengerId,
        pickup: incoming.pickup,
        waypoints: incoming.waypoints,
        dest: incoming.dest,
        estimatedFare: incoming.estimatedFare,
        kind: incoming.kind,
      },
      { name: partner?.name, vehicle: fleet.vehicle, plate: fleet.plate },
    )
      .then(({ ride: next, penalty }) => {
        if (action === 'accept') {
          // 사전 배차 수락이면 진행 중인 운행의 저장본은 유지한다(데스크 복귀 후 서버 active가 승계).
          if (!activeRide || activeRide.id === next.id) writeStoredDriverRide(driverId, next)
          onActivityRef.current?.(activeRide && activeRide.id !== next.id ? '사전 배차 수락' : '콜 수락', rideStops(incoming).chain)
          onOpenDesk()
        } else {
          if (penalty && penalty.level !== 'ok') {
            onNotice('거절 횟수가 누적되면 콜 배정이 어렵습니다. 주의해 주세요.')
          }
          setIncoming(null)
        }
      })
      .catch((error) => {
        // 수락 실패 시에는 콜이 살아있을 수 있으니 차단 해제로 재시도를 허용한다.
        if (action === 'accept') dismissedRef.current.delete(incoming.id)
        onNotice(error instanceof Error ? error.message : '콜 응답에 실패했어요.')
      })
      .finally(() => setBusy(false))
  }

  if (incoming) {
    return (
      <div className="fixed inset-x-0 bottom-20 z-[97] mx-auto w-full max-w-md px-4">
        <section className="rounded-2xl border-2 border-[#BFDBFE] bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.25)]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-[#4A82B8]">새로운 운행 요청</p>
            <span className="animate-pulse rounded-full bg-[#4A82B8] px-2 py-1 text-[10px] font-bold text-white">우선 배차</span>
          </div>
          <LongDistanceCallBadge ride={incoming} />
          {activeRide ? (
            <p className="mt-2 rounded-lg bg-[#DBEAFE] px-2.5 py-1.5 text-[11px] font-black text-[#1D4ED8]">
              사전 배차 콜 · 현재 운행이 끝나면 이어서 이동할 다음 콜입니다.
            </p>
          ) : null}
          <p className="mt-3 text-lg font-bold leading-6 text-[#0F172A]">{rideStops(incoming).chain}</p>
          {rideStops(incoming).via.length ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-[#EA580C]">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              경유지 {rideStops(incoming).via.join(' · ')}
            </p>
          ) : null}
          <TaxiLiveMap
            kind={incoming.kind}
            phase="arriving"
            routeLabel={rideStops(incoming).chain}
            statusLabel="픽업 경로"
            originLat={incoming.pickup.lat}
            originLng={incoming.pickup.lng}
            destLat={incoming.dest.lat}
            destLng={incoming.dest.lng}
            originLabel={incoming.pickup.address || '승객 탑승 위치'}
            destLabel={incoming.dest.label || incoming.dest.address || '목적지'}
            waypoints={incoming.waypoints ?? []}
            vehicleLat={lat}
            vehicleLng={lng}
            className="mt-2 h-[140px]"
          />
          <div className="mt-2 flex justify-between text-sm font-semibold text-[#475569]">
            <span>승객까지 {offerKm != null ? `${offerKm.toFixed(1)} km` : '계산 중'}</span>
            <strong className="text-[#0F172A]">{Number(incoming.estimatedFare || 0).toFixed(7)} Pi</strong>
          </div>
          {Number(incoming.avoidSurchargePi || 0) > 0 ? (
            <p className="mt-1.5 rounded-lg bg-[#FEF3C7] px-2.5 py-1.5 text-[11px] font-black text-[#B45309]">
              기피 지역 할증 +{Number(incoming.avoidSurchargePi).toFixed(7)} Pi 적용 — 추가 수익이 붙은 콜입니다.
            </p>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              disabled={busy}
              onClick={() => respond('accept')}
              className="rounded-2xl bg-[#4A82B8] py-3.5 font-bold text-white disabled:opacity-60"
            >
              수락
            </button>
            <button
              disabled={busy}
              onClick={() => respond('reject')}
              className="rounded-2xl border-2 border-[#CBD5E1] bg-white py-3.5 font-bold text-[#475569] disabled:opacity-60"
            >
              거절
            </button>
          </div>
        </section>
      </div>
    )
  }
  if (activeRide) {
    return (
      <div className="fixed inset-x-0 bottom-20 z-[97] mx-auto w-full max-w-md px-4">
        <button
          type="button"
          onClick={onOpenDesk}
          className="w-full rounded-2xl border-2 border-[#BFDBFE] bg-white px-4 py-3 text-left shadow-[0_12px_28px_rgba(15,23,42,0.18)]"
        >
          <p className="text-xs font-bold text-[#4A82B8]">진행 중인 운행</p>
          <p className="mt-1 text-sm font-bold text-[#0F172A]">
            {rideStops(activeRide).chain}
            {activeRide.readyToSettleAt ? ' · 정산 가능' : activeRide.boardedAt ? ' · 승객 탑승' : ''}
          </p>
        </button>
      </div>
    )
  }
  return null
}

function DriverDashboard({
  online,
  lat,
  lng,
  onToggleOnline,
  onPassengerMode,
  onWithdraw,
  onNotice,
  onAskPassengerReview,
  onActivity,
  deliveryJob,
  openLostId,
  onLostOpened,
}: {
  online: boolean
  lat: number
  lng: number
  onToggleOnline: () => void
  onPassengerMode: () => void
  onWithdraw: () => void | Promise<void | boolean>
  onNotice: (message: string) => void
  onAskPassengerReview: (target: RideReviewTarget) => void
  onActivity?: (label: string, detail: string) => void
  deliveryJob?: DeliveryJob | null
  /** 홈·다른 탭의 분실물 배너에서 넘어온 건 — 받으면 고객지원 데스크를 해당 채팅으로 연다. */
  openLostId?: string | null
  onLostOpened?: () => void
}) {
  const [incoming, setIncoming] = useState<PublicRide | null>(null)
  const [activeRide, setActiveRide] = useState<PublicRide | null>(null)
  // 운행 도착 임박 시 수락한 다음 콜 — 현재 운행이 끝나면 서버 active가 자동 승계한다.
  const [queuedRide, setQueuedRide] = useState<PublicRide | null>(null)
  const [earnings, setEarnings] = useState<DriverEarningsStats | null>(null)
  const [earningsReady, setEarningsReady] = useState(false)
  const applyEarnings = useCallback((id: string, next: DriverEarningsStats | null | undefined) => {
    if (!id || !next) return
    setEarnings((current) => {
      if (!hasRecordedEarnings(next) && hasRecordedEarnings(current)) return current
      if (hasRecordedEarnings(next)) writeEarningsCache(id, next)
      return next
    })
    setEarningsReady(true)
  }, [])
  const [driverRating, setDriverRating] = useState('5.00')
  const [offerKm, setOfferKm] = useState<number | null>(null)
  // 서버가 내려주는 거절 누적 패널티 — 경고 배너 표시와 회복 감지에 쓴다.
  const [driverPenalty, setDriverPenalty] = useState<DriverPenaltyInfo | null>(null)
  const penaltyLevelRef = useRef<DriverPenaltyInfo['level']>('ok')
  const [busy, setBusy] = useState(false)
  const [statSheet, setStatSheet] = useState<'revenue' | 'trips' | null>(null)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [manualPayOpen, setManualPayOpen] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [deskOpen, setDeskOpen] = useState(false)
  const [deliveryChatPeer, setDeliveryChatPeer] = useState<DeliveryChatPeer | null>(null)
  const [localDelivery, setLocalDelivery] = useState<DeliveryJob | null>(null)
  const [openDeliveries, setOpenDeliveries] = useState<PublicDelivery[]>([])
  const [sosAlerts, setSosAlerts] = useState<SosAlert[]>([])
  const [lostItems, setLostItems] = useState<LostItem[]>([])
  const [lostFocus, setLostFocus] = useState<string | null>(null)
  const [freshLostIds, setFreshLostIds] = useState<string[]>([])
  const [partner, setPartner] = useState<ReturnType<typeof loadPartnerProfile>>(null)
  const [profileEditOpen, setProfileEditOpen] = useState(false)
  const [driverId, setDriverId] = useState('')
  // Device-generated id used before a partner profile existed — kept as an
  // alias so rides/earnings recorded under it stay visible.
  const driverAliasRef = useRef('')
  const localOfferRef = useRef<{ ride: PublicRide; expiresAt: number; km: number | null } | null>(null)
  // 거절한 콜 id — 폴링·SSE·푸시 재도착으로 거절된 콜 카드가 다시 뜨지 않도록 막는다.
  const dismissedOfferIds = useRef(new Set<string>())
  const offerLogRef = useRef('')
  const activityKeys = useRef(new Set<string>())
  const onActivityRef = useRef(onActivity)
  onActivityRef.current = onActivity
  const lastActiveRef = useRef<PublicRide | null>(null)
  const activeEndChecks = useRef(new Set<string>())
  const endedRideIds = useRef(new Set<string>())
  const activityPrimed = useRef(false)
  const deliverySeen = useRef<string | null>(null)
  const lostSeenRef = useRef<Set<string> | null>(null)
  const noteActivity = useCallback((key: string, label: string, detail: string) => {
    if (!key || activityKeys.current.has(key)) return
    activityKeys.current.add(key)
    onActivityRef.current?.(label, detail)
  }, [])
  const rideRoute = (ride: RideStopPoints) => rideStops(ride).chain
  // 다른 운행으로 바뀌거나 종료되면 내비게이션 뷰도 함께 닫는다.
  useEffect(() => setNavOpen(false), [activeRide?.id])

  // 다른 탭의 분실물 알림 배너에서 진입 — 데스크를 열고 해당 건 채팅으로 바로 이동한다.
  useEffect(() => {
    if (!openLostId) return
    setLostFocus(openLostId)
    setFreshLostIds([])
    setDeskOpen(true)
    onLostOpened?.()
  }, [openLostId, onLostOpened])

  // 콜 알림음은 기사가 화면 어디든 인터랙션하는 순간 즉시 멈춘다.
  useEffect(() => {
    const stop = () => stopDriverOfferAlarm()
    window.addEventListener('pointerdown', stop, true)
    window.addEventListener('touchstart', stop, true)
    window.addEventListener('keydown', stop, true)
    return () => {
      window.removeEventListener('pointerdown', stop, true)
      window.removeEventListener('touchstart', stop, true)
      window.removeEventListener('keydown', stop, true)
      stopDriverOfferAlarm()
    }
  }, [])

  // 대기 중인 콜(택시/대리 오퍼, 택배 오픈 콜)이 모두 사라지면 반복 알림음 정지.
  useEffect(() => {
    if (!incoming && !openDeliveries.length) stopDriverOfferAlarm()
  }, [incoming, openDeliveries])

  // 택배 파트너의 새 오픈 콜도 동일한 반복 알림음으로 알린다.
  const deliveryAlertRef = useRef('')
  useEffect(() => {
    const id = openDeliveries[0]?.id
    if (!id || deliveryAlertRef.current === id) return
    deliveryAlertRef.current = id
    alertDriverOffer(`delivery:${id}`)
  }, [openDeliveries])
  // 실제 주행 거리 오도미터 — 승객 탑승 확인 이후 GPS 델타를 누적해 정산 시
  // 실측 거리(Actual Travel Distance)로 서버에 함께 보낸다. localStorage에
  // 저장해 폴링 리마운트나 새로고침 후에도 누적이 끊기지 않게 한다.
  const odoRef = useRef({ rideId: '', km: 0, lat: 0, lng: 0, primed: false })
  useEffect(() => {
    const rideId = activeRide?.boardedAt ? activeRide.id : ''
    const odo = odoRef.current
    if (odo.rideId !== rideId) {
      const stored = rideId ? Number(window.localStorage.getItem(`taxitago-odo:${rideId}`)) : 0
      odoRef.current = { rideId, km: Number.isFinite(stored) && stored > 0 ? stored : 0, lat, lng, primed: false }
      return
    }
    if (!rideId) return
    if (!odo.primed) {
      odo.lat = lat
      odo.lng = lng
      odo.primed = true
      return
    }
    const delta = haversineKm({ lat: odo.lat, lng: odo.lng }, { lat, lng })
    if (delta > 0.005 && delta < 0.5) odo.km += delta
    odo.lat = lat
    odo.lng = lng
    try {
      window.localStorage.setItem(`taxitago-odo:${rideId}`, odo.km.toFixed(4))
    } catch {}
  }, [lat, lng, activeRide?.id, activeRide?.boardedAt])
  const dropEndedRide = useCallback((ended: PublicRide | string) => {
    const id = typeof ended === 'string' ? ended : ended.id
    try {
      window.localStorage.removeItem(`taxitago-odo:${id}`)
    } catch {}
    endedRideIds.current.add(id)
    if (lastActiveRef.current?.id === id) lastActiveRef.current = null
    if (localOfferRef.current?.ride.id === id) localOfferRef.current = null
    if (driverId) writeStoredDriverRide(driverId, null)
    setIncoming((current) => (current?.id === id ? null : current))
    setActiveRide((current) => (current?.id === id ? null : current))
  }, [driverId])
  const reviewAsked = useRef(new Set<string>())
  const askPassengerReviewOnce = useCallback(
    (rideId: string, raterId?: string) => {
      const rater = raterId || driverId
      if (!rater || reviewAsked.current.has(rideId)) return
      reviewAsked.current.add(rideId)
      onAskPassengerReview({ rideId, raterId: rater, raterRole: 'driver', targetName: '승객' })
    },
    [driverId, onAskPassengerReview],
  )

  useEffect(() => {
    const profile = loadPartnerProfile()
    setPartner(profile)
    const id = localDriverId(profile?.uid)
    const legacyId = readOrCreateLocalId(DRIVER_ID_KEY, 'driver')
    driverAliasRef.current = legacyId !== id ? legacyId : ''
    setDriverId(id)
    const cached = readEarningsCache(id)
    if (cached) {
      setEarnings(cached)
      setEarningsReady(true)
    }
    void fetchDriverEarnings(id, driverAliasRef.current).then((stats) => applyEarnings(id, stats))
    const stored = readStoredDriverRide(id)
    if (stored) {
      lastActiveRef.current = stored
      setActiveRide(stored)
      void fetchRideRequest(stored.id).then((latest) => {
        if (!latest) return
        // 같은 rideId라도 다른 기사에게 배정된 상태면 내 운행 카드가 아니다.
        // 승객 화면의 assignedDriver와 세션이 갈라지는 것을 여기서 차단한다.
        const assignedToOther = Boolean(
          latest.assignedDriver?.id &&
            latest.assignedDriver.id !== id &&
            latest.assignedDriver.id !== driverAliasRef.current,
        )
        if (latest.status !== 'assigned' || assignedToOther) {
          if (latest.status === 'completed') {
            noteActivity(`done:${stored.id}`, '운행 완료', rideRoute(stored))
            askPassengerReviewOnce(stored.id, id)
          } else if (assignedToOther) {
            noteActivity(`reassigned:${stored.id}`, '다른 기사 배정', rideRoute(stored))
          } else {
            noteActivity(`cancel:${stored.id}`, '취소', rideRoute(stored))
          }
          endedRideIds.current.add(stored.id)
          lastActiveRef.current = null
          writeStoredDriverRide(id, null)
          setActiveRide((current) => (current?.id === stored.id ? null : current))
          return
        }
        setActiveRide((current) => (current?.id === stored.id ? latest : current))
        lastActiveRef.current = latest
      }).catch(() => undefined)
    }
  }, [applyEarnings])

  useEffect(() => {
    if (driverId) writeStoredDriverRide(driverId, activeRide)
  }, [driverId, activeRide])

  useEffect(() => {
    setLocalDelivery(deliveryJob ?? loadDeliveryJob())
  }, [deliveryJob])

  useEffect(() => {
    if (!driverId) return
    let stopped = false
    let timer = 0
    let delay = 1000
    let sending = false
    const beat = () => {
      if (stopped || !online || sending) return
      sending = true
      const fleet = partnerVehicle(partner)
      void sendDriverPresence({
        driverId,
        altDriverId: driverAliasRef.current,
        lat,
        lng,
        online: true,
        name: partner?.name,
        vehicle: fleet.vehicle,
        plate: fleet.plate,
        wallet: partner?.wallet,
        piUid: partner?.uid,
      }).then(() => {
        delay = document.visibilityState === 'visible' ? 12000 : 20000
      }).catch(() => {
        delay = Math.min(delay * 2, 30000)
      }).finally(() => {
        sending = false
        if (!stopped && online) timer = window.setTimeout(beat, delay)
      })
    }
    const wake = () => {
      window.clearTimeout(timer)
      delay = 1000
      beat()
    }
    if (!online) {
      void sendDriverPresence({
        driverId,
        altDriverId: driverAliasRef.current,
        lat,
        lng,
        online: false,
        name: partner?.name,
        wallet: partner?.wallet,
        piUid: partner?.uid,
      }).catch(() => undefined)
    } else {
      void enableDriverPush(driverId).catch(() => undefined)
      beat()
    }
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [driverId, lat, lng, online, partner?.name, partner?.vehicle, partner?.plate, partner?.detail, partner?.wallet, partner?.uid])

  useEffect(() => {
    primeDriverAlertAudio()
    if (!online) {
      void releaseDriverWakeLock()
      return
    }
    const keepScreenOn = () => {
      if (document.visibilityState === 'visible') void acquireDriverWakeLock()
    }
    keepScreenOn()
    document.addEventListener('visibilitychange', keepScreenOn)
    return () => {
      document.removeEventListener('visibilitychange', keepScreenOn)
      void releaseDriverWakeLock()
    }
  }, [online])

  useEffect(() => {
    if (!driverId) return
    const streamReady = { current: false }
    const pushReady = { current: false }
    const notifiedOffer = { current: '' }
    const logOffer = (detail: { rideId: string | null; source: string }) => {
      const key = `${detail.source}:${detail.rideId ?? 'none'}`
      if (offerLogRef.current === key) return
      offerLogRef.current = key
      console.log('[driver-offer] state', { driverId, ...detail })
    }
    const rememberOffer = (ride: PublicRide, expiresAt: string | null | undefined, km: number | null) => {
      const parsed = Date.parse(expiresAt || '')
      localOfferRef.current = {
        ride,
        expiresAt: Number.isFinite(parsed) ? parsed : Date.now() + 45_000,
        km,
      }
      setIncoming(ride)
      setOfferKm(km)
    }
    const mergeActiveRide = (incoming: PublicRide | null) => {
      if (incoming && endedRideIds.current.has(incoming.id)) {
        dropEndedRide(incoming.id)
        return
      }
      if (incoming && incoming.status !== 'assigned') {
        if (incoming.status === 'completed') {
          noteActivity(`done:${incoming.id}`, '운행 완료', rideRoute(incoming))
          askPassengerReviewOnce(incoming.id)
        } else if (incoming.status === 'cancelled' || incoming.status === 'unmatched') {
          noteActivity(`cancel:${incoming.id}`, '취소', rideRoute(incoming))
        }
        dropEndedRide(incoming.id)
        return
      }
      // 서버에 assigned 콜이 없거나 사전 배차분이 현재 운행으로 승계되면 큐 표시를 지운다.
      setQueuedRide((queued) => (queued && (!incoming || queued.id === incoming.id) ? null : queued))
      setActiveRide((current) => {
        if (!incoming) return lastActiveRef.current ? current : null
        if (!current || current.id !== incoming.id) return incoming
        const incomingLocked = incoming.escrow?.status === 'held' || incoming.escrow?.status === 'released'
        const knownLocked = current.escrow?.status === 'held' || current.escrow?.status === 'released'
        return {
          ...incoming,
          boardedAt: incoming.boardedAt ?? current.boardedAt ?? null,
          readyToSettleAt: incoming.readyToSettleAt ?? current.readyToSettleAt ?? null,
          escrow: knownLocked && !incomingLocked ? current.escrow : incoming.escrow,
        }
      })
    }
    const reverifyEndedRide = (previous: PublicRide) => {
      if (activeEndChecks.current.has(previous.id)) return
      activeEndChecks.current.add(previous.id)
      void fetchRideRequest(previous.id).then((check) => {
        activeEndChecks.current.delete(previous.id)
        if (!check) return
        // 다른 기사에게 배정이 넘어간 운행도 종료 처리해 카드를 내린다.
        const assignedToOther = Boolean(
          check.assignedDriver?.id &&
            check.assignedDriver.id !== driverId &&
            check.assignedDriver.id !== driverAliasRef.current,
        )
        if (check.status !== 'completed' && check.status !== 'cancelled' && !assignedToOther) return
        if (check.status === 'completed') {
          noteActivity(`done:${previous.id}`, '운행 완료', rideRoute(previous))
          askPassengerReviewOnce(previous.id)
          onNotice('운행이 완료되었어요. 에스크로 정산이 기사 지갑으로 반영되었습니다.')
        } else if (assignedToOther) {
          noteActivity(`reassigned:${previous.id}`, '다른 기사 배정', rideRoute(previous))
        } else {
          noteActivity(`cancel:${previous.id}`, '취소', rideRoute(previous))
        }
        dropEndedRide(previous.id)
      }).catch(() => {
        activeEndChecks.current.delete(previous.id)
      })
    }
    const applyOffer = (pending: { ride: PublicRide | null; offer?: { pickupDistanceKm?: number; expiresAt?: string } | null; earnings?: DriverEarningsStats | null; active?: PublicRide | null; penalty?: DriverPenaltyInfo | null } | null, active?: PublicRide | null) => {
      if (pending?.penalty) {
        const level = pending.penalty.level
        setDriverPenalty(pending.penalty)
        // 등급이 올라갈 때만 경고를 띄운다 — 매 폴링마다 반복 알림이 되지 않게 한다.
        if (level !== 'ok' && penaltyLevelRef.current !== level) {
          onNotice('거절 횟수가 누적되면 콜 배정이 어렵습니다. 주의해 주세요.')
        }
        penaltyLevelRef.current = level
      }
      if (active && endedRideIds.current.has(active.id)) active = null
      const fetched = pending?.ride ?? null
      if (fetched && dismissedOfferIds.current.has(fetched.id) && localOfferRef.current?.ride.id === fetched.id) {
        localOfferRef.current = null
      }
      const ride = fetched && dismissedOfferIds.current.has(fetched.id) ? null : fetched
      if (pending?.earnings) applyEarnings(driverId, pending.earnings)
      if (!activityPrimed.current) {
        activityPrimed.current = true
        if (ride?.id) activityKeys.current.add(`offer:${ride.id}`)
        if (active?.id) activityKeys.current.add(`accept:${active.id}`)
        lastActiveRef.current = active ?? null
      } else {
        if (ride?.id) noteActivity(`offer:${ride.id}`, '호출 접수', rideRoute(ride))
        if (active) {
          noteActivity(`accept:${active.id}`, '수락', rideRoute(active))
          if (active.escrow?.status === 'held') noteActivity(`escrow:${active.id}`, '에스크로 잠금', `${rideRoute(active)} · 잠금 완료`)
          if (active.escrow?.status === 'released') noteActivity(`settle:${active.id}`, '정산', `${rideRoute(active)} · ${(active.escrow.amount ?? active.estimatedFare).toFixed(7)} Pi`)
          if (active.readyToSettleAt) noteActivity(`arrive:${active.id}`, '목적지 도착', rideRoute(active))
          if (active.status === 'completed') noteActivity(`done:${active.id}`, '운행 완료', rideRoute(active))
          lastActiveRef.current = active
        } else if (active === null && lastActiveRef.current) {
          reverifyEndedRide(lastActiveRef.current)
        }
      }
      if (active !== undefined) mergeActiveRide(active)
      if (!online) {
        localOfferRef.current = null
        setIncoming(null)
        logOffer({ rideId: null, source: 'offline' })
        return
      }
      if (ride) {
        logOffer({ rideId: ride.id, source: 'server' })
        rememberOffer(ride, pending?.offer?.expiresAt || ride.offerExpiresAt, pending?.offer?.pickupDistanceKm ?? ride.assignedDriver?.pickupDistanceKm ?? null)
        if (ride.id === notifiedOffer.current) return
        notifiedOffer.current = ride.id
        alertDriverOffer(ride.id)
        if (pushReady.current) return
        void showDriverOfferNotification(ride.id, rideStops(ride).chain)
        return
      }
      const held = localOfferRef.current
      if (held && held.expiresAt > Date.now() && !dismissedOfferIds.current.has(held.ride.id)) {
        logOffer({ rideId: held.ride.id, source: 'push' })
        setIncoming(held.ride)
        setOfferKm(held.km)
        return
      }
      notifiedOffer.current = ''
      localOfferRef.current = null
      setIncoming(null)
      setOfferKm(null)
      logOffer({ rideId: null, source: 'empty' })
    }
    const unsubscribe = online
      ? subscribeDriverLive(driverId, (snapshot) => {
          streamReady.current = true
          applyOffer({ ride: snapshot.ride, offer: snapshot.offer, earnings: snapshot.earnings }, snapshot.active)
        }, driverAliasRef.current ? [driverAliasRef.current] : [])
      : () => undefined
    if (online) {
      void enableDriverPush(driverId).then((ready) => {
        pushReady.current = ready
      }).catch(() => undefined)
    } else {
      setIncoming(null)
    }
    let offerRequest = 0
    const pullOffer = () => {
      if (!online) return
      const request = ++offerRequest
      void fetchDriverOffer(driverId, driverAliasRef.current).then((pending) => {
        if (request !== offerRequest || pending === undefined) return
        applyOffer(pending, pending.active)
      })
    }
    const refreshDesk = () => {
      pullOffer()
      void Promise.all([
        fetchDriverActiveRide(driverId, driverAliasRef.current),
        fetchDriverEarnings(driverId, driverAliasRef.current),
        fetchUserRating(driverId, 'driver'),
        fetchSosInbox(driverId, 'driver'),
        fetchLostInbox(driverId, 'driver'),
      ]).then(([active, stats, rating, alerts, lost]) => {
        if (active) mergeActiveRide(active)
        else if (lastActiveRef.current) reverifyEndedRide(lastActiveRef.current)
        applyEarnings(driverId, stats)
        if (rating) setDriverRating(rating.average.toFixed(2))
        setSosAlerts(alerts)
        setLostItems(lost)
        // 새로 접수된 분실물 건은 기사가 다른 화면을 보고 있어도 알림음으로 알린다.
        const ids = new Set(lost.map((row) => row.id))
        const arrived = lostSeenRef.current ? lost.filter((row) => !lostSeenRef.current!.has(row.id)) : []
        lostSeenRef.current = ids
        if (arrived.length) {
          playCommsAlert('call')
          setFreshLostIds((prev) => [...new Set([...prev, ...arrived.map((row) => row.id)])])
          noteActivity(`lost:${arrived[0].id}`, '분실물 접수', `${arrived[0].itemType} · ${arrived[0].route}`)
        }
        setLocalDelivery(deliveryJob ?? loadDeliveryJob())
      }).catch(() => undefined)
    }
    const onAlert = (event: MessageEvent) => {
      if (event.data?.type !== 'driver-offer') return
      const pushed = rideFromPushedOffer(event.data.offer)
      if (!online || !pushed) {
        pullOffer()
        return
      }
      logOffer({ rideId: pushed.ride.id, source: 'push' })
      if (dismissedOfferIds.current.has(pushed.ride.id)) return
      rememberOffer(pushed.ride, pushed.offer.expiresAt, pushed.offer.pickupDistanceKm)
      // 푸시 수신 즉시 알림음 — 다음 폴링(최대 2s)을 기다리지 않는다.
      // alertDriverOffer는 ride.id로 중복 제거되므로 폴링 도착 시 재울리지 않는다.
      alertDriverOffer(pushed.ride.id)
    }
    refreshDesk()
    const askStoredOffer = () => navigator.serviceWorker?.controller?.postMessage({ type: 'driver-offer-sync' })
    askStoredOffer()
    void navigator.serviceWorker?.ready.then(() => askStoredOffer())
    const offerPoll = window.setInterval(pullOffer, 2000)
    const poll = window.setInterval(refreshDesk, 20000)
    window.addEventListener('online', pullOffer)
    document.addEventListener('visibilitychange', pullOffer)
    navigator.serviceWorker?.addEventListener('message', onAlert)
    return () => {
      unsubscribe()
      window.clearInterval(offerPoll)
      window.clearInterval(poll)
      window.removeEventListener('online', pullOffer)
      document.removeEventListener('visibilitychange', pullOffer)
      navigator.serviceWorker?.removeEventListener('message', onAlert)
    }
  }, [driverId, online, deliveryJob, noteActivity])

  useEffect(() => {
    if (!online || partner?.serviceType !== '택배') {
      setOpenDeliveries([])
      return
    }
    let stopped = false
    const pull = () => {
      void fetchOpenDeliveries().then((jobs) => {
        if (!stopped) setOpenDeliveries(jobs)
      }).catch(() => undefined)
    }
    pull()
    const timer = window.setInterval(pull, 2000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [online, partner?.serviceType])

  useEffect(() => {
    const job = deliveryJob ?? localDelivery
    const key = job ? `${job.id}:${job.status}` : ''
    if (deliverySeen.current === null) {
      deliverySeen.current = key
      return
    }
    if (!job || deliverySeen.current === key) return
    deliverySeen.current = key
    const label = job.status === 'completed' ? '배송 완료' : job.status === 'assigned' ? '배송 수락' : '배송 접수'
    noteActivity(`delivery:${key}`, label, `${job.pickupAddress} → ${job.destAddress}`)
  }, [deliveryJob, localDelivery, noteActivity])

  const respond = (action: 'accept' | 'reject') => {
    if (!incoming || busy || !driverId) return
    stopDriverOfferAlarm()
    setBusy(true)
    // 수락/거절 모두 즉시 오퍼 큐에서 제거 — 응답 대기 중 폴링·SSE·푸시가 같은 콜을 다시 띄우지 못하게 한다.
    dismissedOfferIds.current.add(incoming.id)
    localOfferRef.current = null
    setIncoming(null)
    setOfferKm(null)
    const fleet = partnerVehicle(partner)
    void respondToRideOffer(incoming.id, incoming.pendingOffer?.driverId || driverId, action, incoming, {
      name: partner?.name,
      vehicle: fleet.vehicle,
      plate: fleet.plate,
    })
      .then(({ ride, penalty }) => {
        if (action === 'accept') {
          if (ride.status === 'assigned') {
            endedRideIds.current.delete(ride.id)
            if (activeRide && activeRide.id !== ride.id) {
              // 사전 배차 수락 — 진행 중인 운행 카드를 유지하고 다음 콜만 큐에 둔다.
              setQueuedRide(ride)
              noteActivity(`prematch:${ride.id}`, '사전 배차', rideRoute(ride))
              onNotice('다음 콜이 사전 배차되었어요. 현재 운행이 끝나면 이어서 진행됩니다.')
            } else {
              lastActiveRef.current = ride
              writeStoredDriverRide(driverId, ride)
              setActiveRide(ride)
              noteActivity(`accept:${ride.id}`, '수락', rideRoute(ride))
              onNotice('운행을 수락했어요. 승객 에스크로가 잠기면 운행 완료 시 자동 정산됩니다.')
            }
          } else {
            onNotice('배차가 확정되지 않았어요. 잠시 후 다시 확인해 주세요.')
          }
        } else {
          noteActivity(`reject:${incoming.id}`, '거절', rideRoute(incoming))
          onNotice(
            penalty && penalty.level !== 'ok'
              ? '거절 횟수가 누적되면 콜 배정이 어렵습니다. 주의해 주세요.'
              : '요청을 거절했어요. 다음 기사에게 콜이 넘어갑니다.',
          )
        }
        void fetchDriverEarnings(driverId, driverAliasRef.current).then((stats) => applyEarnings(driverId, stats))
        setIncoming(null)
      })
      .catch((error) => {
        // 수락이 실제로 실패하면(네트워크 오류 등) 콜이 아직 살아있을 수 있으므로 차단을 해제해 재시도를 허용한다.
        if (action === 'accept') dismissedOfferIds.current.delete(incoming.id)
        onNotice(error instanceof Error ? error.message : '콜 응답에 실패했어요.')
        setIncoming(null)
      })
      .finally(() => setBusy(false))
  }

  const finishTrip = () => {
    if (busy) return
    if (!activeRide || !driverId) {
      onNotice('정산할 운행 정보를 찾지 못했어요. 화면을 새로고침한 뒤 다시 눌러 주세요.')
      return
    }
    if (!activeRide.readyToSettleAt) {
      onNotice('승객이 탑승을 확인하고 목적지에 도착한 뒤에만 정산할 수 있어요.')
      return
    }
    setBusy(true)
    const measuredKm = odoRef.current.rideId === activeRide.id && odoRef.current.km > 0.3
      ? Math.round(odoRef.current.km * 100) / 100
      : undefined
    void completeRideTrip(activeRide.id, activeRide.assignedDriver?.id || driverId, activeRide, { actualKm: measuredKm })
      .then((result) => {
        if (result.receipt) {
          appendSettlementEntry(result.receipt.amount, `에스크로 정산 · ${result.receipt.route}`)
          noteActivity(`settle:${activeRide.id}`, '정산', `${result.receipt.route} · ${result.receipt.amount.toFixed(7)} Pi · 정산됨`)
        }
        noteActivity(`done:${activeRide.id}`, '운행 완료', rideRoute(activeRide))
        const finished = activeRide
        dropEndedRide(finished.id)
        setActiveRide(null)
        onNotice('운행 완료. 에스크로 Pi가 등록 지갑으로 정산되었습니다.')
        if (finished) askPassengerReviewOnce(finished.id)
        return fetchDriverEarnings(driverId, driverAliasRef.current)
      })
      .then((stats) => {
        applyEarnings(driverId, stats)
      })
      .catch((error) => {
        onNotice(error instanceof Error ? error.message : '정산에 실패했어요. 에스크로 잠금을 확인해 주세요.')
      })
      .finally(() => setBusy(false))
  }
  const abandonTrip = () => {
    if (busy) return
    if (!activeRide || !driverId) {
      onNotice('취소할 배차를 찾지 못했어요.')
      return
    }
    setBusy(true)
    void abandonDriverRide(activeRide.id, activeRide.assignedDriver?.id || driverId)
      .then(() => {
        noteActivity(`cancel:${activeRide.id}`, '취소', rideRoute(activeRide))
        dropEndedRide(activeRide.id)
        setActiveRide(null)
        setIncoming(null)
        onNotice('배차를 취소했어요. 승객과 함께 대기 상태로 돌아갑니다.')
        return fetchDriverEarnings(driverId, driverAliasRef.current)
      })
      .then((stats) => {
        applyEarnings(driverId, stats)
      })
      .catch((error) => {
        onNotice(error instanceof Error ? error.message : '배차 취소에 실패했어요.')
      })
      .finally(() => setBusy(false))
  }
  const canSettle = Boolean(activeRide?.readyToSettleAt)
  const activeDelivery = deliveryJob ?? localDelivery
  return (
    <main className="flex-1 overflow-y-auto px-4 pb-24 pt-2">
      <section className="rounded-2xl bg-[#243044] px-3.5 py-2.5 text-white shadow-[0_8px_18px_rgba(15,23,42,0.12)]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold leading-none text-[#93C5FD]">기사/파트너 모드</p>
            <h2 className="mt-1 truncate text-base font-bold leading-tight tracking-tight">오늘도 안전 운행하세요</h2>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${online ? 'bg-[#D1FAE5] text-[#047857]' : 'bg-white/10 text-[#CBD5E1]'}`}>{online ? '영업 중' : '영업 종료'}</span>
        </div>
        <p className="mt-1 text-[10px] font-medium leading-tight text-[#CBD5E1]">근처 호출 요청을 실시간으로 확인하세요</p>
        <button
          onClick={() => {
            primeDriverAlertAudio()
            if (!online && driverId) {
              void enableDriverPush(driverId, true).catch(() => undefined)
              void acquireDriverWakeLock()
            }
            onToggleOnline()
          }}
          className={`mt-2 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left ${online ? 'bg-[#4A82B8]' : 'bg-white/10'}`}
        >
          <span>
            <span className="block text-[10px] font-medium leading-none text-white/70">운행 상태</span>
            <strong className="mt-0.5 block text-sm font-bold leading-tight">{online ? '영업 중 (Online)' : '영업 종료 (Offline)'}</strong>
          </span>
          <span className={`relative h-6 w-10 rounded-full p-0.5 transition ${online ? 'bg-white/25' : 'bg-black/20'}`}>
            <span className={`block h-5 w-5 rounded-full bg-white transition ${online ? 'translate-x-4' : ''}`} />
          </span>
        </button>
      </section>
      {partner ? (
        <section className="mt-2 flex items-center gap-2 rounded-xl border border-[#BFDBFE] bg-[#E8F1FA] px-2.5 py-1">
          <p className="shrink-0 text-[9px] font-bold leading-none text-[#4A82B8]">Pi 정산</p>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-bold leading-tight text-[#0F172A]">@{partner.username} · {partner.role}</p>
            <p className="truncate text-[9px] font-medium leading-tight text-[#64748B]" title={`UID ${partner.uid} · Wallet ${partner.wallet}`}>
              {partner.uid} · {partner.wallet}
            </p>
          </div>
        </section>
      ) : null}
      <section className="mt-2 grid grid-cols-3 gap-2">
        <button type="button" onClick={() => setStatSheet('revenue')} className="rounded-xl border border-[#CBD5E1] bg-white px-2.5 py-2 text-left shadow-sm transition active:scale-[0.98]">
          <p className="text-[10px] font-semibold text-[#64748B]">오늘의 수익</p>
          <p className="mt-1 text-base font-bold leading-tight text-[#0F766E]">{earningsReady && earnings ? `${earnings.todayAmount.toFixed(1)} Pi` : '…'}</p>
          <p className="mt-0.5 text-[10px] font-bold text-[#0D9488]">상세 보기 ›</p>
        </button>
        <button type="button" onClick={() => setStatSheet('trips')} className="rounded-xl border border-[#CBD5E1] bg-white px-2.5 py-2 text-left shadow-sm transition active:scale-[0.98]">
          <p className="text-[10px] font-semibold text-[#64748B]">{earningsReady && earnings ? `${earnings.todayTrips}건 운행` : '운행'}</p>
          <p className="mt-1 text-base font-bold leading-tight text-[#0F172A]">{earningsReady && earnings ? `${earnings.todayTrips}건` : '…'}</p>
          <p className="mt-0.5 text-[10px] font-bold text-[#0369A1]">상세 보기 ›</p>
        </button>
        <div className="rounded-xl border border-[#CBD5E1] bg-white px-2.5 py-2 shadow-sm">
          <p className="text-[10px] font-semibold text-[#64748B]">기사 평점</p>
          <p className="mt-1 text-base font-bold leading-tight text-[#0F172A]">{driverRating}</p>
        </div>
      </section>
      <button
        type="button"
        onClick={() => {
          if (!driverId) {
            onNotice('기사/파트너 로그인이 필요합니다.')
            return
          }
          setManualPayOpen(true)
        }}
        className="mt-2 flex w-full items-center justify-between gap-2 rounded-2xl bg-gradient-to-r from-[#4C1FB8] to-[#7C3AED] px-4 py-3.5 text-left shadow-lg shadow-[#4C1FB8]/30 transition active:scale-[0.99]"
      >
        <span>
          <span className="block text-sm font-black text-white">현장 수동 승객 탑승 · Pi 결제 (수동 정산)</span>
          <span className="mt-0.5 block text-[10px] font-bold text-white/80">배차 없이 현장 승객에게 바로 청구하고 오늘의 수익에 반영합니다</span>
        </span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/20 text-base font-black text-white">＋</span>
      </button>
      {activeRide ? (
        <section className="mt-4 rounded-[26px] border-2 border-[#86EFAC] bg-[#F0FDF4] p-5 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
          <p className="text-xs font-bold text-[#047857]">배차된 운행</p>
          <p className="mt-2 text-lg font-bold leading-6 text-[#0F172A]">{rideStops(activeRide).chain}</p>
          {rideStops(activeRide).via.length ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-[#EA580C]">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              경유지 {rideStops(activeRide).via.join(' · ')}
            </p>
          ) : null}
          <p className="mt-1 text-sm font-semibold text-[#334155]">
            에스크로 {activeRide.escrow?.amount?.toFixed(7) ?? activeRide.estimatedFare.toFixed(7)} Pi · {activeRide.escrow?.status === 'held' ? '잠금 완료' : activeRide.escrow?.status === 'released' ? '정산됨' : '승객 입금 대기'}
          </p>
          <p className="mt-2 text-xs font-bold text-[#047857]">
            {activeRide.readyToSettleAt ? '승객이 목적지 도착을 확인했어요. 정산할 수 있어요.' : activeRide.boardedAt ? '승객이 탑승을 확인했어요. 목적지 도착 확인을 기다리는 중이에요.' : '승객의 탑승 확인 전에는 정산할 수 없어요.'}
          </p>
          {queuedRide ? (
            <p className="mt-2 rounded-lg bg-[#DBEAFE] px-2.5 py-1.5 text-[11px] font-black text-[#1D4ED8]">
              다음 콜 사전 배차됨 — {rideStops(queuedRide).chain}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-[#047857] bg-white py-3 text-sm font-black text-[#047857] shadow-sm transition active:scale-[0.98]"
          >
            <Navigation className="h-4 w-4" />
            길안내 내비게이션
          </button>
          {!activeRide.boardedAt ? (
            <div className="mt-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-black text-[#047857]">
                <MapPin className="h-3.5 w-3.5" />
                승객 탑승 위치로 이동해 주세요
              </p>
              <TaxiLiveMap
                kind="taxi"
                phase="arriving"
                routeLabel={rideStops(activeRide).chain}
                statusLabel="픽업지로 이동 중"
                originLat={activeRide.pickup.lat}
                originLng={activeRide.pickup.lng}
                destLat={activeRide.dest.lat}
                destLng={activeRide.dest.lng}
                originLabel={activeRide.pickup.address || '승객 탑승 위치'}
                destLabel={activeRide.dest.label || activeRide.dest.address || '목적지'}
                waypoints={activeRide.waypoints ?? []}
                vehicleLat={lat}
                vehicleLng={lng}
                className="mt-0 h-[min(58dvh,460px)]"
              />
            </div>
          ) : null}
          <button
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={finishTrip}
            className={`relative z-10 mt-4 w-full rounded-2xl py-3.5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 ${canSettle ? 'bg-[#047857]' : 'bg-[#94A3B8]'}`}
          >
            {busy ? '정산 중…' : '운행 완료 · 자동 정산'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={abandonTrip}
            className="relative z-10 mt-2 w-full rounded-2xl border-2 border-[#FECACA] bg-white py-3.5 font-bold text-[#BE123C] disabled:opacity-50"
          >
            배차 취소
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setCallOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#4A82B8] py-3 text-sm font-bold text-white">
              안심 통화
            </button>
            <button type="button" onClick={() => setChatOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-[#4A82B8] bg-white py-3 text-sm font-bold text-[#4A82B8]">
              실시간 채팅
            </button>
          </div>
          <div className="mt-2">
            <RideSosButton
              rideId={activeRide.id}
              actorId={driverId}
              role="driver"
              fallbackLat={lat}
              fallbackLng={lng}
              vehicle={partner?.role === '기사' ? '택시' : undefined}
              onNotice={onNotice}
            />
          </div>
        </section>
      ) : null}
      {navOpen && activeRide ? (
        <div className="fixed inset-0 z-[110] bg-[#0F172A]">
          <TaxiLiveMap
            bare
            kind={activeRide.kind}
            phase={activeRide.boardedAt ? 'moving' : 'arriving'}
            routeLabel={rideStops(activeRide).chain}
            statusLabel={activeRide.boardedAt ? '목적지 이동 중' : '픽업지 이동 중'}
            originLat={activeRide.pickup.lat}
            originLng={activeRide.pickup.lng}
            destLat={activeRide.dest.lat}
            destLng={activeRide.dest.lng}
            originLabel={activeRide.pickup.address || '승객 탑승 위치'}
            destLabel={activeRide.dest.label || activeRide.dest.address || '목적지'}
            waypoints={activeRide.waypoints ?? []}
            vehicleLat={lat}
            vehicleLng={lng}
            className="h-full"
          />
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="돌아가기"
            className="absolute left-3 top-3 z-30 flex items-center gap-1 rounded-full bg-white px-3.5 py-2 text-xs font-black text-[#0F172A] shadow-lg transition active:scale-95"
          >
            <ChevronLeft className="h-4 w-4" />
            돌아가기
          </button>
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 rounded-2xl bg-white/95 px-4 py-3 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black text-[#047857]">
                  {activeRide.readyToSettleAt ? '도착 확인 완료 · 정산 대기' : activeRide.boardedAt ? '승객 탑승 완료 · 목적지로 안내' : '승객 탑승 위치로 안내'}
                </p>
                <p className="mt-0.5 truncate text-xs font-black text-[#0F172A]">{rideStops(activeRide).chain}</p>
              </div>
              <p className="shrink-0 text-sm font-black text-[#4C1FB8]">{(activeRide.escrow?.amount ?? activeRide.estimatedFare).toFixed(7)} Pi</p>
            </div>
          </div>
        </div>
      ) : null}
      {(activeDelivery) ? (
        <section className="mt-4 rounded-[26px] border-2 border-[#86EFAC] bg-[#F0FDF4] p-5 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
          <p className="text-xs font-bold text-[#047857]">배송 관리</p>
          <p className="mt-2 text-lg font-bold leading-6 text-[#0F172A]">
            {activeDelivery.pickupAddress} → {activeDelivery.destAddress}
          </p>
          <p className="mt-1 text-sm font-semibold text-[#334155]">
            {activeDelivery.vehicle} · {activeDelivery.packageLabel} · {formatDeliveryFare(activeDelivery.fare)} Pi
          </p>
          <div className="mt-3">
            <DeliveryContactCard job={activeDelivery} onChat={setDeliveryChatPeer} />
          </div>
        </section>
      ) : partner?.serviceType === '택배' ? (
        <section className="mt-4 rounded-[26px] border-2 border-[#BBF7D0] bg-white p-5 text-center">
          <p className="font-bold text-[#0F172A]">대기 중인 배송 건이 없습니다</p>
          <p className="mt-1 text-xs font-medium text-[#64748B]">고객이 택배를 신청하면 발신인·수신인 연락처가 여기에 표시됩니다.</p>
        </section>
      ) : null}
      {sosAlerts[0] ? (
        <section className="mt-4 rounded-[26px] border-2 border-[#FECACA] bg-[#FEF2F2] p-4">
          <p className="text-xs font-black text-[#B91C1C]">긴급 SOS · {sosAlerts[0].route}</p>
          <p className="mt-1 text-sm font-bold text-[#7F1D1D]">승객 위치 {sosAlerts[0].lat.toFixed(5)}, {sosAlerts[0].lng.toFixed(5)}</p>
        </section>
      ) : null}
      {lostItems[0] ? (
        <button
          type="button"
          onClick={() => {
            setLostFocus(lostItems[0].id)
            setFreshLostIds([])
            setDeskOpen(true)
          }}
          className={`mt-4 w-full rounded-[26px] border-2 p-4 text-left ${freshLostIds.length ? 'border-[#FCA5A5] bg-[#FEF2F2]' : 'border-[#E0D4FF] bg-[#F8F5FF]'}`}
        >
          <p className="flex items-center gap-1.5 text-xs font-black text-[#4C1FB8]">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black text-white ${freshLostIds.length ? 'bg-[#DC2626]' : 'bg-[#4C1FB8]'}`}>{lostItems.length}</span>
            분실물 문의 {lostItems.length}건
            {freshLostIds.length ? <span className="rounded-full bg-[#DC2626] px-1.5 py-0.5 text-[9px] font-black text-white">신규</span> : null}
          </p>
          <p className="mt-1 text-sm font-black text-[#0F172A]">{lostItems[0].itemType} · {lostItems[0].route}</p>
          <p className="mt-0.5 text-[10px] font-bold text-[#94A3B8]">터치하면 채팅이 바로 열립니다</p>
        </button>
      ) : null}
      {partner?.serviceType === '택배' && openDeliveries[0] ? (
        <section className="mt-2 rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4">
          <p className="text-xs font-bold text-[#4A82B8]">새로운 택배 요청</p>
          <p className="mt-2 text-base font-bold text-[#0F172A]">{openDeliveries[0].pickupAddress} → {openDeliveries[0].destAddress}</p>
          <p className="mt-1 text-xs font-semibold text-[#475569]">{openDeliveries[0].packageLabel} · {openDeliveries[0].fare.toFixed(1)} Pi</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const job = openDeliveries[0]
              const fleet = partnerVehicle(partner)
              if (!job || !driverId || !fleet.vehicle || !fleet.plate) {
                onNotice('프로필에 차량명과 차량번호를 등록한 뒤 수락해 주세요.')
                return
              }
              setBusy(true)
              void acceptDelivery(job.id, { driverId, name: partner?.name, vehicle: fleet.vehicle, plate: fleet.plate })
                .then(() => {
                  setOpenDeliveries((items) => items.filter((item) => item.id !== job.id))
                  noteActivity(`delivery-accept:${job.id}`, '배차 수락', `${job.pickupAddress} → ${job.destAddress} · ${fleet.vehicle} ${fleet.plate}`)
                  onNotice('택배를 수락했어요. 화주 화면에 차량 정보가 표시됩니다.')
                })
                .catch((error) => onNotice(error instanceof Error ? error.message : '배차 수락에 실패했어요.'))
                .finally(() => setBusy(false))
            }}
            className="mt-3 w-full rounded-2xl bg-[#4A82B8] py-3 font-bold text-white disabled:opacity-60"
          >
            배차 수락
          </button>
        </section>
      ) : null}
      {driverPenalty && driverPenalty.level !== 'ok' ? (
        <section className={`mt-2 rounded-xl border px-3 py-2.5 ${
          driverPenalty.level === 'penalty'
            ? 'border-[#FCA5A5] bg-[#FEF2F2]'
            : 'border-[#FCD34D] bg-[#FFFBEB]'
        }`}>
          <p className={`text-xs font-black ${driverPenalty.level === 'penalty' ? 'text-[#B91C1C]' : 'text-[#B45309]'}`}>
            {driverPenalty.level === 'penalty' ? '콜 배정 우선순위가 낮아졌어요' : '콜 거절 누적 경고'}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold text-[#475569]">
            거절 횟수가 누적되면 콜 배정이 어렵습니다. 주의해 주세요.
            {driverPenalty.rejected + driverPenalty.timedOut > 0 ? ` (최근 미응답·거절 ${driverPenalty.rejected + driverPenalty.timedOut}건)` : ''}
          </p>
        </section>
      ) : null}
      {online && incoming ? (
        <section className="mt-2 rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-[#4A82B8]">새로운 운행 요청</p>
            <span className="animate-pulse rounded-full bg-[#4A82B8] px-2 py-1 text-[10px] font-bold text-white">우선 배차</span>
          </div>
          <LongDistanceCallBadge ride={incoming} />
          {activeRide ? (
            <p className="mt-2 rounded-lg bg-[#DBEAFE] px-2.5 py-1.5 text-[11px] font-black text-[#1D4ED8]">
              사전 배차 콜 · 현재 운행이 끝나면 이어서 이동할 다음 콜입니다.
            </p>
          ) : null}
          <p className="mt-3 text-lg font-bold leading-6 text-[#0F172A]">{rideStops(incoming).chain}</p>
          {rideStops(incoming).via.length ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-[#EA580C]">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              경유지 {rideStops(incoming).via.join(' · ')}
            </p>
          ) : null}
          <TaxiLiveMap
            kind={incoming.kind}
            phase="arriving"
            routeLabel={rideStops(incoming).chain}
            statusLabel="픽업 경로"
            originLat={incoming.pickup.lat}
            originLng={incoming.pickup.lng}
            destLat={incoming.dest.lat}
            destLng={incoming.dest.lng}
            originLabel={incoming.pickup.address || '승객 탑승 위치'}
            destLabel={incoming.dest.label || incoming.dest.address || '목적지'}
            waypoints={incoming.waypoints ?? []}
            vehicleLat={lat}
            vehicleLng={lng}
            className="mt-2 h-[140px]"
          />
          <div className="mt-2 flex justify-between text-sm font-semibold text-[#475569]">
            <span>승객까지 {offerKm != null ? `${offerKm.toFixed(1)} km` : '계산 중'}</span>
            <strong className="text-[#0F172A]">{Number(incoming.estimatedFare || 0).toFixed(7)} Pi</strong>
          </div>
          {Number(incoming.avoidSurchargePi || 0) > 0 ? (
            <p className="mt-1.5 rounded-lg bg-[#FEF3C7] px-2.5 py-1.5 text-[11px] font-black text-[#B45309]">
              기피 지역 할증 +{Number(incoming.avoidSurchargePi).toFixed(7)} Pi 적용 — 추가 수익이 붙은 콜입니다.
            </p>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              disabled={busy}
              onClick={() => respond('accept')}
              className="rounded-2xl bg-[#4A82B8] py-3.5 font-bold text-white disabled:opacity-60"
            >
              수락
            </button>
            <button
              disabled={busy}
              onClick={() => respond('reject')}
              className="rounded-2xl border-2 border-[#CBD5E1] bg-white py-3.5 font-bold text-[#475569] disabled:opacity-60"
            >
              거절
            </button>
          </div>
        </section>
      ) : (
        <section className="mt-2 rounded-xl border border-[#CBD5E1] bg-white px-3 py-2.5 text-center shadow-sm">
          <p className="text-sm font-bold text-[#0F172A]">{online ? '새로운 요청을 기다리는 중이에요' : '영업을 시작하면 요청을 받을 수 있어요'}</p>
          <p className="mt-0.5 text-[11px] font-medium text-[#64748B]">주변 승객의 호출이 이곳에 표시됩니다.</p>
        </section>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={onPassengerMode} className="rounded-xl border border-[#CBD5E1] bg-white py-2 text-xs font-bold text-[#334155]">
          홈으로 돌아가기
        </button>
        <button type="button" onClick={() => setDeskOpen(true)} className="rounded-xl border border-[#4A82B8] bg-white py-2 text-xs font-bold text-[#4A82B8]">
          분실물 · 고객지원
        </button>
      </div>
      <section className="mt-2 rounded-xl border border-[#CBD5E1] bg-white px-3 py-2 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-bold leading-none text-[#4A82B8]">계정 설정</p>
            <h3 className="mt-0.5 text-sm font-bold leading-tight text-[#0F172A]">기사/파트너 권한</h3>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (partner) setProfileEditOpen(true)
                else onNotice('먼저 기사/파트너 등록을 완료해 주세요.')
              }}
              className="rounded-lg border border-[#BFDBFE] bg-[#E8F1FA] px-2.5 py-1.5 text-xs font-bold text-[#4A82B8] transition hover:bg-[#DCEBF8] active:scale-[0.99]"
            >
              정보 수정
            </button>
            <button
              type="button"
              onClick={() => setWithdrawOpen(true)}
              className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-1.5 text-xs font-bold text-[#B91C1C] transition hover:bg-[#FEE2E2] active:scale-[0.99]"
            >
              회원탈퇴
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] font-medium leading-4 text-[#64748B]">차량명·차량번호·연락처를 수정하면 승객 매칭 화면에도 바로 반영돼요. 탈퇴하면 콜 수락과 대시보드를 쓸 수 없습니다.</p>
      </section>
      {withdrawOpen ? (
        <WithdrawConfirmModal
          busy={withdrawing}
          onClose={() => { if (!withdrawing) setWithdrawOpen(false) }}
          onConfirm={() => {
            if (withdrawing) return
            setWithdrawing(true)
            void Promise.resolve(onWithdraw())
              // false가 돌아오면 서버가 탈퇴를 거부한 것 — 모달을 닫지 않고
              // 열어둬 이용자가 사유를 보고 재시도할 수 있게 한다.
              .then((ok) => { if (ok !== false) setWithdrawOpen(false) })
              .catch((error) => onNotice(error instanceof Error ? error.message : '회원 탈퇴에 실패했어요.'))
              .finally(() => setWithdrawing(false))
          }}
        />
      ) : null}
      {statSheet ? <EarningsStatSheet kind={statSheet} stats={earnings} onClose={() => setStatSheet(null)} /> : null}
      {manualPayOpen ? (
        <ManualPayModal
          driverId={driverId}
          driverName={partner?.name || partner?.username || ''}
          driverWallet={partner?.wallet || ''}
          onSettled={() => {
            if (driverId) void fetchDriverEarnings(driverId, driverAliasRef.current).then((stats) => applyEarnings(driverId, stats))
          }}
          onClose={() => setManualPayOpen(false)}
          onNotice={onNotice}
        />
      ) : null}
      {profileEditOpen && partner ? (
        <PartnerProfileEditModal
          profile={partner}
          onClose={() => setProfileEditOpen(false)}
          onSaved={(next) => setPartner(next)}
          onDone={onNotice}
        />
      ) : null}
      {callOpen && activeRide ? (
        <RideSafeCall
          rideId={activeRide.id}
          actorId={driverId}
          role="driver"
          peerName="승객"
          onHangup={() => setCallOpen(false)}
        />
      ) : null}
      {chatOpen && activeRide ? (
        <RideChat
          rideId={activeRide.id}
          actorId={driverId}
          role="driver"
          peerName="승객"
          onClose={() => setChatOpen(false)}
        />
      ) : null}
      <RideCommsAlerts
        rideId={activeRide?.status === 'assigned' ? activeRide.id : null}
        actorId={activeRide?.assignedDriver?.id || driverId}
        role="driver"
        peerName="승객"
        chatOpen={chatOpen}
        callOpen={callOpen}
        onOpenChat={() => {
          setNavOpen(false)
          setChatOpen(true)
        }}
        onOpenCall={() => {
          setNavOpen(false)
          setCallOpen(true)
        }}
      />
      {deliveryChatPeer && activeDelivery ? (
        <DeliveryChatSheet job={activeDelivery} peer={deliveryChatPeer} onClose={() => setDeliveryChatPeer(null)} />
      ) : null}
      {deskOpen ? (
        <div className="fixed inset-0 z-[96] flex items-end bg-[#241d35]/45" onClick={() => { setDeskOpen(false); setLostFocus(null) }}>
          <section className="mx-auto max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-white px-5 py-5" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-black">기사 고객지원</h2>
              <button type="button" onClick={() => { setDeskOpen(false); setLostFocus(null) }} className="text-sm font-black text-[#64748B]">닫기</button>
            </div>
            {driverId ? <SupportCenter actorId={driverId} actorRole="driver" onNotice={onNotice} openLostId={lostFocus} /> : null}
          </section>
        </div>
      ) : null}
    </main>
  )
}

export default function HomeScreen() {
  const { t } = useLocale()
  const user = LOCAL_TEST_USER
  // Load admin-configured fares/fees once — overrides policy defaults app-wide.
  useEffect(() => {
    void fetchFareConfig().then((cfg) => {
      setPolicyBaseOverrides({
        '택시': cfg.taxi.base,
        '대리운전': cfg.daeri.base,
        '택배': cfg.flatBase.delivery,
        '자전거': cfg.flatBase.bicycle,
        '킥보드': cfg.flatBase.kickboard,
        'EV 충전': cfg.flatBase.ev,
        '주차': cfg.flatBase.parking,
      })
    }).catch(() => undefined)
  }, [])
  const [driverMode, setDriverMode] = useState(false)
  const [driverOnline, setDriverOnline] = useState(true)
  const [driverLostOpen, setDriverLostOpen] = useState<string | null>(null)
  const [tab, setTab] = useState('홈')
  const [destination, setDestination] = useState('')
  const [destPlace, setDestPlace] = useState<RidePlace | null>(null)
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null)
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [daeriSetupOpen, setDaeriSetupOpen] = useState(false)
  const [daeriTrip, setDaeriTrip] = useState<DaeriTrip | null>(null)
  const [deliveryJob, setDeliveryJob] = useState<DeliveryJob | null>(null)
  const [routeAlert, setRouteAlert] = useState<RouteGap | null>(null)
  const [destSearchTick, setDestSearchTick] = useState(0)
  const [longDistCall, setLongDistCall] = useState<{ km: number; regionExit: boolean; destRegion: string } | null>(null)
  const [notice, setNotice] = useState('')
  const [walletBalance, setWalletBalance] = useState(18.4)
  const [walletOpen, setWalletOpen] = useState(false)
  const [pickupMapOpen, setPickupMapOpen] = useState(false)
  const [pickupMapKey, setPickupMapKey] = useState(0)
  const pickingMapRef = useRef(false)
  const [pickup, setPickup] = useState<PickupPlace | null>(null)
  const pickupRef = useRef<PickupPlace | null>(null)
  const locateSeqRef = useRef(0)
  const [gps, setGps] = useState<GpsFix>({
    status: 'pending',
    address: '현재 위치를 확인하는 중',
    lat: BUSAN_CITY_HALL.lat,
    lng: BUSAN_CITY_HALL.lng,
  })
  const [chargePromptOpen, setChargePromptOpen] = useState(false)
  const [walletReady, setWalletReady] = useState(false)
  const [headerModal, setHeaderModal] = useState<'activity' | 'account' | null>(null)
  const [partnerSignupOpen, setPartnerSignupOpen] = useState(false)
  const [partnerTrialOpen, setPartnerTrialOpen] = useState(false)
  const [driverGateOpen, setDriverGateOpen] = useState(false)
  const [isDriverRegistered, setIsDriverRegistered] = useState(false)
  const [isPartnerRegistered, setIsPartnerRegistered] = useState(false)
  const [isPiLinked, setIsPiLinked] = useState(false)
  const [receiptRide, setReceiptRide] = useState<RideReceipt | null>(null)
  const [inboxItem, setInboxItem] = useState<Notice | null>(null)
  const [readNoticeIds, setReadNoticeIds] = useState<string[]>([])
  const [paymentDone, setPaymentDone] = useState<{ amount: number; place: string; remaining: number; estimated?: number; paymentId: string; txid: string } | null>(null)
  // 결제·운행 멱등 키는 모듈 레벨 영속 세트(markSettledPayment/markSettledRide,
  // localStorage)로 관리한다 — useRef는 새로고침마다 비워져 완료 폴러가 과거
  // 운행을 다시 차감하는 중복 결제 버그가 있었다.
  const [driverReview, setDriverReview] = useState<{ name: string; vehicle: string; plate: string; kind?: 'driver' | 'service' } | null>(null)
  const [rideReview, setRideReview] = useState<RideReviewTarget | null>(null)
  const [supportDesk, setSupportDesk] = useState<LostPrefill | null | true>(null)
  const [transactions, setTransactions] = useState<PiTransaction[]>(DEFAULT_PI_TX)
  const [activities, setActivities] = useState<ActivityEntry[]>([])
  const [recentUse, setRecentUse] = useState<RecentUse | null>(null)
  // 경유지: 출발지와 목적지 사이에 들르는 장소(최대 2곳, 텍스트 주소).
  // 경로 데이터는 origin → waypoints[] → destination 순서로 관리한다.
  const [waypoints, setWaypoints] = useState<string[]>([])
  // 검색/지도에서 고른 경유지 좌표를 텍스트 키로 보관 — 호출 시 재지오코딩 없이 재사용한다.
  const waypointPlaces = useRef(new Map<string, RideCoords>())

  const showNotice = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }
  const recordActivity = (label: string, detail: string) => {
    const entry: ActivityEntry = { id: crypto.randomUUID(), at: formatPiTime(), ts: Date.now(), label, detail }
    setActivities((items) => {
      const next = [entry, ...items].slice(0, 40)
      saveActivities(next)
      return next
    })
    emitLedgerChange()
  }

  // 잔액·거래·이용 기록이 바뀔 때마다 브로드캐스트 — 열려 있는 다른 탭/패널이
  // 다음 폴링을 기다리지 않고 즉시 다시 읽을 수 있게 한다.
  const emitLedgerChange = () => {
    window.dispatchEvent(new Event('taxitago:ledger-changed'))
  }

  const applyPickup = (place: PickupPlace) => {
    pickupRef.current = place
    setPickup(place)
    writePickupPlace(place)
    writeRideSession({ origin: { lat: place.lat, lng: place.lng, address: place.address } })
  }

  const commitPickup = (place: { lat: number; lng: number; address: string }, source: PickupSource = 'map') => {
    const label = usableMapAddress(place.address) || place.address
    if (!label || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return
    applyPickup({ address: label, lat: place.lat, lng: place.lng, source })
    setGps({ status: 'ready', address: label, lat: place.lat, lng: place.lng })
  }

  const openPickupMap = () => {
    pickingMapRef.current = true
    setPickupMapKey((value) => value + 1)
    setPickupMapOpen(true)
  }

  const applyLocatedPoint = async (
    point: { lat: number; lng: number; address?: string },
    status: GpsFix['status'],
    source: PickupSource,
  ) => {
    const seq = (locateSeqRef.current += 1)
    if (pickingMapRef.current) return
    const readyLabel = usableMapAddress(point.address)
    const keepLabel = usableMapAddress(pickupRef.current?.address)
    const pendingAddress = readyLabel || keepLabel || '주소를 확인하는 중'
    setGps({ status: readyLabel ? status : 'pending', address: pendingAddress, lat: point.lat, lng: point.lng })
    applyPickup({ address: pendingAddress, lat: point.lat, lng: point.lng, source })
    if (readyLabel) return
    const nextAddress = await reverseGeocode(point.lat, point.lng)
    if (seq !== locateSeqRef.current || pickingMapRef.current) return
    const label = usableMapAddress(nextAddress)
    if (!label) return
    setGps({ status, address: label, lat: point.lat, lng: point.lng })
    applyPickup({ address: label, lat: point.lat, lng: point.lng, source })
  }

  const requestUserLocation = async (promptOnFail = false) => {
    const point = await requestBrowserPosition()
    if (point) {
      await applyLocatedPoint(point, 'ready', 'gps')
      return true
    }
    const kept = pickupRef.current
    if (kept && usableMapAddress(kept.address)) {
      setGps({ status: 'denied', address: kept.address, lat: kept.lat, lng: kept.lng })
      return false
    }
    const fallback = await resolveFlexibleFallback()
    await applyLocatedPoint(fallback, 'approx', 'gps')
    if (promptOnFail) {
      showNotice('정확한 GPS를 쓰지 못해 접속 지역으로 표시했어요. 위치를 눌러 직접 바꿀 수 있어요.')
    }
    return false
  }

  useEffect(() => {
    let cancelled = false
    const stored = readPiWallet()
    setWalletBalance(stored.balance)
    setTransactions(stored.transactions)
    setReadNoticeIds(loadReadNoticeIds())
    setIsDriverRegistered(loadIsDriverRegistered())
    setIsPartnerRegistered(loadIsPartnerRegistered())
    setIsPiLinked(loadIsPiLinked())
    setWalletReady(true)
    setActivities(loadActivities())
    setRecentUse(loadRecentUse())
    const storedPickup = readPickupPlace()
    if (storedPickup && Number.isFinite(storedPickup.lat) && Number.isFinite(storedPickup.lng) && usableMapAddress(storedPickup.address)) {
      pickupRef.current = storedPickup
      setPickup(storedPickup)
      setGps({ status: 'ready', address: storedPickup.address, lat: storedPickup.lat, lng: storedPickup.lng })
    }
    void (async () => {
      await requestUserLocation(true)
      if (cancelled) return
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!walletReady) return
    writePiWallet(walletBalance, transactions)
  }, [walletReady, walletBalance, transactions])

  useEffect(() => {
    setDeliveryJob(loadDeliveryJob())
  }, [])

  const origin: PickupPlace = pickup ?? {
    address: gps.address,
    lat: gps.lat,
    lng: gps.lng,
    source: 'gps',
  }

  useEffect(() => {
    pickingMapRef.current = pickupMapOpen
  }, [pickupMapOpen])

  useEffect(() => {
    writeRideSession({
      origin: { lat: origin.lat, lng: origin.lng, address: origin.address },
      ...(destPlace ? { dest: destPlace } : {}),
    })
  }, [origin.lat, origin.lng, origin.address, destPlace])
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
    rideId?: string,
  ) => {
    if (!proof.paymentId || !proof.txid) {
      console.error('[Pi] blocked local receipt without Pi payment proof')
      showNotice('파이 지갑 승인이 완료되어야 영수증으로 넘어갑니다.')
      return
    }
    if (isSettledPayment(proof.paymentId) || isSettledPayment(proof.txid)) return
    markSettledPayment(proof.paymentId)
    markSettledPayment(proof.txid)
    if (rideId) markSettledRide(rideId)
    const remaining = Math.round((walletBalance - amount) * 100) / 100
    const at = formatPiTime()
    const ts = Date.now()
    setWalletBalance(Math.max(0, remaining))
    setTransactions((items) => [{ label, amount: -amount, detail: `${place} · ${at}`, place, at, ts, estimated, txid: proof.txid }, ...items])
    recordActivity(label.includes('취소') ? '취소 수수료 결제' : '결제 완료', `${label} · ${amount.toFixed(7)} Pi · ${place}`)
    setPaymentDone({ amount, place, remaining: Math.max(0, remaining), estimated, paymentId: proof.paymentId, txid: proof.txid })
    emitLedgerChange()
    if (!label.includes('취소')) {
      const from = origin.address.trim() || '현재 위치'
      const tripDest = (destPlace?.address || destPlace?.label || destination).trim()
      let route = place.trim()
      if (label.includes('택배') && tripDest) route = `${from} → ${tripDest}`
      else if (!route.includes('→')) route = `${from} → ${route || tripDest || label}`
      const next: RecentUse = {
        route,
        fare: amount,
        service: label.replace(/\s*(이용|결제)$/, '').trim() || label,
        at,
        paymentId: proof.paymentId,
        txid: proof.txid,
      }
      saveRecentUse(next)
      setRecentUse(next)
    }
  }
  // 기사가 먼저 정산했거나 앱을 다시 연 뒤 완료가 확인된 운행도 홈 '최근 이용'과
  // 활동 기록/지갑 내역에 동기화한다. 수동 결제 경로와 rideId 중복 방지를 공유한다.
  const noteCompletedRide = (rideId: string, receipt: SettlementReceipt, label: string) => {
    const key = rideId || receipt.rideId || receipt.payoutTxid || receipt.lockTxid
    if ((key && isSettledRide(key)) || isSettledRide(receipt.rideId)) return
    if (isSettledPayment(receipt.payoutTxid) || isSettledPayment(receipt.lockTxid)) return
    if (key) markSettledRide(key)
    if (receipt.rideId) markSettledRide(receipt.rideId)
    markSettledPayment(receipt.payoutTxid)
    markSettledPayment(receipt.lockTxid)
    const amount = receipt.amount
    if (!(amount > 0)) return
    const at = formatPiTime()
    const ts = Date.now()
    const place = receipt.route
    setWalletBalance((balance) => Math.max(0, Math.round((balance - amount) * 100) / 100))
    setTransactions((items) => [{ label, amount: -amount, detail: `${place} · ${at}`, place, at, ts, estimated: receipt.estimatedFare, txid: receipt.payoutTxid || receipt.lockTxid }, ...items])
    recordActivity('운행 완료', `${place} · ${amount.toFixed(7)} Pi · 정산 완료`)
    const next: RecentUse = {
      route: place,
      fare: amount,
      service: label.replace(/\s*(이용|결제)$/, '').trim() || label,
      at,
      paymentId: receipt.lockTxid || key || `pay-${ts}`,
      txid: receipt.payoutTxid || receipt.lockTxid || `done-${ts}`,
    }
    saveRecentUse(next)
    setRecentUse(next)
    emitLedgerChange()
  }
  // 앱 첫 진입부터 오디오 잠금 해제 리스너를 걸어, 이후 어떤 알림음도
  // 자동재생 정책에 막혀 누락되지 않게 한다.
  useEffect(() => {
    primeCommsAlertAudio()
    primeDriverAlertAudio()
  }, [])
  useEffect(() => {
    const stored = readStoredTaxi()
    if (!stored) return
    taxiSheetRideId = stored.rideId
    setActiveTrip(stored.trip)
    setSelectedService('택시')
  }, [])
  const rememberTaxi = () => {
    if (!activeTrip || !taxiSheetRideId) return
    writeStoredTaxi({ rideId: taxiSheetRideId, trip: activeTrip })
  }
  const endTaxi = () => {
    taxiSheetRideId = ''
    writeStoredTaxi(null)
    setActiveTrip(null)
    setSelectedService(null)
    setTab('홈')
  }
  const resetToHomeAfterReceipt = () => {
    taxiSheetRideId = ''
    writeStoredTaxi(null)
    daeriSheetRideId = ''
    setPaymentDone(null)
    setReceiptRide(null)
    setActiveTrip(null)
    setSelectedService(null)
    setDaeriTrip(null)
    setDaeriSetupOpen(false)
    setDestination('')
    setDestPlace(null)
    writeRideSession({ dest: null })
    setTab('홈')
  }
  const payWithPi = async (amount: number, place: string, label: string, estimated?: number) => {
    try {
      // 앱 잔액 즉시 차감 — Pi SDK는 충전/출금 전용이다.
      const proof = await payFromBalance({ purpose: 'service', amount, label, place })
      settlePiLedger(amount, place, label, estimated, proof)
      return true
    } catch (error) {
      showNotice(error instanceof Error ? error.message : describePiUserMessage(error))
      return false
    }
  }
  const depositWallet = (amount: number, ts?: number) => {
    const at = formatPiTime()
    setWalletBalance((balance) => Math.round((balance + amount) * 100) / 100)
    // ts가 없으면 이용자가 직접 누른 충전 — 지금 시각. 스캐너 감지분은 서버의
    // 실제 입금 시각을 받아 일일 한도 계산에서 제대로 날짜가 찍히게 한다.
    const chargedAt = typeof ts === 'number' && Number.isFinite(ts) ? ts : Date.now()
    setTransactions((items) => [{ label: 'Pi 충전', amount, detail: `Pi 월렛 · ${at}`, place: 'Pi 월렛', at, ts: chargedAt }, ...items])
    recordActivity('Pi 충전 완료', `+${amount.toFixed(7)} Pi`)
    emitLedgerChange()
  }
  const withdrawWallet = async (amount: number, dest: string): Promise<{ txid: string }> => {
    const identity = loadPiIdentity()
    const uid = identity?.uid?.trim() || ''
    if (!uid) throw new Error('Pi 계정 연동 후 출금할 수 있습니다.')
    // 서버가 실제 A2U 송금을 수행하고 txid를 돌려준다 — 성공이 확인되기 전엔
    // 로컬 장부도 건드리지 않는다.
    const res = await fetch('/api/wallet/withdraw/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(identity?.accessToken ? { 'x-pi-access-token': identity.accessToken } : {}),
      },
      body: JSON.stringify({
        uid,
        wallet: identity?.wallet || '',
        address: isPiWalletAddress(dest) ? dest : undefined,
        amount,
        requestId: crypto.randomUUID(),
        accessToken: identity?.accessToken || undefined,
        sandbox: PI_SANDBOX,
      }),
    })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; txid?: string; error?: string } | null
    if (!res.ok || !data?.ok) throw new Error(data?.error || '출금 전송에 실패했어요.')
    const txid = data.txid || ''
    const shortTx = txid ? `tx ${txid.slice(0, 8)}…` : 'tx 확인 중'
    const at = formatPiTime()
    setWalletBalance((balance) => Math.max(0, Math.round((balance - amount) * 100) / 100))
    setTransactions((items) => [{ label: 'Pi 출금', amount: -amount, detail: `${(dest || 'Pi 월렛').slice(0, 10)}… · ${shortTx} · ${at}`, place: dest || 'Pi 월렛', at, ts: Date.now(), txid }, ...items])
    recordActivity('Pi 출금', `-${amount.toFixed(7)} Pi · ${shortTx}`)
    emitLedgerChange()
    return { txid }
  }
  const rewardReview = (key?: string) => {
    const amount = 0.1
    const at = formatPiTime()
    setWalletBalance((balance) => Math.round((balance + amount) * 100) / 100)
    setTransactions((items) => [{ label: '리뷰 적립', amount, detail: `기사 평가 · ${at}`, place: '리뷰 감사 포인트', at, ts: Date.now() }, ...items])
    void recordReviewReward(localPassengerId(), key)
    showNotice('평가 감사합니다. 0.1 Pi가 적립되었습니다.')
  }
  // Pi App Studio "Verified" 검증 — Pi Browser에서 앱이 열리면 사용자 클릭
  // 없이 authenticate를 자동 실행하고 토큰을 App Studio 로그인으로 즉시 전달.
  useEffect(() => {
    void autoVerifyPiAppStudio()
  }, [])
  // 앱이 열려 있는 동안에는 지갑 모달을 열지 않아도 온체인 입금이 감지되면
  // 즉시 잔액에 반영한다(수동 동기화로 기록된 입금 포함, txid 멱등).
  useEffect(() => {
    const identity = loadPiIdentity()
    const wallet = identity?.wallet?.trim() || ''
    const uid = identity?.uid?.trim() || ''
    // uid만 있어도 폴러가 돌아야 한다 — 서버가 uid 귀속으로 입금을 찾아준다.
    if (!uid && !isPiWalletAddress(wallet)) return
    let stopped = false
    const scan = () =>
      scanPiDeposits(
        isPiWalletAddress(wallet) ? wallet : '',
        uid,
        (amount, _txid, ts) => {
          if (stopped) return
          depositWallet(amount, ts)
          showNotice(`${amount.toFixed(2)} Pi 입금 확인 — 지갑에 자동 충전되었습니다.`)
        },
        (spendable) => {
          if (stopped) return
          // 서버 장부(권위)와 다른 로컬 잔액은 교정한다 — 새로고침 중복 차감 등으로
          // 깨진 값을 자가치유. 입금 직후 onCredit 반영분도 서버 spendable에 포함된다.
          setWalletBalance((balance) => {
            if (Math.abs(balance - spendable) < 0.000001) return balance
            console.log('[Wallet] balance reconciled to server ledger', { local: balance, spendable })
            return Math.round(spendable * 100) / 100
          })
        },
      )
    void scan()
    const timer = window.setInterval(scan, 10_000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
    // depositWallet/showNotice는 매 렌더 새로 만들어지지만 스캔 루프는 마운트 시 한 번이면 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 서버/기사 측에서 먼저 정산된 내 운행을 주기적으로 동기화한다 — 결제 시트를
  // 닫았거나 폴러를 놓친 경우에도 잔액 차감·활동·최근 이용·영수증이 늦지 않게
  // 반영된다. 영속 멱등 세트(isSettledRide/isSettledPayment)가 직접 결제 경로와의
  // 중복 차감을 막고, 새로고침 후에도 과거 완료 건이 재차감되지 않는다.
  useEffect(() => {
    const passengerId = localPassengerId()
    let stopped = false
    const sync = () => {
      void fetchRideHistory(passengerId, 'passenger')
        .then((rides) => {
          if (stopped) return
          for (const ride of rides) {
            // 최근 24시간 안에 갱신된 완료 건만 확인 — 오래된 내역은 재조회하지 않는다.
            if (ride.status !== 'completed' || isSettledRide(ride.id)) continue
            if (Date.now() - Date.parse(ride.updatedAt || '') > 24 * 60 * 60 * 1000) continue
            void fetchRideReceipt(ride.id)
              .then((receipt) => {
                if (stopped || !receipt) return
                noteCompletedRide(ride.id, receipt, ride.kind === 'daeri' ? '대리운전 결제' : '택시 결제')
              })
              .catch(() => undefined)
          }
        })
        .catch(() => undefined)
    }
    sync()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') sync()
    }, 8000)
    const wake = () => sync()
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      stopped = true
      window.clearInterval(timer)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
    // noteCompletedRide는 매 렌더 새로 만들어지지만 폴러는 마운트 시 한 번이면 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const openService = (value: string) => {
    if (value === '더보기') {
      setMoreOpen(true)
      setTab('홈')
      return
    }
    setMoreOpen(false)
    if (value === '대리운전') {
      if (!requirePiForCall()) return
      const gap = routeGap(origin.address, destination)
      if (gap) {
        setRouteAlert(gap)
        setTab('홈')
        return
      }
      setDaeriSetupOpen(true)
      setTab('홈')
      return
    }
    if (value === '택시') {
      void startTaxiCall()
      return
    }
    setSelectedService(value)
  }
  const applyDestinationPlace = (value: string, coords?: RideCoords) => {
    setDestination(value)
    if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
      const dest = { label: value, address: coords.address || value, lat: coords.lat, lng: coords.lng }
      setDestPlace(dest)
      writeRideSession({ dest })
      return
    }
    if (!value.trim() || value === '집' || value === '회사') {
      setDestPlace(null)
      return
    }
    void resolveRidePlace(value).then((place) => {
      if (!place) return
      setDestPlace(place)
      writeRideSession({ dest: place })
    })
  }
  /**
   * 호출 진입 인증 게이트 — Pi 토큰이 실린 연동 세션이 없으면 호출을 차단하고
   * 계정 연동 모달로 보낸다. 서버도 동일 자격을 /v2/me로 재검증한다.
   */
  const requirePiForCall = () => {
    if (hasPiCallCredential(loadPiIdentity())) return true
    showNotice('Pi 계정 연동 및 로그인 후 이용해 주세요.')
    setHeaderModal('account')
    return false
  }
  const startTaxiCall = async (skipLongCheck = false) => {
    if (!requirePiForCall()) return
    const gap = routeGap(origin.address, destination)
    if (gap) {
      setRouteAlert(gap)
      setTab('홈')
      return
    }
    const label = destination.trim()
    let place = destPlace && (destPlace.label === label || destPlace.address === label) ? destPlace : null
    if (!place) {
      place = await resolveRidePlace(label, origin.address)
      if (place) setDestPlace(place)
    }
    if (!place) {
      showNotice('목적지 위치를 확인하지 못했어요. 추천 장소나 주소를 다시 선택해 주세요.')
      return
    }
    // 장거리 콜(직선 25km+ 또는 타 시/도 권역)이면 이용자 확인을 먼저 받는다.
    if (!skipLongCheck) {
      const flag = longDistanceCheck(
        { lat: origin.lat, lng: origin.lng, address: origin.address },
        { lat: place.lat, lng: place.lng, address: place.address || place.label },
      )
      if (flag.far) {
        setLongDistCall(flag)
        return
      }
    }
    // 경유지 입력 텍스트를 좌표로 변환한다. 좌표를 찾지 못한 경유지는 제외하고,
    // 실제 거리·요금 보정은 서버에서 origin→waypoints→dest 구간 합산으로 처리한다.
    const waypointTexts = waypoints.map((item) => item.trim()).filter(Boolean).slice(0, MAX_WAYPOINTS)
    const waypointPoints = (
      await Promise.all(
        waypointTexts.map(
          async (text) =>
            waypointPlaces.current.get(text) ?? coordsFromPlaceQuery(text) ?? (await resolveRidePlace(text, origin.address)),
        ),
      )
    ).filter((wp): wp is NonNullable<typeof wp> => wp !== null)
    writeRideSession({
      origin: { lat: origin.lat, lng: origin.lng, address: origin.address },
      dest: { lat: place.lat, lng: place.lng, address: place.address, label: place.label },
    })
    // The server is the single source of truth — reattach to any live ride for this passenger.
    const serverActive = await fetchActiveRide(localPassengerId(), 'passenger')
    if (serverActive) {
      taxiSheetRideId = serverActive.id
      const trip: ActiveTrip = {
        originLat: serverActive.pickup.lat,
        originLng: serverActive.pickup.lng,
        originAddress: serverActive.pickup.address || serverActive.pickup.label || origin.address,
        waypoints: serverActive.waypoints ?? [],
        destLat: serverActive.dest.lat,
        destLng: serverActive.dest.lng,
        destAddress: serverActive.dest.address || '',
        destLabel: serverActive.dest.label || serverActive.dest.address || label,
      }
      setActiveTrip(trip)
      writeStoredTaxi({ rideId: serverActive.id, trip })
      setSelectedService('택시')
      setTab('홈')
      showNotice('진행 중인 택시 호출로 돌아갑니다.')
      return
    }
    taxiSheetRideId = ''
    writeStoredTaxi(null)
    setPaymentDone(null)
    setReceiptRide(null)
    setRideReview(null)
    setDestPlace(place)
    setActiveTrip({
      originLat: origin.lat,
      originLng: origin.lng,
      originAddress: origin.address,
      waypoints: waypointPoints,
      destLat: place.lat,
      destLng: place.lng,
      destAddress: place.address,
      destLabel: place.label,
    })
    setSelectedService('택시')
    recordActivity('택시 호출', `${origin.address} → ${[...waypointTexts, place.label].join(' → ')}`)
  }
  const selectDestination = (value: string, coords?: RideCoords) => {
    applyDestinationPlace(value, coords)
    if (value) showNotice(`${value} 목적지를 선택했어요.`)
  }
  const enterDriverMode = () => {
    setDriverMode(true)
    setTab('기사/파트너')
    showNotice('기사 모드로 전환했어요.')
  }
  useEffect(() => {
    const openFromAlert = () => {
      const driver = loadIsDriverRegistered()
      const partner = loadIsPartnerRegistered()
      if (!driver && !partner) return
      if (driver) setIsDriverRegistered(true)
      if (partner) setIsPartnerRegistered(true)
      setDriverMode(true)
      setDriverOnline(true)
      setTab('기사/파트너')
    }
    if (new URLSearchParams(window.location.search).get('driver') === '1') openFromAlert()
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'driver-offer') openFromAlert()
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [])
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
  const completeDriverRegistration = (role: '기사' | '파트너' = '기사', session?: PiSession) => {
    if (session) {
      savePiIdentity(session)
      setIsPiLinked(true)
      saveIsPiLinked(true)
    }
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
    if (role !== '파트너') {
      setTab('기사/파트너')
      setDriverMode(true)
    }
  }
  const logoutMember = async (): Promise<boolean> => {
    const uid = loadPartnerProfile()?.uid || loadPiIdentity()?.uid
    try {
      await requestAccountWithdrawal(uid)
    } catch (error) {
      // 잔액 잔존 등 서버가 돌려준 차단 사유를 이용자에게 보인다 —
      // 탈퇴는 진행되지 않는다. false를 돌려 모달이 열린 채 남아 재시도할
      // 수 있게 한다(삼키면 호출부가 성공으로 간주해 모달을 닫아버린다).
      showNotice(error instanceof Error ? error.message : '회원 탈퇴에 실패했어요.')
      return false
    }
    setIsPiLinked(false)
    saveIsPiLinked(false)
    setIsDriverRegistered(false)
    saveIsDriverRegistered(false)
    setIsPartnerRegistered(false)
    saveIsPartnerRegistered(false)
    setDriverMode(false)
    setDriverOnline(false)
    setHeaderModal(null)
    setTab('홈')
    showNotice('회원 탈퇴가 완료되어 로그아웃되었습니다')
    // 메모리에 남은 사용자 상태(지갑 잔액·내역·입금 멱등 캐시)까지 비우기 위해
    // 완전히 새로고침한다 — 재가입이 깨끗한 신규 상태로 시작된다.
    window.setTimeout(() => window.location.reload(), 800)
    return true
  }

  return (
    <main className="h-dvh overflow-hidden bg-[#E2E8F0] text-[#0F172A]">
      <div className="mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-[#F8FAFC] shadow-2xl">
        <header className="relative z-20 shrink-0 border-b border-[#E2E8F0] bg-white px-4 pb-2 pt-[max(0.9rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold tracking-wide text-[#4A82B8]">TAXI TAGO</p>
              <h1 className="truncate text-[22px] font-black leading-tight text-[#0F172A]">{tab === '기사/파트너' ? t('brand.partner') : t('brand.name')}</h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button onClick={openWallet} className="rounded-full bg-[#E8F1FA] px-2.5 py-1.5 text-[11px] font-black text-[#4A82B8]">
                {piCompact(walletBalance)} Pi
              </button>
              <button onClick={() => setHeaderModal('activity')} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#4A82B8] text-white" aria-label={t('home.activity')}>
                <Bell className="h-4 w-4" />
              </button>
              <button onClick={() => setHeaderModal('account')} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#4A82B8] text-white" aria-label={t('home.piAccount')}>
                <UserRound className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>
        {driverOnline && (isDriverRegistered || isPartnerRegistered) && tab !== '기사/파트너' ? (
          <DriverOfferWatcher
            lat={origin.lat}
            lng={origin.lng}
            onOpenDesk={() => {
              setDriverMode(true)
              setTab('기사/파트너')
            }}
            onNotice={showNotice}
            onActivity={recordActivity}
          />
        ) : null}
        {(isDriverRegistered || isPartnerRegistered) && tab !== '기사/파트너' ? (
          <DriverLostWatcher
            driverId={localDriverId(loadPartnerProfile()?.uid)}
            onOpen={(id) => {
              setDriverLostOpen(id)
              setDriverMode(true)
              setTab('기사/파트너')
            }}
          />
        ) : null}
        {tab === '기사/파트너' ? (
          isDriverRegistered || isPartnerRegistered ? (
            <DriverDashboard online={driverOnline} lat={origin.lat} lng={origin.lng} onToggleOnline={() => setDriverOnline((value) => !value)} onPassengerMode={leaveDriverMode} onWithdraw={logoutMember} onNotice={showNotice} onAskPassengerReview={setRideReview} onActivity={recordActivity} deliveryJob={deliveryJob} openLostId={driverLostOpen} onLostOpened={() => setDriverLostOpen(null)} />
          ) : (
            <PartnerHub onSignup={() => setPartnerSignupOpen(true)} onStartTrial={() => setPartnerTrialOpen(true)} />
          )
        ) : (
          <Home
            destination={destination}
            pickup={origin.address}
            pickupLat={origin.lat}
            pickupLng={origin.lng}
            gpsStatus={gps.status}
            pickupFromMap={pickup?.source === 'map'}
            waypoints={waypoints}
            onWaypointsChange={setWaypoints}
            onWaypointPicked={(text, coords) => waypointPlaces.current.set(text, coords)}
            onDestination={selectDestination}
            onService={openService}
            onReceipt={setReceiptRide}
            onOpenMap={openPickupMap}
            destSearchTick={destSearchTick}
            recentUse={recentUse}
            onQrPaid={(record, proof) =>
              settlePiLedger(record.amount, record.memo || `${record.driverName || '기사'} 현장 결제`, '현장 QR 결제', undefined, proof)
            }
          />
        )}
        {tab !== '홈' && tab !== '기사/파트너' && (
          <div className="fixed inset-x-0 top-0 z-30 flex items-end bg-[#241d35]/35" style={{ bottom: 'calc(4.75rem + env(safe-area-inset-bottom, 0px))' }} onClick={() => setTab('홈')}>
            <div className="mx-auto flex h-[min(92dvh,100%)] w-full max-w-md flex-col overflow-hidden rounded-t-[30px] bg-[#f7f7fb] pt-3" onClick={(event) => event.stopPropagation()}>
              <div className="mx-auto mb-3 h-1.5 w-12 shrink-0 rounded-full bg-[#d8d2e0]" />
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <TabContent tab={tab} destination={destination} onDestination={selectDestination} onService={(value) => { openService(value); setTab('홈') }} onNotice={showNotice} balance={walletBalance} onWallet={openWallet} onReceipt={setReceiptRide} readNoticeIds={readNoticeIds} onOpenInbox={openInbox} username={user.username} driverMode={driverMode} isDriverRegistered={isDriverRegistered} isPartnerRegistered={isPartnerRegistered} piLinked={isPiLinked} onToggleDriverMode={toggleDriverMode} onOpenDriverSignup={() => setPartnerSignupOpen(true)} onOpenPartnerSignup={() => setPartnerSignupOpen(true)} inboxIdentities={[{ id: localPassengerId(), role: 'passenger' }, ...(isDriverRegistered || isPartnerRegistered ? [{ id: localDriverId(loadPartnerProfile()?.uid), role: 'driver' as const }] : [])]} activities={activities} transactions={transactions} />
              </div>
            </div>
          </div>
        )}
        <nav className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-md -translate-x-1/2 justify-around border-t-2 border-[#CBD5E1] bg-white px-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_24px_rgba(15,23,42,0.12)]">
          {navItems.map(({ id, labelKey, icon: Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                type="button"
                aria-label={t(labelKey)}
                onClick={() => {
                  if (id === '기사/파트너') {
                    setTab('기사/파트너')
                    if (isDriverRegistered || isPartnerRegistered) setDriverMode(true)
                    return
                  }
                  if (id === '홈') setDriverMode(false)
                  setTab(id)
                }}
                className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl py-1.5 ${active ? (id === '기사/파트너' ? 'text-[#4A82B8]' : 'text-[#4C1FB8]') : 'text-[#64748B]'}`}
              >
                <span className={`relative flex h-9 w-9 items-center justify-center rounded-2xl ${active ? (id === '기사/파트너' ? 'bg-[#4A82B8] text-white shadow-[0_6px_14px_rgba(74,130,184,0.35)]' : 'bg-[#4C1FB8] text-white shadow-[0_6px_14px_rgba(76,31,184,0.35)]') : 'bg-transparent'}`}>
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
                  {id === '이용/알림' && unreadNoticeCount > 0 ? (
                    <span className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-black ${active ? 'bg-white text-[#4C1FB8]' : 'bg-[#4C1FB8] text-white'}`}>
                      {unreadNoticeCount > 9 ? '9+' : unreadNoticeCount}
                    </span>
                  ) : null}
                </span>
                <span className="max-w-full px-0.5 text-center text-[10px] font-black leading-tight tracking-tight">{t(labelKey)}</span>
              </button>
            )
          })}
        </nav>
        {pickupMapOpen ? (
          <PlacePickerScreen
            key={`pickup-map-${pickupMapKey}`}
            variant="pickup"
            lat={origin.lat}
            lng={origin.lng}
            address={origin.address}
            onClose={() => {
              pickingMapRef.current = false
              setPickupMapOpen(false)
            }}
            onConfirm={(place) => {
              commitPickup(place, 'map')
              pickingMapRef.current = false
              setPickupMapOpen(false)
              showNotice('출발지를 지정했어요')
            }}
          />
        ) : null}
        {receiptRide && (
          <ReceiptModal
            ride={receiptRide}
            onClose={() => setReceiptRide(null)}
            onNotice={showNotice}
            onLostItem={(prefill) => setSupportDesk(prefill)}
          />
        )}
        {inboxItem && <InboxDetailModal item={inboxItem} onClose={() => setInboxItem(null)} />}
        {headerModal && (
          <HeaderModal
            kind={headerModal}
            username={user.username}
            piLinked={isPiLinked}
            onClose={() => setHeaderModal(null)}
            onLinkPi={async () => {
              try {
                const session = await signInWithPi()
                savePiIdentity(session)
                setIsPiLinked(true)
                saveIsPiLinked(true)
                showNotice(`파이 로그인 완료 · UID ${session.uid.slice(0, 8)}…`)
              } catch (error) {
                showNotice(describePiUserMessage(error))
              }
            }}
            activities={activities}
            onUnlinkPi={logoutMember}
          />
        )}
        {partnerSignupOpen && (
          <PartnerSignupModal
            onClose={() => setPartnerSignupOpen(false)}
            onRegistered={completeDriverRegistration}
            onPiLinked={(session) => {
              savePiIdentity(session)
              setIsPiLinked(true)
              saveIsPiLinked(true)
            }}
            onDone={showNotice}
          />
        )}
        {partnerTrialOpen ? <PartnerTrialDemo onClose={() => setPartnerTrialOpen(false)} onNotice={showNotice} /> : null}
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
            originLat={origin.lat}
            originLng={origin.lng}
            originAddress={origin.address}
            initialWaypoints={waypoints}
            destLat={destPlace?.lat}
            destLng={destPlace?.lng}
            onClose={() => setDaeriSetupOpen(false)}
            onCall={(trip) => {
              writeRideSession({
                origin: { lat: trip.pickupLat, lng: trip.pickupLng, address: trip.pickup },
                dest: { lat: trip.destLat, lng: trip.destLng, address: trip.dest, label: trip.dest },
              })
              setDaeriTrip(trip)
              setDaeriSetupOpen(false)
              setSelectedService('대리운전')
            }}
            onRequireRoute={setRouteAlert}
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
        {activeTrip && selectedService !== '택시' && tab === '홈' ? (
          <button type="button" onClick={() => setSelectedService('택시')} className="fixed bottom-24 left-1/2 z-40 w-[min(100%-2rem,24rem)] -translate-x-1/2 rounded-2xl bg-[#0F172A] px-4 py-3 text-left text-white shadow-lg">
            <p className="text-[11px] font-bold text-[#93C5FD]">진행 중인 택시</p>
            <p className="mt-1 text-sm font-black">{activeTrip.originAddress} → {activeTrip.destLabel}</p>
          </button>
        ) : null}
        {selectedService === '택시' && activeTrip ? (
          <div className={tab === '기사/파트너' ? 'hidden' : undefined}>
            <TaxiMatchingSheet
            destination={activeTrip.destLabel}
            pickupLat={activeTrip.originLat}
            pickupLng={activeTrip.originLng}
            waypoints={activeTrip.waypoints}
            destLat={activeTrip.destLat}
            destLng={activeTrip.destLng}
            destAddress={activeTrip.destAddress}
            pickupAddress={activeTrip.originAddress}
            onKeep={rememberTaxi}
            onEnd={endTaxi}
            onClose={() => {
              if (!taxiSheetRideId) {
                writeStoredTaxi(null)
                setActiveTrip(null)
              }
              setSelectedService(null)
              setTab('홈')
            }}
            onNotice={showNotice}
            balance={walletBalance}
            onPay={payWithPi}
            onSettle={settlePiLedger}
            onNeedCharge={showChargePrompt}
            onAskReview={setRideReview}
            onReceipt={setReceiptRide}
            onActivity={recordActivity}
            onRideSettled={(id, receipt) => noteCompletedRide(id, receipt, '택시 결제')}
          />
          </div>
        ) : null}
        {selectedService && selectedService !== '택시' && selectedService !== '더보기' && (
          <ServiceSheet
            service={selectedService}
            pickupLat={origin.lat}
            pickupLng={origin.lng}
            pickupAddress={origin.address}
            destLat={destPlace?.lat}
            destLng={destPlace?.lng}
            destAddress={destPlace?.address || destination}
            onClose={() => {
              setSelectedService(null)
              setDaeriTrip(null)
              setTab('홈')
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
            onRequireRoute={setRouteAlert}
            onDeliveryCreated={setDeliveryJob}
            onActivity={recordActivity}
            onRideSettled={(id, receipt) => noteCompletedRide(id, receipt, `${selectedService} 이용`)}
          />
        )}
        {supportDesk ? (
          <div className="fixed inset-0 z-[96] flex items-end bg-[#241d35]/45" onClick={() => setSupportDesk(null)}>
            <section className="mx-auto max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-white px-5 py-5" onClick={(event) => event.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xl font-black">분실물 · 고객센터</h2>
                <button type="button" onClick={() => setSupportDesk(null)} className="text-sm font-black text-[#64748B]">닫기</button>
              </div>
              <SupportCenter
                actorId={localPassengerId()}
                actorRole="passenger"
                onNotice={showNotice}
                prefillLost={supportDesk === true ? null : supportDesk}
              />
            </section>
          </div>
        ) : null}
        {rideReview ? (
          <RideReviewModal
            target={rideReview}
            onClose={() => setRideReview(null)}
            onSubmitted={() => {
              if (rideReview.raterRole === 'passenger') rewardReview(rideReview.rideId)
              setRideReview(null)
            }}
          />
        ) : paymentDone?.txid ? (
          <PaymentDoneModal
            amount={paymentDone.amount}
            place={paymentDone.place}
            remaining={paymentDone.remaining}
            estimated={paymentDone.estimated}
            onClose={resetToHomeAfterReceipt}
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
        {routeAlert ? (
          <RouteRequiredModal
            onConfirm={() => {
              const kind = routeAlert
              setRouteAlert(null)
              setSelectedService(null)
              setDaeriSetupOpen(false)
              setTab('홈')
              if (kind === 'pickup' || kind === 'both') openPickupMap()
              else setDestSearchTick((value) => value + 1)
            }}
          />
        ) : null}
        {longDistCall ? (
          <LongDistanceConfirmModal
            km={longDistCall.km}
            regionExit={longDistCall.regionExit}
            destRegion={longDistCall.destRegion}
            onEdit={() => {
              setLongDistCall(null)
              setDestSearchTick((value) => value + 1)
            }}
            onConfirm={() => {
              setLongDistCall(null)
              void startTaxiCall(true)
            }}
          />
        ) : null}
        {notice && <div className="fixed bottom-20 left-1/2 z-[100] -translate-x-1/2 rounded-full bg-[#241d35] px-4 py-3 text-xs font-black text-white">{notice}</div>}
      </div>
    </main>
  )
}
