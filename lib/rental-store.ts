import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { kvCommand, kvConfigured } from '@/lib/kv'
import type { DeviceTelemetry } from '@/lib/device-types'

/**
 * 공유 모빌리티 대여 이력 — setDeviceRentalState의 대여·반납 전이를
 * 별도 레코드로 남겨 관리자 이력 검색이 가능하게 한다.
 * 기기 레코드와 같은 KV 키 하나에 배열로 저장하고, KV 없으면 파일·메모리로 유지한다.
 */
export type RentalRecord = {
  id: string
  deviceId: string
  /** 원시 기기 타입 — 'bicycle' | 'kickboard' 등 */
  type: string
  model: string
  address: string
  ownerUid: string
  ownerName: string
  renterId: string
  rentedAt: string
  returnedAt: string | null
  status: 'rented' | 'returned'
}

const useKv = kvConfigured
const RENTALS_KEY = 'taxitago:rentals'
const MAX_RENTALS = 1000
const filePath = path.join(process.cwd(), 'data', 'rentals.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoRentals?: RentalRecord[] }
if (!globalStore.__taxitagoRentals) globalStore.__taxitagoRentals = []

function readFileEntries(): RentalRecord[] {
  try {
    if (!existsSync(filePath)) return []
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { entries?: RentalRecord[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFileEntries(entries: RentalRecord[]) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ entries }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readEntries(): Promise<RentalRecord[]> {
  if (useKv) {
    try {
      const raw = await kvCommand<string | null>(['GET', RENTALS_KEY])
      if (!raw) return []
      const parsed = JSON.parse(raw) as RentalRecord[]
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      console.error('[Rental] kv read failed; using local fallback', error)
      if (!globalStore.__taxitagoRentals!.length) globalStore.__taxitagoRentals = readFileEntries()
      return globalStore.__taxitagoRentals!
    }
  }
  if (!globalStore.__taxitagoRentals!.length) globalStore.__taxitagoRentals = readFileEntries()
  return globalStore.__taxitagoRentals!
}

async function writeEntries(entries: RentalRecord[]) {
  const trimmed = entries.slice(-MAX_RENTALS)
  if (useKv) {
    try {
      await kvCommand(['SET', RENTALS_KEY, JSON.stringify(trimmed)])
      return
    } catch (error) {
      console.error('[Rental] kv write failed; falling back to local store', error)
    }
  }
  globalStore.__taxitagoRentals = trimmed
  writeFileEntries(trimmed)
}

function mobilitySpec(row: DeviceTelemetry) {
  return row.spec?.kind === 'mobility' ? row.spec : null
}

/** 대여 시작 — 같은 기기의 열린 대여 건이 남아 있으면 먼저 반납 처리로 닫는다. */
export async function recordRentalStart(row: DeviceTelemetry, renterId: string) {
  const mobility = mobilitySpec(row)
  if (!mobility) return null
  const entries = await readEntries()
  const now = new Date().toISOString()
  for (const entry of entries) {
    if (entry.deviceId === row.deviceId && entry.status === 'rented' && !entry.returnedAt) {
      entry.status = 'returned'
      entry.returnedAt = now
    }
  }
  const record: RentalRecord = {
    id: randomUUID().replace(/-/g, '').slice(0, 16),
    deviceId: row.deviceId,
    type: typeof row.type === 'string' ? row.type : '',
    model: typeof mobility.model === 'string' ? mobility.model : '',
    address: typeof mobility.address === 'string' ? mobility.address : '',
    ownerUid: typeof row.ownerUid === 'string' ? row.ownerUid : '',
    ownerName: typeof row.ownerName === 'string' ? row.ownerName : '',
    renterId: renterId.trim(),
    rentedAt: typeof row.rentedAt === 'string' && row.rentedAt ? row.rentedAt : now,
    returnedAt: null,
    status: 'rented',
  }
  entries.push(record)
  await writeEntries(entries)
  return record
}

/** 반납 — 해당 기기의 가장 최근 열린 대여 건을 닫는다. */
export async function recordRentalEnd(deviceId: string) {
  const id = deviceId.trim()
  if (!id) return null
  const entries = await readEntries()
  const open = [...entries].reverse().find((entry) => entry.deviceId === id && entry.status === 'rented' && !entry.returnedAt)
  if (!open) return null
  open.status = 'returned'
  open.returnedAt = new Date().toISOString()
  await writeEntries(entries)
  return open
}

export async function listRentals(): Promise<RentalRecord[]> {
  const entries = await readEntries()
  return [...entries].sort((a, b) => b.rentedAt.localeCompare(a.rentedAt))
}
