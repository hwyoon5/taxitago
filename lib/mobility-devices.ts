import type { RegisteredNearbyPartner } from '@/lib/nearby-services'

const STORAGE_KEY = 'taxitago-mobility-devices'
export const MOBILITY_DEVICES_EVENT = 'taxitago-mobility-devices'

export type MobilityDeviceKind = '자전거' | '퀵보드'

export type MobilityDevice = {
  serial: string
  kind: MobilityDeviceKind
  address: string
  lat: number
  lng: number
  registeredAt: string
}

export function parseCoordInput(value: string): { lat: number; lng: number } | null {
  const trimmed = value.trim()
  if (!/^-?\d+(?:\.\d+)?\s*[, ]\s*-?\d+(?:\.\d+)?$/.test(trimmed)) return null
  const [first, second] = trimmed.split(/[, ]+/).map((part) => Number(part))
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null
  if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return { lat: first, lng: second }
  if (Math.abs(second) <= 90 && Math.abs(first) <= 180) return { lat: second, lng: first }
  return null
}

export function deviceMatchesService(kind: MobilityDeviceKind, service: string) {
  if (kind === '자전거') return service === '자전거'
  return service === '킥보드' || service === '퀵보드'
}

export function loadMobilityDevices(): MobilityDevice[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as MobilityDevice[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item && typeof item.serial === 'string' && Number.isFinite(item.lat) && Number.isFinite(item.lng))
  } catch {
    return []
  }
}

export function saveMobilityDevice(device: MobilityDevice) {
  const serial = device.serial.trim()
  const next = [device, ...loadMobilityDevices().filter((item) => item.serial.trim().toLowerCase() !== serial.toLowerCase())]
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event(MOBILITY_DEVICES_EVENT))
  return next
}

export function mobilityPartnersForService(service: string): RegisteredNearbyPartner[] {
  return loadMobilityDevices()
    .filter((device) => deviceMatchesService(device.kind, service))
    .map((device) => ({
      id: `device-${device.kind}-${device.serial.trim()}`,
      name: device.serial.trim(),
      lat: device.lat,
      lng: device.lng,
      extra: '등록 기기',
      rate: device.kind === '자전거' ? '0.2 Pi' : '0.3 Pi',
    }))
}
