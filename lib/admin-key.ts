const STORAGE_KEY = 'taxitago.admin.key'

export function getAdminKey() {
  if (typeof window === 'undefined') return ''
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored) return stored
  // sessionStorage 시대 토큰 마이그레이션 — 새 탭에서도 세션이 유지되도록
  // 영구 저장소로 옮긴다.
  const legacy = window.sessionStorage.getItem(STORAGE_KEY)
  if (legacy) {
    window.localStorage.setItem(STORAGE_KEY, legacy)
    window.sessionStorage.removeItem(STORAGE_KEY)
    return legacy
  }
  return ''
}

export function setAdminKey(key: string) {
  if (typeof window === 'undefined') return
  const value = key.trim()
  if (value) window.localStorage.setItem(STORAGE_KEY, value)
  else window.localStorage.removeItem(STORAGE_KEY)
  window.sessionStorage.removeItem(STORAGE_KEY)
}

export function adminHeaders(): Record<string, string> {
  const key = getAdminKey()
  return key ? { 'x-admin-key': key } : {}
}

export async function adminLogin(password: string, staffId?: string) {
  const res = await fetch('/api/admin/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(staffId?.trim() ? { staffId: staffId.trim(), password } : { password }),
  })
  const data = (await res.json().catch(() => null)) as { token?: string; expiresAt?: string; error?: string } | null
  if (!res.ok || !data?.token) throw new Error(data?.error || 'login_failed')
  setAdminKey(data.token)
  return data
}

export type AdminSetupResult = {
  token?: string
  expiresAt?: string
  totpSecret?: string
  otpauthUri?: string
  qrDataUrl?: string
  error?: string
}

export async function adminSetup(password: string): Promise<AdminSetupResult> {
  const res = await fetch('/api/admin/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'setup', password }),
  })
  const data = (await res.json().catch(() => null)) as AdminSetupResult | null
  if (!res.ok || !data?.token) throw new Error(data?.error || 'setup_failed')
  setAdminKey(data.token)
  return data
}

export async function adminLogout() {
  const token = getAdminKey()
  setAdminKey('')
  if (!token) return
  await fetch('/api/admin/auth', { method: 'DELETE', headers: { 'x-admin-key': token } }).catch(() => undefined)
}

export async function adminResetPassword(code: string, newPassword: string) {
  const res = await fetch('/api/admin/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, newPassword }),
  })
  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
  if (!res.ok || !data?.ok) throw new Error(data?.error || 'reset_failed')
}
