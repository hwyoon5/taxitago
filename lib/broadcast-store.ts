import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

/**
 * 관리자 방송 공지 장부.
 * 관리자가 /api/admin/broadcasts에서 등록·수정·삭제하고,
 * 사용자/기사 앱은 /api/broadcasts?audience=… 로 대상별 목록을 폴링한다.
 */

export type BroadcastTarget = 'all' | 'passenger' | 'staff'

export type BroadcastEntry = {
  id: string
  title: string
  body: string
  target: BroadcastTarget
  /** true면 앱 상단 배너로 즉시 노출 */
  banner: boolean
  createdBy: string
  createdByName: string
  createdAt: string
  updatedAt: string
}

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const ENTRIES_KEY = 'taxitago:broadcasts'
const MAX_ENTRIES = 100
const filePath = path.join(process.cwd(), 'data', 'broadcasts.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoBroadcasts?: BroadcastEntry[] }

async function kvCommand<T>(command: (string | number)[]): Promise<T | null> {
  const res = await fetch(kvUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`kv request failed: ${res.status}`)
  const data = (await res.json()) as { result?: T | null }
  return data.result ?? null
}

function readFileEntries(): BroadcastEntry[] {
  try {
    if (!existsSync(filePath)) return []
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { entries?: BroadcastEntry[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFileEntries(entries: BroadcastEntry[]) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ entries }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readEntries(): Promise<BroadcastEntry[]> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', ENTRIES_KEY])
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as BroadcastEntry[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  if (!globalStore.__taxitagoBroadcasts) globalStore.__taxitagoBroadcasts = readFileEntries()
  return globalStore.__taxitagoBroadcasts
}

async function writeEntries(entries: BroadcastEntry[]) {
  const trimmed = entries.slice(-MAX_ENTRIES)
  if (useKv) {
    await kvCommand(['SET', ENTRIES_KEY, JSON.stringify(trimmed)])
    return
  }
  globalStore.__taxitagoBroadcasts = trimmed
  writeFileEntries(trimmed)
}

export async function listBroadcasts(limit = 100): Promise<BroadcastEntry[]> {
  const entries = await readEntries()
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
}

/** 앱 대상 그룹 기준 노출 목록 — driver/partner는 'staff' 대상을 받는다. */
export async function broadcastsForAudience(audience: 'passenger' | 'staff', limit = 20): Promise<BroadcastEntry[]> {
  const entries = await listBroadcasts(200)
  return entries.filter((entry) => entry.target === 'all' || (audience === 'passenger' ? entry.target === 'passenger' : entry.target === 'staff')).slice(0, limit)
}

export async function getBroadcast(id: string): Promise<BroadcastEntry | null> {
  const entries = await readEntries()
  return entries.find((entry) => entry.id === id) ?? null
}

export async function createBroadcast(input: {
  title: string
  body: string
  target: BroadcastTarget
  banner: boolean
  createdBy: string
  createdByName: string
}): Promise<BroadcastEntry> {
  const now = new Date().toISOString()
  const entry: BroadcastEntry = { id: crypto.randomUUID(), ...input, createdAt: now, updatedAt: now }
  const entries = await readEntries()
  entries.push(entry)
  await writeEntries(entries)
  return entry
}

/** 수정 — baseUpdatedAt이 주어지면 조회 이후 변경이 없을 때만 저장한다(OCC). */
export async function updateBroadcast(
  id: string,
  patch: { title?: string; body?: string; target?: BroadcastTarget; banner?: boolean },
  baseUpdatedAt?: string,
): Promise<{ entry: BroadcastEntry; conflict: boolean } | null> {
  const entries = await readEntries()
  const entry = entries.find((item) => item.id === id)
  if (!entry) return null
  if (baseUpdatedAt && entry.updatedAt !== baseUpdatedAt) return { entry, conflict: true }
  if (typeof patch.title === 'string') entry.title = patch.title.trim().slice(0, 80)
  if (typeof patch.body === 'string') entry.body = patch.body.trim().slice(0, 2000)
  if (patch.target === 'all' || patch.target === 'passenger' || patch.target === 'staff') entry.target = patch.target
  if (typeof patch.banner === 'boolean') entry.banner = patch.banner
  entry.updatedAt = new Date().toISOString()
  await writeEntries(entries)
  return { entry, conflict: false }
}

export async function deleteBroadcast(id: string): Promise<boolean> {
  const entries = await readEntries()
  const next = entries.filter((entry) => entry.id !== id)
  if (next.length === entries.length) return false
  await writeEntries(next)
  return true
}
