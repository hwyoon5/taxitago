import { apiFetch, localEventSourceUrl } from '@/lib/app-origin'
import { isUsableCoord } from '@/lib/ride-session'
import type { PublicRide } from '@/lib/dispatch-types'
import type { DriverEarningsStats, SettlementReceipt } from '@/lib/escrow-types'

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

export async function createRideRequest(input: {
  passengerId: string
  kind?: 'taxi' | 'daeri'
  pickupLat: number
  pickupLng: number
  pickupAddress?: string
  destLat: number
  destLng: number
  destAddress?: string
  destLabel?: string
  estimatedFare?: number
}): Promise<PublicRide> {
  const res = await apiFetch('/api/rides', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await readJson<{ ride?: PublicRide; error?: string }>(res)
  if (!res.ok || !data.ride) throw new Error(data.error || '호출 요청을 만들지 못했어요.')
  return data.ride
}

export async function fetchRideRequest(rideId: string): Promise<PublicRide | null> {
  const id = rideId.trim()
  if (!id) return null
  try {
    const res = await fetch(`/api/rides/${encodeURIComponent(id)}`, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (res.status === 404 || res.status === 401 || res.status === 403) return null
    if (!res.ok) return null
    const data = (await res.json()) as { ride?: PublicRide }
    return data.ride ?? null
  } catch {
    return null
  }
}

/** Canonical restore path: the one active ride for this actor, from the server. */
export async function fetchActiveRide(actorId: string, role: 'passenger' | 'driver'): Promise<PublicRide | null> {
  const id = actorId.trim()
  if (!id) return null
  try {
    const res = await fetch(`/api/rides/active?actorId=${encodeURIComponent(id)}&role=${role}`, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { ride?: PublicRide | null }
    return data.ride ?? null
  } catch {
    return null
  }
}

export type DriverDispatchSnapshot = {
  ride: PublicRide | null
  offer: { pickupDistanceKm: number; expiresAt: string } | null
  active: PublicRide | null
  earnings?: DriverEarningsStats | null
}

export function subscribeDriverLive(driverId: string, onDispatch: (snapshot: DriverDispatchSnapshot) => void) {
  const id = driverId.trim()
  if (!id || typeof window === 'undefined') return () => undefined
  let source: EventSource | null = null
  let closed = false
  let retryMs = 1000
  let retryTimer = 0
  const connect = () => {
    if (closed) return
    source?.close()
    source = new EventSource(localEventSourceUrl('api/drivers/live', new URLSearchParams({ driverId: id })))
    source.addEventListener('dispatch', (event) => {
      retryMs = 1000
      try {
        onDispatch(JSON.parse((event as MessageEvent).data) as DriverDispatchSnapshot)
      } catch {
        undefined
      }
    })
    source.onerror = () => {
      source?.close()
      source = null
      if (closed) return
      window.clearTimeout(retryTimer)
      retryTimer = window.setTimeout(connect, retryMs)
      retryMs = Math.min(retryMs * 2, 15000)
    }
  }
  const wake = () => {
    if (closed) return
    if (!source || source.readyState === EventSource.CLOSED) {
      retryMs = 1000
      connect()
    }
  }
  connect()
  window.addEventListener('online', wake)
  document.addEventListener('visibilitychange', wake)
  return () => {
    closed = true
    window.clearTimeout(retryTimer)
    source?.close()
    window.removeEventListener('online', wake)
    document.removeEventListener('visibilitychange', wake)
  }
}

export function subscribeRideLive(rideId: string, onRide: (ride: PublicRide) => void) {
  const source = new EventSource(localEventSourceUrl(`api/rides/${encodeURIComponent(rideId)}/live`))
  const apply = (raw: string) => {
    try {
      const data = JSON.parse(raw) as { ride?: PublicRide }
      if (data.ride) onRide(data.ride)
    } catch {
      undefined
    }
  }
  source.addEventListener('ride', (event) => apply((event as MessageEvent).data))
  source.onmessage = (event) => apply(event.data)
  return () => source.close()
}

export async function cancelRideRequest(rideId: string, passengerId: string, options?: { settleFee?: boolean }) {
  const res = await apiFetch(`/api/rides/${encodeURIComponent(rideId)}/cancel/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passengerId, settleFee: options?.settleFee === true }),
  })
  const data = await readJson<{ ride?: PublicRide | null; error?: string; missing?: boolean }>(res).catch(() => null)
  if (res.status === 404 || data?.missing) return null
  if (!res.ok || !data?.ride) throw new Error(data?.error || '이용 취소를 완료하지 못했어요.')
  return data.ride
}

export async function sendDriverPresence(input: {
  driverId: string
  lat: number
  lng: number
  online: boolean
  name?: string
  vehicle?: string
  plate?: string
  wallet?: string
  piUid?: string
}) {
  if (!isUsableCoord(input.lat, input.lng)) return
  await apiFetch('/api/drivers/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function updateDriverProfile(input: { driverId: string; name?: string; vehicle?: string; plate?: string }) {
  const driverId = input.driverId.trim()
  if (!driverId) return null
  try {
    const res = await apiFetch('/api/drivers/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const data = await readJson<{ driver?: unknown }>(res).catch(() => null)
    return res.ok ? (data?.driver ?? null) : null
  } catch {
    return null
  }
}

export type PushedDriverOffer = {
  rideId?: string
  expiresAt?: string
  pickupDistanceKm?: number
  ride?: {
    id?: string
    passengerId?: string
    kind?: string
    pickup?: { lat?: number; lng?: number; address?: string; label?: string }
    dest?: { lat?: number; lng?: number; address?: string; label?: string }
    estimatedFare?: number
  }
}

function pushedPoint(value: { lat?: number; lng?: number; address?: string; label?: string } | undefined) {
  const lat = Number(value?.lat)
  const lng = Number(value?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    lat,
    lng,
    address: typeof value?.address === 'string' ? value.address : undefined,
    label: typeof value?.label === 'string' ? value.label : undefined,
  }
}

export function rideFromPushedOffer(payload: PushedDriverOffer | null | undefined) {
  const pickup = pushedPoint(payload?.ride?.pickup)
  const dest = pushedPoint(payload?.ride?.dest)
  const id = payload?.ride?.id || payload?.rideId || ''
  if (!id || !pickup || !dest) return null
  const expiresAt = payload?.expiresAt || new Date(Date.now() + 45_000).toISOString()
  if (Date.parse(expiresAt) <= Date.now()) return null
  const ride: PublicRide = {
    id,
    passengerId: payload?.ride?.passengerId || '',
    kind: payload?.ride?.kind === 'daeri' ? 'daeri' : 'taxi',
    pickup,
    dest,
    estimatedFare: Number(payload?.ride?.estimatedFare) || 0,
    status: 'offered',
    offerExpiresAt: expiresAt,
    pendingOffer: null,
    assignedDriver: null,
    escrow: null,
    boardedAt: null,
    readyToSettleAt: null,
    createdAt: expiresAt,
    updatedAt: new Date().toISOString(),
  }
  return {
    ride,
    offer: { pickupDistanceKm: Number(payload?.pickupDistanceKm) || 0, expiresAt },
  }
}

export async function fetchDriverOffer(driverId: string) {
  try {
    const res = await apiFetch(`/api/drivers/offer?driverId=${encodeURIComponent(driverId)}`, { cache: 'no-store' })
    const data = await readJson<{ ride?: PublicRide | null; offer?: { pickupDistanceKm: number; expiresAt: string } | null; active?: PublicRide | null; earnings?: DriverEarningsStats | null }>(res)
    if (!res.ok) return undefined
    return { ride: data.ride ?? null, offer: data.offer ?? null, active: data.active ?? null, earnings: data.earnings ?? null }
  } catch {
    return undefined
  }
}

export async function respondToRideOffer(
  rideId: string,
  driverId: string,
  action: 'accept' | 'reject',
  ride?: Pick<PublicRide, 'passengerId' | 'pickup' | 'dest' | 'estimatedFare' | 'kind'>,
  driver?: { name?: string; vehicle?: string; plate?: string },
) {
  const res = await apiFetch(`/api/rides/${encodeURIComponent(rideId)}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId, action, ride, name: driver?.name, vehicle: driver?.vehicle, plate: driver?.plate }),
  })
  const data = await readJson<{ ride?: PublicRide; error?: string }>(res)
  if (!res.ok || !data.ride) throw new Error(data.error || '콜 응답에 실패했어요.')
  return data.ride
}

