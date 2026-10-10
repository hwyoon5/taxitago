import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { kvCommand, kvConfigured } from '@/lib/kv'

/**
 * 가입자 레지스트리 — Pi uid 기준의 영속 사용자 디렉터리.
 * partner-ledger-server(인메모리)와 달리 KV/파일에 영속되어 서버리스
 * 인스턴스 간에도 목록·정지(Lock) 상태가 유지된다. /api/partner/link가
 * 연동할 때마다 upsert하고, 관리자 가입자 관리 API가 읽는다.
 */
export type RegistryUser = {
  uid: string
  username: string
  wallet: string
  role?: string
  name?: string
  phone?: string
  detail?: string
  vehicle?: string
  plate?: string
  region?: string
  serviceType?: string
  insuranceCompany?: string
  insurancePolicyNo?: string
  insuranceExpiresAt?: string
  insuranceDocName?: string
  insuranceDocAt?: string
  linkedAt: string
  updatedAt: string
  /** 이용 정지(Lock) — 설정되면 로그인·호출·결제·출금이 차단된다. */
  lockedAt?: string
  lockedBy?: string
  lockReason?: string
  /** 회원탈퇴 시각 — 찍히면 프로필 필드는 비워지고 uid·지갑·가입일만 감사용으로 남는다. */
  withdrawnAt?: string
}

const useKv = kvConfigured
const USERS_KEY = 'taxitago:user-registry'
const filePath = path.join(process.cwd(), 'data', 'user-registry.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoUserRegistry?: Record<string, RegistryUser> }
if (!globalStore.__taxitagoUserRegistry) globalStore.__taxitagoUserRegistry = {}

function readFileUsers(): Record<string, RegistryUser> {
  try {
    if (!existsSync(filePath)) return {}
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { users?: Record<string, RegistryUser> }
    return parsed.users && typeof parsed.users === 'object' ? parsed.users : {}
  } catch {
    return {}
  }
}

function writeFileUsers(users: Record<string, RegistryUser>) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ users }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readUsers(): Promise<Record<string, RegistryUser>> {
  if (useKv) {
    try {
      const raw = await kvCommand<string | null>(['GET', USERS_KEY])
      if (!raw) return {}
      const parsed = JSON.parse(raw) as Record<string, RegistryUser>
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      console.error('[users] registry kv read failed; using local fallback', error)
      if (!Object.keys(globalStore.__taxitagoUserRegistry!).length) {
        globalStore.__taxitagoUserRegistry = readFileUsers()
      }
      return globalStore.__taxitagoUserRegistry!
    }
  }
  if (!Object.keys(globalStore.__taxitagoUserRegistry!).length) {
    globalStore.__taxitagoUserRegistry = readFileUsers()
  }
  return globalStore.__taxitagoUserRegistry!
}

async function writeUsers(users: Record<string, RegistryUser>) {
  if (useKv) {
    try {
      await kvCommand(['SET', USERS_KEY, JSON.stringify(users)])
      return
    } catch (error) {
      console.error('[users] registry kv write failed; falling back to local', error)
    }
  }
  globalStore.__taxitagoUserRegistry = users
  writeFileUsers(users)
}

