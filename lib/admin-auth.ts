import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { randomTotpSecret, verifyTotpCode } from '@/lib/totp'
import { staffVersion } from '@/lib/staff-store'

const SESSION_TTL_MS = 12 * 60 * 60 * 1000

export type AdminActor = {
  /** 감사 로그에 남는 식별자 — 마스터는 'master', 직원은 로그인 ID */
  staffId: string
  staffName: string
  role: 'master' | 'manager' | 'staff'
}

const MASTER_ACTOR: AdminActor = { staffId: 'master', staffName: '최고 관리자', role: 'master' }

type StoredPassword = { hash: string; salt: string; updatedAt: string }
type SessionRecord = { v: number; exp: number; staffId?: string; staffName?: string; staffRole?: string; sv?: number }

type AdminDb = {
  password: StoredPassword | null
  version: number
  sessions: Map<string, SessionRecord>
  revoked: Set<string>
  totpSecret: string | null
}

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const PASSWORD_KEY = 'taxitago:admin:password'
const VERSION_KEY = 'taxitago:admin:version'
const SECRET_KEY = 'taxitago:admin:session-secret'
const TOTP_KEY = 'taxitago:admin:totp-secret'
const sessionKey = (token: string) => `taxitago:admin:session:${token}`

function db(): AdminDb {
  const globalStore = globalThis as typeof globalThis & { __taxitagoAdminAuth?: AdminDb }
  if (!globalStore.__taxitagoAdminAuth) {
    globalStore.__taxitagoAdminAuth = {
      password: null,
      version: 0,
      sessions: new Map(),
      revoked: new Set(),
      totpSecret: null,
    }
  }
  return globalStore.__taxitagoAdminAuth
}

let warnedEphemeral = false
function warnEphemeral() {
  if (warnedEphemeral || !process.env.VERCEL) return
  warnedEphemeral = true
  console.error('[admin-auth] no KV configured on Vercel — admin password resets are NOT durable')
}

// 세션 토큰은 HMAC 서명된 stateless 형식이다. 서버리스 인스턴스가 요청마다
// 달라져도 인메모리 저장소 없이 검증할 수 있어야 무한 로그인 리다이렉트가 없다.
// KV가 있으면 레코드도 함께 저장해 로그아웃/버전 무효화를 지원한다.
let cachedSecret: string | null = null
async function sessionSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret
  if (useKv) {
    try {
      const existing = await kvCommand<string | null>(['GET', SECRET_KEY])
      if (existing) {
        cachedSecret = existing
        return existing
      }
      const generated = randomUUID() + randomUUID()
      const claimed = await kvCommand<string | null>(['SET', SECRET_KEY, generated, 'NX'])
      cachedSecret =
        claimed === 'OK' ? generated : ((await kvCommand<string | null>(['GET', SECRET_KEY])) || generated)
      return cachedSecret
    } catch {
      // KV 장애 시에는 이 프로세스 전용 시크릿으로 발급한다 — 500으로 로그인이
      // 죽는 것보다 인스턴스 한정 세션 발급이 낫다.
      console.warn('[admin-auth] session secret lookup failed; using process-local secret')
    }
  }
  cachedSecret = randomUUID() + randomUUID()
  return cachedSecret
}

