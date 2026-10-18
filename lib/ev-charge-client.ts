import type { EvChargeSession } from '@/lib/ev-charge-types'

export type { EvChargeSession }

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { cache: 'no-store', ...init })
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(data?.error || `request_failed_${res.status}`)
  return data as T
}

export function createEvChargeSession(input: {
  userId: string
  userUid?: string
  userWallet?: string
  userPhone?: string
  chargerId: string
  chargerName: string
  powerKw?: number
  providerId?: string
  providerName?: string
  perKwhPi?: number
  bookingId?: string
}) {
  return call<{ ok: boolean; session: EvChargeSession; deduped?: boolean }>('/api/ev/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((data) => data.session)
}

export function fetchEvChargeSession(id: string, userId: string) {
  return call<{ session: EvChargeSession }>(`/api/ev/session/${id}?userId=${encodeURIComponent(userId)}`).then((data) => data.session)
}

export function lockEvChargeSession(id: string, input: { userId: string; paymentId: string; txid: string }) {
  return call<{ ok: boolean; session: EvChargeSession }>(`/api/ev/session/${id}/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((data) => data.session)
}

export function completeEvChargeSession(id: string, input: { userId: string; kwh?: number }) {
  return call<{ ok: boolean; session: EvChargeSession }>(`/api/ev/session/${id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).then((data) => data.session)
}

export function cancelEvChargeSession(id: string, userId: string) {
  return call<{ ok: boolean; session: EvChargeSession }>(`/api/ev/session/${id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  }).then((data) => data.session)
}