export async function acceptRideOnDevice(
  rideId: string,
  ride?: Pick<PublicRide, 'passengerId' | 'pickup' | 'dest' | 'estimatedFare' | 'kind'>,
) {
  const res = await apiFetch(`/api/rides/${encodeURIComponent(rideId)}/respond/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'device-accept', ride }),
  })
  const data = await readJson<{ ride?: PublicRide; error?: string }>(res)
  if (!res.ok || !data.ride) throw new Error(data.error || '콜 수락에 실패했어요.')
  return data.ride
}

export async function lockRideEscrow(input: {
  rideId: string
  passengerId: string
  paymentId?: string
  txid?: string
  sandbox?: boolean
}) {
  const res = await apiFetch('/api/escrow/lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await readJson<{ ride?: PublicRide; error?: string }>(res)
  if (!res.ok || !data.ride) throw new Error(data.error || '에스크로 잠금에 실패했어요.')
  return data.ride
}

export async function markRideProgress(
  rideId: string,
  passengerId: string,
  step: 'boarded' | 'arrived',
  ride?: PublicRide | null,
) {
  const res = await apiFetch(`/api/rides/${encodeURIComponent(rideId)}/progress/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      passengerId,
      step,
      ride: ride
        ? {
            passengerId: ride.passengerId,
            pickup: ride.pickup,
            dest: ride.dest,
            estimatedFare: ride.estimatedFare,
            kind: ride.kind,
            boardedAt: ride.boardedAt,
            readyToSettleAt: ride.readyToSettleAt,
            driverId: ride.assignedDriver?.id,
          }
        : undefined,
    }),
  })
  const data = await readJson<{ ride?: PublicRide; error?: string }>(res).catch(() => null)
  if (!res.ok || !data?.ride) {
    const error = data?.error === 'not_found' ? '운행 정보를 찾지 못했어요. 호출 화면을 연 뒤 다시 눌러 주세요.' : data?.error
    throw new Error(error || '운행 상태를 저장하지 못했어요.')
  }
  return data.ride
}

