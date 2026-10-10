import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { kvCommand, kvConfigured } from '@/lib/kv'
import type { DeviceSpec, DeviceTelemetry } from '@/lib/device-types'
import { specKindForDeviceKind } from '@/lib/device-types'

export type { DeviceKind, DeviceSpec, DeviceTelemetry } from '@/lib/device-types'
export { DEVICE_TYPE_LABEL, deviceTypeLabel } from '@/lib/device-types'

const useKv = kvConfigured
const DEVICES_KEY = 'taxitago:devices'
const MAX_DEVICES = 500
const filePath = path.join(process.cwd(), 'data', 'devices.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoDevices?: DeviceTelemetry[] }
if (!globalStore.__taxitagoDevices) globalStore.__taxitagoDevices = []

function readFileEntries(): DeviceTelemetry[] {
  try {
    if (!existsSync(filePath)) return []
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { entries?: DeviceTelemetry[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFileEntries(entries: DeviceTelemetry[]) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ entries }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readEntries(): Promise<DeviceTelemetry[]> {
  if (useKv) {
    try {
      const raw = await kvCommand<string | null>(['GET', DEVICES_KEY])
      if (!raw) return []
      const parsed = JSON.parse(raw) as DeviceTelemetry[]
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      console.error('[Device] kv read failed; using local fallback', error)
      if (!globalStore.__taxitagoDevices!.length) globalStore.__taxitagoDevices = readFileEntries()
      return globalStore.__taxitagoDevices!
    }
  }
  if (!globalStore.__taxitagoDevices!.length) globalStore.__taxitagoDevices = readFileEntries()
  return globalStore.__taxitagoDevices!
}

async function writeEntries(entries: DeviceTelemetry[]) {
  const trimmed = entries.slice(-MAX_DEVICES)
  if (useKv) {
    try {
      await kvCommand(['SET', DEVICES_KEY, JSON.stringify(trimmed)])
      return
    } catch (error) {
      console.error('[Device] kv write failed; falling back to local store', error)
    }
  }
  globalStore.__taxitagoDevices = trimmed
  writeFileEntries(trimmed)
}

const DEVICE_ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/

/** 기기 위치 신고를 upsert한다. 유효하지 않은 입력이면 null. */
export async function reportDeviceLocation(input: {
  deviceId: string
  type?: string
  latitude: number
  longitude: number
  batteryLevel?: number | null
  status?: string
}): Promise<DeviceTelemetry | null> {
  const deviceId = (input.deviceId || '').trim()
  if (!DEVICE_ID_RE.test(deviceId)) return null
  const lat = Number(input.latitude)
  const lng = Number(input.longitude)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null
  const battery = input.batteryLevel === null || input.batteryLevel === undefined
    ? null
    : Math.max(0, Math.min(100, Math.round(Number(input.batteryLevel))))
  const now = new Date().toISOString()

  const entries = await readEntries()
  const existing = entries.find((row) => row.deviceId === deviceId)
  if (existing) {
    existing.type = (input.type || existing.type || '').trim().slice(0, 32)
    existing.latitude = lat
    existing.longitude = lng
    existing.batteryLevel = Number.isFinite(battery) ? battery : existing.batteryLevel
    existing.status = (input.status || existing.status || 'active').trim().slice(0, 32)
    existing.lastSeen = now
    existing.updateCount += 1
    await writeEntries(entries)
    return existing
  }
  const entry: DeviceTelemetry = {
    deviceId,
    type: (input.type || '').trim().slice(0, 32),
    latitude: lat,
    longitude: lng,
    batteryLevel: Number.isFinite(battery) ? battery : null,
    status: (input.status || 'active').trim().slice(0, 32),
    lastSeen: now,
    firstSeen: now,
    updateCount: 1,
  }
  entries.push(entry)
  await writeEntries(entries)
  return entry
}

export async function listDevices(filter?: { type?: string; ownerUid?: string }): Promise<DeviceTelemetry[]> {
  const entries = await readEntries()
  return entries
    .filter((row) => (!filter?.type || row.type === filter.type) && (!filter?.ownerUid || row.ownerUid === filter.ownerUid))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
}

const sanitize = (value: unknown, max = 128) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const numOrNull = (value: unknown, min = -1e9, max = 1e9) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

function sanitizeSpec(kind: string, raw: unknown): DeviceSpec | null {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (kind === 'mobility') {
    return {
      kind,
      model: sanitize(s.model),
      speedLimitKmh: numOrNull(s.speedLimitKmh, 0, 200),
      specNote: sanitize(s.specNote, 256),
      address: sanitize(s.address, 256),
      latitude: numOrNull(s.latitude, -90, 90),
      longitude: numOrNull(s.longitude, -180, 180),
      batteryLevel: numOrNull(s.batteryLevel, 0, 100),
      locked: s.locked !== false,
      rentable: s.rentable === true,
    }
  }
  if (kind === 'ev') {
    return {
      kind,
      chargeType: sanitize(s.chargeType, 32),
      powerKw: numOrNull(s.powerKw, 0, 1000),
      placeName: sanitize(s.placeName),
      locationDetail: sanitize(s.locationDetail, 256),
      pricePerKwh: numOrNull(s.pricePerKwh, 0, 1e6),
      operatingHours: sanitize(s.operatingHours, 64),
      address: sanitize(s.address, 256),
      latitude: numOrNull(s.latitude, -90, 90),
      longitude: numOrNull(s.longitude, -180, 180),
    }
  }
  if (kind === 'parking') {
    return {
      kind,
      spaces: numOrNull(s.spaces, 0, 100000),
      lotType: sanitize(s.lotType, 32),
      baseFee: numOrNull(s.baseFee, 0, 1e7),
      extraFee: numOrNull(s.extraFee, 0, 1e7),
      feeUnitMinutes: numOrNull(s.feeUnitMinutes, 0, 1440),
      address: sanitize(s.address, 256),
      latitude: numOrNull(s.latitude, -90, 90),
      longitude: numOrNull(s.longitude, -180, 180),
      entranceNote: sanitize(s.entranceNote, 256),
    }
  }
  return null
}

/**
 * 파트너 폼의 시설·기기 등록 — deviceId 단위 upsert.
 * 기존 GPS 텔레메트리(updateCount·lastSeen)는 보존하고 spec·소유자만 갱신한다.
 */
export async function registerDevice(input: {
  deviceId: string
  type: string
  ownerUid?: string
  ownerName?: string
  spec: unknown
  status?: string
}): Promise<DeviceTelemetry | null> {
  const deviceId = (input.deviceId || '').trim()
  if (!DEVICE_ID_RE.test(deviceId)) return null
  const type = (input.type || '').trim().slice(0, 32)
  if (!type) return null
  const specKind = specKindForDeviceKind(type)
  if (!specKind) return null
  const spec = sanitizeSpec(specKind, input.spec)
  if (!spec) return null
  const now = new Date().toISOString()

  const entries = await readEntries()
  const existing = entries.find((row) => row.deviceId === deviceId)
  const lat = spec.latitude
  const lng = spec.longitude
  const battery = spec.kind === 'mobility' ? spec.batteryLevel : null
  const status = (input.status || (spec.kind === 'mobility' ? (spec.rentable ? 'active' : 'idle') : 'active')).trim().slice(0, 32)
  if (existing) {
    existing.type = type
    existing.ownerUid = sanitize(input.ownerUid, 64) || existing.ownerUid
    existing.ownerName = sanitize(input.ownerName, 64) || existing.ownerName
    existing.spec = spec
    existing.registered = true
    if (lat !== null && lng !== null) {
      existing.latitude = lat
      existing.longitude = lng
    }
    if (Number.isFinite(battery)) existing.batteryLevel = battery
    existing.status = status
    existing.lastSeen = now
    existing.updateCount += 1
    await writeEntries(entries)
    return existing
  }
  const entry: DeviceTelemetry = {
    deviceId,
    type,
    latitude: lat ?? 0,
    longitude: lng ?? 0,
    batteryLevel: Number.isFinite(battery) ? battery : null,
    status,
    lastSeen: now,
    firstSeen: now,
    updateCount: 1,
    ownerUid: sanitize(input.ownerUid, 64),
    ownerName: sanitize(input.ownerName, 64),
    spec,
    registered: true,
  }
  entries.push(entry)
  await writeEntries(entries)
  return entry
}
