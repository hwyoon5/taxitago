import { kvCommand, kvConfigured } from '@/lib/kv'

/**
 * 관리자 편집 잠금 — 한 명의 직원이 문의/분실물 상세를 편집하는 동안 다른
 * 직원의 동시 수정을 막는 단기 락. KV의 SET NX PX로 원자 획득하고,
 * 소유자가 나가거나 브라우저가 죽으면 TTL(90초)로 자동 해제된다.
 * 클라이언트는 편집 중 30초마다 renew로 TTL을 연장한다.
 */
export type EditLockHolder = { staffId: string; staffName: string }
export type EditLock = EditLockHolder & { acquiredAt: string }

type LockDoc = EditLock & { expiresAt: number }

export const EDIT_LOCK_TTL_MS = 90_000
export const EDIT_LOCK_KINDS = ['ticket', 'lost', 'user', 'partner'] as const
export type EditLockKind = (typeof EDIT_LOCK_KINDS)[number]

const keyOf = (kind: string, id: string) => `taxitago:adminlock:${kind}:${id}`

const mem = globalThis as typeof globalThis & { __taxitagoEditLocks?: Map<string, LockDoc> }
if (!mem.__taxitagoEditLocks) mem.__taxitagoEditLocks = new Map()

function memGet(key: string): LockDoc | null {
  const doc = mem.__taxitagoEditLocks!.get(key) ?? null
  if (doc && doc.expiresAt <= Date.now()) {
    mem.__taxitagoEditLocks!.delete(key)
    return null
  }
  return doc
}

async function kvGet(key: string): Promise<LockDoc | null> {
  try {
    const raw = await kvCommand<string | null>(['GET', key])
    if (!raw) return null
    const parsed = JSON.parse(raw) as LockDoc
    return parsed && typeof parsed.staffId === 'string' ? parsed : null
  } catch {
    return null
  }
}

const docFor = (holder: EditLockHolder): LockDoc => ({
  staffId: holder.staffId,
  staffName: holder.staffName,
  acquiredAt: new Date().toISOString(),
  expiresAt: Date.now() + EDIT_LOCK_TTL_MS,
})

const publicLock = (doc: LockDoc): EditLock => ({ staffId: doc.staffId, staffName: doc.staffName, acquiredAt: doc.acquiredAt })

/** 잠금 획득 — 성공 또는 현재 소유자 정보를 돌려준다. 같은 소유자의 재획득은 갱신으로 처리. */
export async function acquireEditLock(kind: EditLockKind, id: string, holder: EditLockHolder) {
  const key = keyOf(kind, id)
  const doc = docFor(holder)
  if (kvConfigured) {
    // NX + PX — 키가 없을 때만 원자적으로 세팅되고 TTL도 함께 박힌다.
    const res = await kvCommand<string | null>(['SET', key, JSON.stringify(doc), 'PX', EDIT_LOCK_TTL_MS, 'NX']).catch(() => null)
    if (res === 'OK') return { ok: true as const, lock: publicLock(doc) }
    const existing = await kvGet(key)
    if (existing && existing.staffId === holder.staffId) {
      await kvCommand(['SET', key, JSON.stringify(doc), 'PX', EDIT_LOCK_TTL_MS]).catch(() => undefined)
      return { ok: true as const, lock: publicLock(doc) }
    }
    return { ok: false as const, lock: existing ? publicLock(existing) : null }
  }
  const existing = memGet(key)
  if (existing && existing.staffId !== holder.staffId) {
    return { ok: false as const, lock: publicLock(existing) }
  }
  mem.__taxitagoEditLocks!.set(key, doc)
  return { ok: true as const, lock: publicLock(doc) }
}

/** 소유자의 TTL 연장 — 다른 소유자가 쥐고 있으면 현재 소유자를 돌려준다. */
export async function renewEditLock(kind: EditLockKind, id: string, holder: EditLockHolder) {
  const key = keyOf(kind, id)
  const doc = docFor(holder)
  if (kvConfigured) {
    const existing = await kvGet(key)
    if (!existing || existing.staffId === holder.staffId) {
      await kvCommand(['SET', key, JSON.stringify(doc), 'PX', EDIT_LOCK_TTL_MS]).catch(() => undefined)
      return { ok: true as const, lock: publicLock(doc) }
    }
    return { ok: false as const, lock: publicLock(existing) }
  }
  const existing = memGet(key)
  if (existing && existing.staffId !== holder.staffId) {
    return { ok: false as const, lock: publicLock(existing) }
  }
  mem.__taxitagoEditLocks!.set(key, doc)
  return { ok: true as const, lock: publicLock(doc) }
}

export async function releaseEditLock(kind: EditLockKind, id: string, holder: EditLockHolder) {
  const key = keyOf(kind, id)
  if (kvConfigured) {
    const existing = await kvGet(key)
    if (existing && existing.staffId !== holder.staffId) return false
    await kvCommand(['DEL', key]).catch(() => undefined)
    return true
  }
  const existing = memGet(key)
  if (existing && existing.staffId !== holder.staffId) return false
  mem.__taxitagoEditLocks!.delete(key)
  return true
}

export async function editLockStatus(kind: EditLockKind, id: string): Promise<EditLock | null> {
  if (kvConfigured) {
    const doc = await kvGet(keyOf(kind, id))
    return doc ? publicLock(doc) : null
  }
  const doc = memGet(keyOf(kind, id))
  return doc ? publicLock(doc) : null
}