const text = (value: unknown, fallback?: string) => {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

/** 연동/프로필 갱신마다 레지스트리를 최신화한다 — linkedAt(가입일)은 최초 값을 보존. */
export async function upsertRegistryUser(input: {
  uid: string
  username?: string
  wallet?: string
  role?: string
  name?: string
  phone?: string
  detail?: string
  vehicle?: string
  plate?: string
  region?: string
  serviceType?: string
  insuranceCompany?: string
  insurancePolicyNo?: string
  insuranceExpiresAt?: string
  insuranceDocName?: string
  insuranceDocAt?: string
  linkedAt?: string
}): Promise<RegistryUser | null> {
  const uid = input.uid.trim()
  if (!uid) return null
  const users = await readUsers()
  const prev = users[uid]
  const next: RegistryUser = {
    uid,
    username: text(input.username, prev?.username) || uid,
    wallet: text(input.wallet, prev?.wallet) || '',
    role: text(input.role, prev?.role),
    name: text(input.name, prev?.name),
    phone: text(input.phone, prev?.phone),
    detail: text(input.detail, prev?.detail),
    vehicle: text(input.vehicle, prev?.vehicle),
    plate: text(input.plate, prev?.plate),
    region: text(input.region, prev?.region),
    serviceType: text(input.serviceType, prev?.serviceType),
    insuranceCompany: text(input.insuranceCompany, prev?.insuranceCompany),
    insurancePolicyNo: text(input.insurancePolicyNo, prev?.insurancePolicyNo),
    insuranceExpiresAt: text(input.insuranceExpiresAt, prev?.insuranceExpiresAt),
    insuranceDocName: text(input.insuranceDocName, prev?.insuranceDocName),
    insuranceDocAt: text(input.insuranceDocAt, prev?.insuranceDocAt),
    linkedAt: text(input.linkedAt, prev?.linkedAt) || prev?.linkedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lockedAt: prev?.lockedAt,
    lockedBy: prev?.lockedBy,
    lockReason: prev?.lockReason,
    // 재가입(재연동)이면 이전 탈퇴 마킹을 해제한다 — 복귀 이용자는 정상 계정이다.
    withdrawnAt: undefined,
  }
  users[uid] = next
  await writeUsers(users)
  return next
}

export async function getRegistryUser(uid: string): Promise<RegistryUser | null> {
  const users = await readUsers()
  return users[uid.trim()] ?? null
}

/**
 * 회원탈퇴 — 프로필·서비스 필드(역할·이름·연락처·차량·보험 등)를 지우고
 * withdrawnAt을 찍는다. uid·username·지갑·가입일·정지 상태는 감사·Lock
 * 추적용으로 보존하고, 재가입 시 옛 프로필이 되살아나지 않게 한다.
 */
export async function markRegistryUserWithdrawn(uid: string): Promise<RegistryUser | null> {
  const users = await readUsers()
  const user = users[uid.trim()]
  if (!user) return null
  const next: RegistryUser = {
    uid: user.uid,
    username: user.username,
    wallet: user.wallet,
    linkedAt: user.linkedAt,
    updatedAt: new Date().toISOString(),
    lockedAt: user.lockedAt,
    lockedBy: user.lockedBy,
    lockReason: user.lockReason,
    withdrawnAt: new Date().toISOString(),
  }
  users[user.uid] = next
  await writeUsers(users)
  return next
}

export async function listRegistryUsers(): Promise<RegistryUser[]> {
  const users = await readUsers()
  return Object.values(users).sort((a, b) => b.linkedAt.localeCompare(a.linkedAt))
}

/** 이용 정지 토글 — 대상 uid의 레코드에만 플래그를 쓴다. */
export async function setUserLock(
  uid: string,
  locked: boolean,
  meta: { by?: string; reason?: string } = {},
): Promise<RegistryUser | null> {
  const users = await readUsers()
  const user = users[uid.trim()]
  if (!user) return null
  if (locked) {
    user.lockedAt = new Date().toISOString()
    user.lockedBy = (meta.by || '').slice(0, 60)
    user.lockReason = (meta.reason || '').slice(0, 120)
  } else {
    delete user.lockedAt
    delete user.lockedBy
    delete user.lockReason
  }
  user.updatedAt = new Date().toISOString()
  await writeUsers(users)
  return user
}

/** uid 또는 지갑 주소로 정지 여부 조회 — 로그인·호출·결제·출금 차단 게이트. */
export async function findLockedUser(uid: string, wallet?: string): Promise<RegistryUser | null> {
  const users = await readUsers()
  const u = uid.trim()
  const w = (wallet || '').trim()
  for (const user of Object.values(users)) {
    if (!user.lockedAt) continue
    if (u && user.uid === u) return user
    if (w && user.wallet === w) return user
  }
  return null
}

export async function isUserLocked(uid: string, wallet?: string): Promise<boolean> {
  return Boolean(await findLockedUser(uid, wallet).catch(() => null))
}

/** 가입 통계 — 총계·이번 달·최근 6개월 월별 추이(대시보드 카드/그래프용). */
export function registryStats(users: RegistryUser[]) {
  const now = new Date()
  const thisMonth = now.toISOString().slice(0, 7)
  const monthly: { month: string; count: number }[] = []
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthly.push({ month: d.toISOString().slice(0, 7), count: 0 })
  }
  const buckets = new Map(monthly.map((m) => [m.month, m]))
  let joinedThisMonth = 0
  let drivers = 0
  let locked = 0
  for (const user of users) {
    const month = (user.linkedAt || '').slice(0, 7)
    if (month === thisMonth) joinedThisMonth += 1
    const bucket = buckets.get(month)
    if (bucket) bucket.count += 1
    if (user.role === '기사' || user.role === '파트너') drivers += 1
    if (user.lockedAt) locked += 1
  }
  return { total: users.length, joinedThisMonth, drivers, locked, monthly }
}

/** 가입자 검색 — 이름/아이디/전화/지갑/uid 부분 일치(소문자). */
export function matchUserQuery(user: RegistryUser, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [user.name, user.username, user.phone, user.wallet, user.uid, user.plate]
    .filter((v): v is string => Boolean(v))
    .some((v) => v.toLowerCase().includes(q))
}
