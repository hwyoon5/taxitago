import type { EvBooking, EvStationAvailability } from '@/lib/ev-booking'

export type { EvBooking, EvStationAvailability }

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { cache: 'no-store', ...init })
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(data?.error || `request_failed_${res.status}`)
  return data as T
}

/** 이용자 예약 목록 + 지정 충전소들의 실시간 가용 슬롯·대기열 스냅샷. */
export function fetchEvBookings(userId: string, stations: { id: string; name?: string }[]) {
  const param = stations
    .filter((s) => s.id)
    .slice(0, 20)
    .map((s) => (s.name ? `${s.id}|${s.name}` : s.id))
    .join(',')
  return call<{ bookings: EvBooking[]; mine: EvBooking | null; availability: EvStationAvailability[] }>(
    `/api/ev/booking?userId=${encodeURIComponent(userId)}&stations=${encodeURIComponent(param)}`,
  )
}

export function createEvBooking(input: {
  userId: string
  userUid?: string
  stationId: string
  stationName?: string
  startAt?: string
  durationMin?: number
  powerKw?: number
  providerName?: string
}) {
  return call<{ ok: boolean; booking: EvBooking; deduped?: boolean; availability: EvStationAvailability }>('/api/ev/booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((data) => data.booking)
}

export function cancelEvBooking(id: string, userId: string) {
  return call<{ ok: boolean; booking: EvBooking }>(`/api/ev/booking/${id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  }).then((data) => data.booking)
}
