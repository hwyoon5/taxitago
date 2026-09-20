import type { DeliveryVehicle, PackageSizeId } from '@/lib/delivery-fare'

export type DeliveryJobStatus = 'requested' | 'assigned' | 'completed'

export type DeliveryJob = {
  id: string
  vehicle: DeliveryVehicle
  packageSize: PackageSizeId
  packageLabel: string
  fare: number
  pickupAddress: string
  destAddress: string
  senderPhone: string
  recipientPhone: string
  status: DeliveryJobStatus
  createdAt: string
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
