import { isUsableCoord } from '@/lib/ride-session'
import type { PublicRide } from '@/lib/dispatch-types'
import type { DriverEarningsStats, SettlementReceipt } from '@/lib/escrow-types'

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

export async function createRideRequest(input: {
  passengerId: string
  pickupLat: number
  pickupLng: number
  pickupAddress?: string
  destLat: number
  destLng: number
  destAddress?: string
  destLabel?: string
}): Promise<PublicRide> {
  const res = await fetch('/api/rides', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await readJson<{ ride?: PublicRide; error?: string }>(res)
  if (!res.ok || !data.ride) throw new Error(data.error || '호출 요청을 만들지 못했어요.')
  return data.ride
}

export async function fetchRideRequest(rideId: string): Promise<PublicRide | null> {
  const res = await fetch(`/api/rides/${encodeURIComponent(rideId)}`, { cache: 'no-store' })
  if (res.status === 404) return null
  const data = await readJson<{ ride?: PublicRide; error?: string }>(res)
  if (!res.ok || !data.ride) throw new Error(data.error || '호출 상태를 확인하지 못했어요.')
  return data.ride
}

export async function cancelRideRequest(rideId: string, passengerId: string) {
  await fetch(`/api/rides/${encodeURIComponent(rideId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passengerId }),
  })
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
  await fetch('/api/drivers/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function fetchDriverOffer(driverId: string) {
  const res = await fetch(`/api/drivers/offer?driverId=${encodeURIComponent(driverId)}`, { cache: 'no-store' })
  const data = await readJson<{ ride?: PublicRide | null; offer?: { pickupDistanceKm: number; expiresAt: string } | null }>(res)
  if (!res.ok) return null
  return data.ride ? { ride: data.ride, offer: data.offer ?? null } : null
}

export async function respondToRideOffer(rideId: string, driverId: string, action: 'accept' | 'reject') {
  const res = await fetch(`/api/rides/${encodeURIComponent(rideId)}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId, action }),
  })
  const data = await readJson<{ ride?: PublicRide; error?: string }>(res)
  if (!res.ok || !data.ride) throw new Error(data.error || '콜 응답에 실패했어요.')
  return data.ride
}

export async function lockRideEscrow(input: {
  rideId: string
  passengerId: string
  paymentId?: string
  txid?: string
  sandbox?: boolean
}) {
  const res = await fetch('/api/escrow/lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await readJson<{ ride?: PublicRide; error?: string }>(res)
  if (!res.ok || !data.ride) throw new Error(data.error || '에스크로 잠금에 실패했어요.')
  return data.ride
}

export async function completeRideTrip(rideId: string, driverId: string) {
  const res = await fetch(`/api/rides/${encodeURIComponent(rideId)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId }),
  })
  const data = await readJson<{ ride?: PublicRide; receipt?: SettlementReceipt; error?: string }>(res)
  if (!res.ok || !data.ride) throw new Error(data.error || '정산에 실패했어요.')
  return data
}

export async function fetchDriverActiveRide(driverId: string) {
  const res = await fetch(`/api/drivers/active?driverId=${encodeURIComponent(driverId)}`, { cache: 'no-store' })
  const data = await readJson<{ ride?: PublicRide | null }>(res)
  if (!res.ok) return null
  return data.ride ?? null
}

export async function fetchDriverEarnings(driverId: string) {
  const res = await fetch(`/api/drivers/earnings?driverId=${encodeURIComponent(driverId)}`, { cache: 'no-store' })
  const data = await readJson<{ stats?: DriverEarningsStats; error?: string }>(res)
  if (!res.ok || !data.stats) return null
  return data.stats
}

export async function fetchRideReceipt(rideId: string) {
  const res = await fetch(`/api/rides/${encodeURIComponent(rideId)}/receipt`, { cache: 'no-store' })
  if (res.status === 404) return null
  const data = await readJson<{ receipt?: SettlementReceipt }>(res)
  return data.receipt ?? null
}
