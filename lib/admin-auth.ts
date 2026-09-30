import { createHash, randomUUID, timingSafeEqual } from 'crypto'
import { verifyTotpCode } from '@/lib/totp'

const SESSION_TTL_MS = 12 * 60 * 60 * 1000

type StoredPassword = { hash: string; salt: string; updatedAt: string }
type SessionRecord = { v: number; exp: number }

type AdminDb = {
  password: StoredPassword | null
  version: number
  sessions: Map<string, SessionRecord>
}

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const PASSWORD_KEY = 'taxitago:admin:password'
const VERSION_KEY = 'taxitago:admin:version'
const sessionKey = (token: string) => `taxitago:admin:session:${token}`

function db(): AdminDb {
  const globalStore = globalThis as typeof globalThis & { __taxitagoAdminAuth?: AdminDb }
  if (!globalStore.__taxitagoAdminAuth) {
    globalStore.__taxitagoAdminAuth = { password: null, version: 0, sessions: new Map() }
  }
  return globalStore.__taxitagoAdminAuth
}

let warnedEphemeral = false
function warnEphemeral() {
  if (warnedEphemeral || !process.env.VERCEL) return
  warnedEphemeral = true
  console.error('[admin-auth] no KV configured on Vercel — admin sessions/password resets are NOT durable')
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

async function getStoredPassword(): Promise<StoredPassword | null> {
  if (!useKv) {
    warnEphemeral()
    return db().password
  }
  const raw = await kvCommand<string | null>(['GET', PASSWORD_KEY])
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredPassword
  } catch {
    return null
  }
}

async function getVersion(): Promise<number> {
  if (!useKv) return db().version
  const raw = await kvCommand<string | number | null>(['GET', VERSION_KEY])
  return Number(raw) || 0
}

async function bumpVersion() {
  if (!useKv) {
    db().version += 1
    db().sessions.clear()
    return
  }
  await kvCommand(['INCR', VERSION_KEY])
}

function hashPassword(password: string, salt: string) {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex')
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function envPasswordConfigured() {
  return Boolean(
    process.env.ADMIN_PASSWORD_HASH?.trim() || process.env.ADMIN_PASSWORD?.trim() || process.env.ADMIN_SUPPORT_KEY?.trim(),
  )
}

export async function hasAdminPassword() {
  if (envPasswordConfigured()) return true
  return Boolean(await getStoredPassword())
}

export async function verifyAdminPassword(password: string) {
  const stored = await getStoredPassword()
  if (stored) return safeEqual(hashPassword(password, stored.salt), stored.hash)
  const expectedHash = process.env.ADMIN_PASSWORD_HASH?.trim().toLowerCase()
  if (expectedHash) return safeEqual(createHash('sha256').update(password).digest('hex'), expectedHash)
  const expected = (process.env.ADMIN_PASSWORD || process.env.ADMIN_SUPPORT_KEY || '').trim()
  if (!expected) return false
  return safeEqual(password, expected)
}

export async function setupAdminPassword(newPassword: string) {
  if (await hasAdminPassword()) return { ok: false as const, error: 'already_configured' }
  const password = newPassword.trim()
  if (password.length < 8) return { ok: false as const, error: 'password_too_short' }
  const salt = randomUUID()
  const stored: StoredPassword = { hash: hashPassword(password, salt), salt, updatedAt: new Date().toISOString() }
  if (useKv) {
    await kvCommand(['SET', PASSWORD_KEY, JSON.stringify(stored)])
  } else {
    warnEphemeral()
    db().password = stored
  }
  await bumpVersion()
  return { ok: true as const }
}

export async function createAdminSession() {
  const token = randomUUID() + randomUUID().replace(/-/g, '')
  const record: SessionRecord = { v: await getVersion(), exp: Date.now() + SESSION_TTL_MS }
  if (useKv) {
    await kvCommand(['SET', sessionKey(token), JSON.stringify(record), 'PX', SESSION_TTL_MS])
  } else {
    warnEphemeral()
    db().sessions.set(token, record)
  }
  return { token, expiresAt: new Date(record.exp).toISOString() }
}

async function getSession(token: string): Promise<SessionRecord | null> {
  if (!useKv) {
    const record = db().sessions.get(token) ?? null
    if (record && record.exp < Date.now()) {
      db().sessions.delete(token)
      return null
    }
    return record
  }
  const raw = await kvCommand<string | null>(['GET', sessionKey(token)])
  if (!raw) return null
  try {
    return JSON.parse(raw) as SessionRecord
  } catch {
    return null
  }
}

export async function deleteAdminSession(token: string) {
  if (!token) return
  if (useKv) await kvCommand(['DEL', sessionKey(token)])
  else db().sessions.delete(token)
}

export async function isAdminRequest(request: Request) {
  const header = request.headers.get('x-admin-key')?.trim()
  const query = new URL(request.url).searchParams.get('key')?.trim()
  const provided = header || query || ''
  if (!provided) return false
  if (await verifyAdminPassword(provided)) return true
  const session = await getSession(provided)
  if (!session) return false
  if (session.exp < Date.now()) {
    await deleteAdminSession(provided)
    return false
  }
  return session.v === (await getVersion())
}

export async function resetAdminPassword(code: string, newPassword: string) {
  const secret = process.env.ADMIN_TOTP_SECRET?.trim()
  if (!secret) return { ok: false as const, error: 'totp_not_configured' }
  if (!verifyTotpCode(secret, code)) return { ok: false as const, error: 'invalid_code' }
  const password = newPassword.trim()
  if (password.length < 8) return { ok: false as const, error: 'password_too_short' }
  const salt = randomUUID()
  const stored: StoredPassword = { hash: hashPassword(password, salt), salt, updatedAt: new Date().toISOString() }
  if (useKv) {
    await kvCommand(['SET', PASSWORD_KEY, JSON.stringify(stored)])
  } else {
    warnEphemeral()
    db().password = stored
  }
  await bumpVersion()
  return { ok: true as const }
}
