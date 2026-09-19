import { isUsableCoord } from '@/lib/ride-session'
import type { PublicRide } from '@/lib/dispatch-types'

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