export async function abandonDriverRide(rideId: string, driverId: string) {
  const res = await apiFetch(`/api/rides/${encodeURIComponent(rideId)}/abandon/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId }),
  })
  const data = await readJson<{ ride?: PublicRide; error?: string }>(res)
  if (!res.ok || !data.ride) throw new Error(data.error || '배차 취소에 실패했어요.')
  return data.ride
}

export async function completeRideTrip(
  rideId: string,
  driverId: string,
  ride?: Pick<PublicRide, 'passengerId' | 'pickup' | 'dest' | 'estimatedFare' | 'kind' | 'boardedAt' | 'readyToSettleAt' | 'escrow'>,
  init?: { signal?: AbortSignal },
) {
  const res = await apiFetch(`/api/rides/${encodeURIComponent(rideId)}/complete/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId, ride }),
    signal: init?.signal,
  })
  const data = await readJson<{ ride?: PublicRide; receipt?: SettlementReceipt; error?: string }>(res).catch(() => null)
  if (!res.ok || !data?.ride) throw new Error(data?.error || '이용 완료 처리에 실패했어요.')
  return data
}

export async function fetchRideHistory(actorId: string, role: 'passenger' | 'driver') {
  const id = actorId.trim()
  if (!id) return [] as PublicRide[]
  try {
    const res = await apiFetch(`/api/rides/?actorId=${encodeURIComponent(id)}&role=${role}`, { cache: 'no-store' })
    const data = await readJson<{ ok?: boolean; rides?: PublicRide[] }>(res)
    if (!res.ok || !data.ok) return [] as PublicRide[]
    return data.rides ?? []
  } catch {
    return [] as PublicRide[]
  }
}

export async function fetchDriverActiveRide(driverId: string) {
  const res = await apiFetch(`/api/drivers/active/?driverId=${encodeURIComponent(driverId)}`, { cache: 'no-store' })
  const data = await readJson<{ ride?: PublicRide | null }>(res)
  if (!res.ok) return null
  return data.ride ?? null
}

export async function fetchDriverEarnings(driverId: string) {
  const res = await apiFetch(`/api/drivers/earnings/?driverId=${encodeURIComponent(driverId)}`, { cache: 'no-store' })
  const data = await readJson<{ stats?: DriverEarningsStats; error?: string }>(res)
  if (!res.ok || !data.stats) return null
  return data.stats
}

export async function fetchRideReceipt(rideId: string) {
  const res = await apiFetch(`/api/rides/${encodeURIComponent(rideId)}/receipt`, { cache: 'no-store' })
  if (res.status === 404) return null
  const data = await readJson<{ receipt?: SettlementReceipt }>(res)
  return data.receipt ?? null
}
