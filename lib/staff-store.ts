import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { createHash, randomUUID, timingSafeEqual } from 'crypto'

export type StaffRole = 'manager' | 'staff'

export type StaffEntry = {
  id: string
  /** 로그인용 직원 ID (staff_id) — 감사 로그의 actor로 기록된다. */
  loginId: string
  name: string
  role: StaffRole
  passwordHash: string
  salt: string
  createdAt: string
  updatedAt: string
}

export type PublicStaff = Omit<StaffEntry, 'passwordHash' | 'salt'>

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const STAFF_KEY = 'taxitago:staff:entries'
const STAFF_VERSION_KEY = 'taxitago:staff:version'
const MAX_ENTRIES = 200
const filePath = path.join(process.cwd(), 'data', 'staff.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoStaff?: StaffEntry[]; __taxitagoStaffVersion?: number }

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

function readFileEntries(): StaffEntry[] {
  try {
    if (!existsSync(filePath)) return []
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { entries?: StaffEntry[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFileEntries(entries: StaffEntry[]) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ entries }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readEntries(): Promise<StaffEntry[]> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', STAFF_KEY])
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw) as StaffEntry[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  if (!globalStore.__taxitagoStaff) globalStore.__taxitagoStaff = readFileEntries()
  return globalStore.__taxitagoStaff
}

async function writeEntries(entries: StaffEntry[]) {
  const trimmed = entries.slice(-MAX_ENTRIES)
  if (useKv) {
    await kvCommand(['SET', STAFF_KEY, JSON.stringify(trimmed)])
    await kvCommand(['INCR', STAFF_VERSION_KEY])
    return
  }
  globalStore.__taxitagoStaff = trimmed
  globalStore.__taxitagoStaffVersion = (globalStore.__taxitagoStaffVersion ?? 0) + 1
  writeFileEntries(trimmed)
}

/** 직원 목록 변경 시 세션 무효화용 버전 — 직원 세션에 함께 저장해 비교한다. */
export async function staffVersion(): Promise<number> {
  if (!useKv) return globalStore.__taxitagoStaffVersion ?? 0
  const raw = await kvCommand<string | number | null>(['GET', STAFF_VERSION_KEY])
  return Number(raw) || 0
}

export async function listStaff(): Promise<StaffEntry[]> {
  const entries = await readEntries()
  return [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function findStaffByLoginId(loginId: string): Promise<StaffEntry | null> {
  const id = loginId.trim()
  if (!id) return null
  const entries = await readEntries()
  return entries.find((entry) => entry.loginId === id) ?? null
}

function hashPassword(password: string, salt: string) {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex')
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

const LOGIN_ID_RE = /^[a-zA-Z0-9_.-]{3,32}$/

export function validateStaffInput(input: { loginId?: string; name?: string; password?: string }, isCreate: boolean) {
  if (isCreate && !LOGIN_ID_RE.test((input.loginId ?? '').trim())) return 'invalid_login_id'
  if (!((input.name ?? '').trim().length >= 1) || (input.name ?? '').trim().length > 40) return 'invalid_name'
  if (isCreate || input.password !== undefined) {
    if ((input.password ?? '').trim().length < 8) return 'password_too_short'
  }
  return null
}

export async function createStaff(input: { loginId: string; name: string; password: string; role: StaffRole }) {
  const loginId = input.loginId.trim()
  const invalid = validateStaffInput({ loginId, name: input.name, password: input.password }, true)
  if (invalid) return { ok: false as const, error: invalid }
  if (await findStaffByLoginId(loginId)) return { ok: false as const, error: 'duplicate_login_id' }
  const salt = randomUUID()
  const now = new Date().toISOString()
  const staff: StaffEntry = {
    id: crypto.randomUUID(),
    loginId,
    name: input.name.trim(),
    role: input.role === 'manager' ? 'manager' : 'staff',
    passwordHash: hashPassword(input.password.trim(), salt),
    salt,
    createdAt: now,
    updatedAt: now,
  }
  const entries = await readEntries()
  entries.push(staff)
  await writeEntries(entries)
  return { ok: true as const, staff }
}

export async function updateStaff(id: string, input: { name?: string; password?: string; role?: StaffRole }) {
  const entries = await readEntries()
  const staff = entries.find((entry) => entry.id === id)
  if (!staff) return { ok: false as const, error: 'not_found' }
  const invalid = validateStaffInput(
    { name: input.name ?? staff.name, password: input.password },
    false,
  )
  if (invalid) return { ok: false as const, error: invalid }
  if (typeof input.name === 'string' && input.name.trim()) staff.name = input.name.trim()
  if (input.role === 'manager' || input.role === 'staff') staff.role = input.role
  if (typeof input.password === 'string' && input.password.trim()) {
    staff.salt = randomUUID()
    staff.passwordHash = hashPassword(input.password.trim(), staff.salt)
  }
  staff.updatedAt = new Date().toISOString()
  await writeEntries(entries)
  return { ok: true as const, staff }
}

export async function deleteStaff(id: string) {
  const entries = await readEntries()
  const staff = entries.find((entry) => entry.id === id)
  if (!staff) return { ok: false as const, error: 'not_found' }
  await writeEntries(entries.filter((entry) => entry.id !== id))
  return { ok: true as const, staff }
}

export async function verifyStaffLogin(loginId: string, password: string): Promise<StaffEntry | null> {
  const staff = await findStaffByLoginId(loginId)
  if (!staff) return null
  return safeEqual(hashPassword(password, staff.salt), staff.passwordHash) ? staff : null
}

export function publicStaff(staff: StaffEntry): PublicStaff {
  return {
    id: staff.id,
    loginId: staff.loginId,
    name: staff.name,
    role: staff.role,
    createdAt: staff.createdAt,
    updatedAt: staff.updatedAt,
  }
}
