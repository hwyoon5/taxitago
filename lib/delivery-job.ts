import { apiFetch } from '@/lib/app-origin'
import type { DeliveryVehicle, PackageSizeId } from '@/lib/delivery-fare'

export type DeliveryJobStatus = 'requested' | 'assigned' | 'completed'

export type DeliveryJob = {
  id: string
  /** 발신인 식별자 — 서버 수정·삭제·내 목록 조회의 소유자 키. */
  ownerId?: string
  vehicle: DeliveryVehicle
  packageSize: PackageSizeId
  packageLabel: string
  fare: number
  pickupAddress: string
  destAddress: string
  senderPhone: string
  recipientPhone: string
  pickupLat?: number | null
  pickupLng?: number | null
  destLat?: number | null
  destLng?: number | null
  /** 예약 수거 시각(ISO) — 없으면 즉시 배송. */
  scheduledAt?: string | null
  status: DeliveryJobStatus
  createdAt: string
  /** 물품 사진 — 리사이즈된 dataURL, 서버가 attachment-store에 보관. */
  photos?: { name: string; mime: string; dataUrl: string }[]
}

const JOB_KEY = 'taxitago-delivery-job'
const CHAT_KEY = 'taxitago-delivery-chat'

export type DeliveryChatPeer = 'sender' | 'recipient'

export type DeliveryChatMessage = {
  id: string
  peer: DeliveryChatPeer
  sender: 'driver' | 'customer'
  text: string
  at: string
}

export function loadDeliveryJob(): DeliveryJob | null {
  try {
    const raw = window.localStorage.getItem(JOB_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DeliveryJob
    if (!parsed?.id || !parsed.senderPhone || !parsed.recipientPhone) return null
    return parsed
  } catch {
    return null
  }
}

export function saveDeliveryJob(job: DeliveryJob) {
  window.localStorage.setItem(JOB_KEY, JSON.stringify(job))
}

export function patchDeliveryJob(patch: Partial<DeliveryJob>) {
  const current = loadDeliveryJob()
  if (!current) return null
  const next = { ...current, ...patch }
  saveDeliveryJob(next)
  return next
}

export function loadDeliveryChat(jobId: string, peer: DeliveryChatPeer): DeliveryChatMessage[] {
  try {
    const raw = window.localStorage.getItem(CHAT_KEY)
    if (!raw) return []
    const all = JSON.parse(raw) as Record<string, DeliveryChatMessage[]>
    return all[`${jobId}:${peer}`] ?? []
  } catch {
    return []
  }
}

export function appendDeliveryChat(jobId: string, message: DeliveryChatMessage) {
  try {
    const raw = window.localStorage.getItem(CHAT_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, DeliveryChatMessage[]>) : {}
    const key = `${jobId}:${message.peer}`
    all[key] = [...(all[key] ?? []), message]
    window.localStorage.setItem(CHAT_KEY, JSON.stringify(all))
    return all[key]
  } catch {
    return [message]
  }
}

export type PublicDelivery = {
  id: string
  pickupAddress: string
  destAddress: string
  pickupLat?: number | null
  pickupLng?: number | null
  destLat?: number | null
  destLng?: number | null
  vehicle?: string | null
  packageSize?: string | null
  /** 예약 수거 시각(ISO) — null이면 즉시 배송. */
  scheduledAt?: string | null
  createdAt?: string
  packageLabel: string
  fare: number
  status: 'requested' | 'assigned'
  driverName: string | null
  driverVehicle: string | null
  driverPlate: string | null
  /** 배정 후에만 당사자에게 노출되는 연락처. */
  driverPhone?: string
  senderPhone?: string
  photoCount?: number
  paymentMethod?: 'prepay_pi' | 'onsite_qr' | null
  paidAt?: string | null
  recipientPhone?: string
}

export async function publishDelivery(job: DeliveryJob) {
  const res = await apiFetch('/api/deliveries/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(job),
  })
  const data = (await res.json().catch(() => null)) as { job?: PublicDelivery } | null
  if (!res.ok || !data?.job) throw new Error('택배 호출을 올리지 못했어요.')
  return data.job
}

export async function fetchDelivery(id: string, viewer?: string) {
  const res = await apiFetch(`/api/deliveries/${encodeURIComponent(id)}/${viewer ? `?viewer=${encodeURIComponent(viewer)}` : ''}`)
  if (res.status === 404) return null
  const data = (await res.json().catch(() => null)) as { job?: PublicDelivery } | null
  return data?.job ?? null
}

export async function fetchOpenDeliveries() {
  const res = await apiFetch('/api/deliveries/')
  const data = (await res.json().catch(() => null)) as { jobs?: PublicDelivery[] } | null
  if (!res.ok) return []
  return data?.jobs ?? []
}

export async function acceptDelivery(id: string, driver: { driverId: string; name?: string; vehicle: string; plate: string; phone?: string }) {
  const res = await apiFetch(`/api/deliveries/${encodeURIComponent(id)}/accept/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(driver),
  })
  const data = (await res.json().catch(() => null)) as { job?: PublicDelivery; error?: string } | null
  if (!res.ok || !data?.job) throw new Error(data?.error || '배차 수락에 실패했어요.')
  return data.job
}

export async function fetchAcceptedDeliveries(driverId: string) {
  const res = await apiFetch(`/api/deliveries/?driverId=${encodeURIComponent(driverId)}`)
  const data = (await res.json().catch(() => null)) as { jobs?: PublicDelivery[] } | null
  return res.ok ? (data?.jobs ?? []) : []
}

export async function fetchMyDeliveries(ownerId: string) {
  const res = await apiFetch(`/api/deliveries/?ownerId=${encodeURIComponent(ownerId)}`)
  const data = (await res.json().catch(() => null)) as { jobs?: PublicDelivery[] } | null
  return res.ok ? (data?.jobs ?? []) : []
}

export async function updateDelivery(id: string, ownerId: string, patch: Record<string, unknown>) {
  const res = await apiFetch(`/api/deliveries/${encodeURIComponent(id)}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...patch, ownerId }),
  })
  const data = (await res.json().catch(() => null)) as { job?: PublicDelivery; error?: string } | null
  if (!res.ok || !data?.job) throw new Error(data?.error || '택배 정보를 수정하지 못했어요.')
  return data.job
}

export async function deleteDelivery(id: string, ownerId: string) {
  const res = await apiFetch(`/api/deliveries/${encodeURIComponent(id)}/`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerId }),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error || '택배를 삭제하지 못했어요.')
  }
}
