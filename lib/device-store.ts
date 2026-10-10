import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { kvCommand, kvConfigured } from '@/lib/kv'
import type { DeviceTelemetry } from '@/lib/device-types'

export type { DeviceKind, DeviceTelemetry } from '@/lib/device-types'
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

export async function listDevices(): Promise<DeviceTelemetry[]> {
  const entries = await readEntries()
  return [...entries].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
}
