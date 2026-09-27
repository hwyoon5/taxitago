import type { RegisteredNearbyPartner } from '@/lib/nearby-services'

const STORAGE_KEY = 'taxitago-mobility-devices'
export const MOBILITY_DEVICES_EVENT = 'taxitago-mobility-devices'

export type MobilityDeviceKind = '자전거' | '퀵보드'
export type MobilityDeviceStatus = 'available' | 'maintenance' | 'low_battery' | 'rented'

export type MobilityDevice = {
  serial: string
  kind: MobilityDeviceKind
  address: string
  lat: number
  lng: number
  battery: number
  status: MobilityDeviceStatus
  registeredAt: string
}

const STATUSES: MobilityDeviceStatus[] = ['available', 'maintenance', 'low_battery', 'rented']

export const MOBILITY_STATUS_LABEL: Record<MobilityDeviceStatus, string> = {
  available: '이용 가능',
  maintenance: '점검 중',
  low_battery: '배터리 부족',
  rented: '대여 중',
}

export function isDeviceRentable(device: Pick<MobilityDevice, 'status'>) {
  return device.status === 'available'
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

export function deviceSpotId(device: Pick<MobilityDevice, 'kind' | 'serial'>) {
  return `device-${device.kind}-${device.serial.trim()}`
}

function clampBattery(value: unknown) {
  const battery = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(battery)) return 100
  return Math.max(0, Math.min(100, Math.round(battery)))
}

function normalizeDevice(item: Partial<MobilityDevice> | null): MobilityDevice | null {
  if (!item || typeof item.serial !== 'string' || !item.serial.trim()) return null
  if (item.kind !== '자전거' && item.kind !== '퀵보드') return null
  if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) return null
  const status = STATUSES.includes(item.status as MobilityDeviceStatus) ? (item.status as MobilityDeviceStatus) : 'available'
  return {
    serial: item.serial.trim(),
    kind: item.kind,
    address: typeof item.address === 'string' && item.address.trim() ? item.address.trim() : `${item.lat}, ${item.lng}`,
    lat: item.lat as number,
    lng: item.lng as number,
    battery: clampBattery(item.battery),
    status,
    registeredAt: typeof item.registeredAt === 'string' ? item.registeredAt : new Date().toISOString(),
  }
}

function writeDevices(devices: MobilityDevice[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(devices))
  window.dispatchEvent(new Event(MOBILITY_DEVICES_EVENT))
  return devices
}

export function loadMobilityDevices(): MobilityDevice[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<MobilityDevice>[]
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => normalizeDevice(item)).filter((item): item is MobilityDevice => Boolean(item))
  } catch {
    return []
  }
}

export function findDeviceBySpotId(id: string) {
  return loadMobilityDevices().find((device) => deviceSpotId(device) === id) ?? null
}

export function saveMobilityDevice(device: MobilityDevice, previousSerial?: string) {
  const nextDevice = normalizeDevice(device)
  if (!nextDevice) return loadMobilityDevices()
  const drop = new Set([nextDevice.serial.toLowerCase(), previousSerial?.trim().toLowerCase()].filter((item): item is string => Boolean(item)))
  const next = [nextDevice, ...loadMobilityDevices().filter((item) => !drop.has(item.serial.toLowerCase()))]
  return writeDevices(next)
}

export function updateMobilityDevice(serial: string, patch: Partial<Pick<MobilityDevice, 'kind' | 'address' | 'lat' | 'lng' | 'battery' | 'status'>>) {
  const current = loadMobilityDevices()
  const found = current.find((item) => item.serial.toLowerCase() === serial.trim().toLowerCase())
  if (!found) return current
  const nextDevice = normalizeDevice({ ...found, ...patch, serial: found.serial })
  if (!nextDevice) return current
  return writeDevices(current.map((item) => (item.serial.toLowerCase() === found.serial.toLowerCase() ? nextDevice : item)))
}

export function deleteMobilityDevice(serial: string) {
  const key = serial.trim().toLowerCase()
  return writeDevices(loadMobilityDevices().filter((item) => item.serial.toLowerCase() !== key))
}

export function setMobilityDeviceStatus(serial: string, status: MobilityDeviceStatus) {
  return updateMobilityDevice(serial, { status })
}

export function mobilityPartnersForService(service: string): RegisteredNearbyPartner[] {
  return loadMobilityDevices()
    .filter((device) => deviceMatchesService(device.kind, service))
    .map((device) => ({
      id: deviceSpotId(device),
      name: device.serial,
      lat: device.lat,
      lng: device.lng,
      extra: `배터리 ${device.battery}%`,
      rate: device.kind === '자전거' ? '0.2 Pi' : '0.3 Pi',
      rentable: isDeviceRentable(device),
      statusLabel: MOBILITY_STATUS_LABEL[device.status],
      battery: device.battery,
    }))
}