async function signSession(record: SessionRecord): Promise<string> {
  const body = Buffer.from(JSON.stringify(record)).toString('base64url')
  const sig = createHmac('sha256', await sessionSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

async function verifySignedSession(token: string): Promise<SessionRecord | null> {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const expected = createHmac('sha256', await sessionSecret()).update(body).digest('base64url')
  const provided = Buffer.from(token.slice(dot + 1))
  const wanted = Buffer.from(expected)
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) return null
  try {
    const record = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionRecord
    return typeof record?.exp === 'number' ? record : null
  } catch {
    return null
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

/** DB에 저장된 비밀번호가 있는지 — 최초 설정 여부와 로그인 가능 여부의 유일한 기준. */
export async function hasStoredAdminPassword() {
  return Boolean(await getStoredPassword().catch(() => null))
}

export async function verifyAdminPassword(password: string) {
  // 비밀번호는 DB에 저장된 해시만으로 검증한다 — env 잔존 값이 로그인을
  // 가로채거나 구 비밀번호가 살아나는 일이 없도록 env 경로는 두지 않는다.
  const stored = await getStoredPassword().catch(() => null)
  if (!stored) return false
  return safeEqual(hashPassword(password, stored.salt), stored.hash)
}

export async function setupAdminPassword(newPassword: string) {
  // 저장된 비밀번호가 없으면(env만 있어도) 초기 설정을 허용한다 — 설정된
  // 비밀번호는 env보다 우선 검증되므로 사실상 재설정과 같다.
  if (await getStoredPassword().catch(() => null)) return { ok: false as const, error: 'already_configured' }
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

export async function createAdminSession(actor?: { staffId: string; staffName: string; staffRole: string }) {
  // 버전 조회 실패 시 -1 — 검증 측에서 "확인 불가"로 취급해 무효화를 건너뛴다.
  const record: SessionRecord = { v: await getVersion().catch(() => -1), exp: Date.now() + SESSION_TTL_MS }
  if (actor) {
    record.staffId = actor.staffId
    record.staffName = actor.staffName
    record.staffRole = actor.staffRole
    record.sv = await staffVersion().catch(() => -1)
  }
  const token = await signSession(record)
  // 프로세스 메모리에도 남겨 KV 쓰기가 일시 실패했을 때 같은 인스턴스에서는
  // 세션이 살아 있게 한다.
  db().sessions.set(token, record)
  if (useKv) {
    await kvCommand(['SET', sessionKey(token), JSON.stringify(record), 'PX', SESSION_TTL_MS]).catch((error) => {
      console.warn('[admin-auth] session persist failed; token stays valid statelessly', error)
    })
  } else {
    warnEphemeral()
  }
  return { token, expiresAt: new Date(record.exp).toISOString() }
}

async function getSession(token: string): Promise<SessionRecord | null> {
  const signed = await verifySignedSession(token).catch(() => null)
  if (!useKv) {
    // KV 미구성 — 서명 검증만으로 판단한다(서버리스 인스턴스 간 인메모리 Map이
    // 공유되지 않아 레코드 조회에 의존하면 로그인 직후 세션이 탈락한다).
    if (db().revoked.has(token)) return null
    if (signed) return signed
    // 서명 도입 이전의 레거시 토큰 — 같은 프로세스에 기록이 남아 있을 때만 인정
    const record = db().sessions.get(token) ?? null
    if (record && record.exp < Date.now()) {
      db().sessions.delete(token)
      return null
    }
    return record
  }
  const raw = await kvCommand<string | null>(['GET', sessionKey(token)]).catch(() => undefined)
  if (raw === undefined) {
    // KV 일시 장애 — 명시적 무효화 여부를 알 수 없으므로 서명이 유효한 세션은 유지한다.
    return signed
  }
  if (raw) {
    if (signed) return signed
    try {
      return JSON.parse(raw) as SessionRecord
    } catch {
      return null
    }
  }
  // KV 레코드가 없으면 로그아웃/무효화된 것 — 다만 이 인스턴스가 방금 만든
  // 세션(쓰기 일시 실패)은 로컬 기록으로 인정한다.
  if (signed) return db().sessions.get(token) ?? null
  return null
}

export async function deleteAdminSession(token: string) {
  if (!token) return
  db().sessions.delete(token)
  const revoked = db().revoked
  revoked.add(token)
  if (revoked.size > 10_000) revoked.delete(revoked.values().next().value as string)
  if (useKv) await kvCommand(['DEL', sessionKey(token)]).catch(() => undefined)
}

async function sessionActor(token: string): Promise<AdminActor | null> {
  const session = await getSession(token)
  if (!session) return null
  if (session.exp < Date.now()) {
    await deleteAdminSession(token)
    return null
  }
  // 버전 조회가 실패(KV 일시 장애)하면 불일치로 간주하지 않는다 — 서명과 만료는
  // 이미 검증됐으므로 인프라 오류로 세션을 끊지 않는다. 명확한 불일치만 무효화.
  const currentVersion = await getVersion().catch(() => null)
  if (currentVersion !== null && session.v >= 0 && session.v !== currentVersion) return null
  if (!session.staffId) return MASTER_ACTOR
  // 직원 목록이 수정·삭제되면 버전이 올라 저장된 세션과 달라져 무효화된다.
  const staffVersionAtIssue = session.sv ?? -1
  const currentStaffVersion = await staffVersion().catch(() => null)
  if (currentStaffVersion !== null && staffVersionAtIssue >= 0 && staffVersionAtIssue !== currentStaffVersion) {
    await deleteAdminSession(token)
    return null
  }
  return {
    staffId: session.staffId,
    staffName: session.staffName || session.staffId,
    role: session.staffRole === 'manager' ? 'manager' : 'staff',
  }
}

/** 요청이 관리자 권한을 가지는지 확인하고, 수행 주체(마스터/직원)를 반환한다. */
export async function adminActor(request: Request): Promise<AdminActor | null> {
  const header = request.headers.get('x-admin-key')?.trim()
  const query = new URL(request.url).searchParams.get('key')?.trim()
  const provided = header || query || ''
  if (!provided) return null
  if (await verifyAdminPassword(provided).catch(() => false)) return MASTER_ACTOR
  return sessionActor(provided)
}

export async function isAdminRequest(request: Request) {
  return Boolean(await adminActor(request))
}

/** OTP 시크릿 — DB에 저장된 값만 사용한다(초기 설정 플로우가 생성). */
async function getTotpSecret(): Promise<string | null> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', TOTP_KEY]).catch(() => null)
    return raw?.trim() || null
  }
  return db().totpSecret
}

/**
 * 초기 설정 플로우용 — 시크릿이 없으면 새로 생성해 저장하고 Google OTP용
 * otpauth:// URI까지 반환한다.
 */
export async function provisionTotpSecret(): Promise<{ secret: string; uri: string; created: boolean }> {
  const existing = await getTotpSecret()
  const secret = existing || randomTotpSecret()
  if (!existing) {
    if (useKv) {
      await kvCommand(['SET', TOTP_KEY, secret]).catch((error) => {
        console.warn('[admin-auth] totp secret persist failed', error)
      })
    } else {
      db().totpSecret = secret
    }
  }
  const uri = `otpauth://totp/TaxiTago:admin?secret=${secret}&issuer=TaxiTago`
  return { secret, uri, created: !existing }
}

export async function resetAdminPassword(code: string, newPassword: string) {
  const secret = await getTotpSecret()
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
