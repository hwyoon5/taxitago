import { apiFetch } from '@/lib/app-origin'
import { adminHeaders } from '@/lib/admin-key'

/** 관리자 편집 잠금 — 서버(/api/admin/lock)가 소유자·TTL을 관리한다. */
export type EditLockInfo = { staffId: string; staffName: string; acquiredAt: string }
export type EditLockKind = 'ticket' | 'lost' | 'user' | 'partner'

type LockResult = { self: boolean; holder: string }

async function call(method: 'POST' | 'PUT' | 'DELETE', kind: EditLockKind, id: string) {
  const res = await apiFetch('/api/admin/lock', {
    method,
    headers: { 'Content-Type': 'application/json', ...adminHeaders() },
    body: JSON.stringify({ kind, id }),
  })
  const data = (await res.json().catch(() => null)) as { ok?: boolean; lock?: EditLockInfo | null; error?: string } | null
  return { res, data }
}

/**
 * 잠금 획득 — self=true면 본인이 소유, false면 다른 관리자(holder 이름)가 편집 중.
 * 서버 장애로 확인이 안 되면 self=true로 수렴해 편집을 막지 않는다(저장 단계의
 * 낙관적 동시성 제어가 덮어쓰기를 막는다).
 */
export async function acquireEditLock(kind: EditLockKind, id: string): Promise<LockResult> {
  try {
    const { res, data } = await call('POST', kind, id)
    if (res.status === 409) return { self: false, holder: data?.lock?.staffName || '다른' }
    return { self: true, holder: '' }
  } catch {
    return { self: true, holder: '' }
  }
}

export async function renewEditLock(kind: EditLockKind, id: string) {
  try {
    const { res, data } = await call('PUT', kind, id)
    return { self: res.status !== 409 && res.ok, holder: data?.lock?.staffName || '' }
  } catch {
    return { self: true, holder: '' }
  }
}

export async function releaseEditLock(kind: EditLockKind, id: string) {
  try {
    await call('DELETE', kind, id)
  } catch {
    undefined
  }
}
