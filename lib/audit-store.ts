import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

export type AuditKind = 'rates' | 'fare' | 'settle' | 'settle-all' | 'adjust' | 'reconcile' | 'wallet' | 'deposit' | 'withdraw'

export type AuditEntry = {
  id: string
  kind: AuditKind
  actor: string
  entryId?: string
  refId?: string
  reason?: string
  detail?: string
  before?: unknown
  after?: unknown
  createdAt: string
}

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const ENTRIES_KEY = 'taxitago:audit:entries'
const MAX_ENTRIES = 500
const filePath = path.join(process.cwd(), 'data', 'audit.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoAudit?: AuditEntry[] }
if (!globalStore.__taxitagoAudit) globalStore.__taxitagoAudit = []

function readFileEntries(): AuditEntry[] {
  try {
    if (!existsSync(filePath)) return []
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { entries?: AuditEntry[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFileEntries(entries: AuditEntry[]) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ entries }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

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

async function readEntries(): Promise<AuditEntry[]> {
  if (useKv) return (await kvGet<AuditEntry[]>(ENTRIES_KEY)) ?? []
  if (!globalStore.__taxitagoAudit!.length) globalStore.__taxitagoAudit = readFileEntries()
  return globalStore.__taxitagoAudit!
}

async function writeEntries(entries: AuditEntry[]) {
  const trimmed = entries.slice(-MAX_ENTRIES)
  if (useKv) {
    await kvCommand(['SET', ENTRIES_KEY, JSON.stringify(trimmed)])
    return
  }
  globalStore.__taxitagoAudit = trimmed
  writeFileEntries(trimmed)
}

async function kvGet<T>(key: string): Promise<T | null> {
  const raw = await kvCommand<string | null>(['GET', key])
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function recordAudit(input: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<AuditEntry> {
  const entry: AuditEntry = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
  const entries = await readEntries()
  entries.push(entry)
  await writeEntries(entries)
  return entry
}

export async function listAudit(limit = 80): Promise<AuditEntry[]> {
  const entries = await readEntries()
  return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
}
