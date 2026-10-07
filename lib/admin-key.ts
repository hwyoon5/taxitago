const STORAGE_KEY = 'taxitago.admin.key'

export function getAdminKey() {
  if (typeof window === 'undefined') return ''
  return window.sessionStorage.getItem(STORAGE_KEY) || ''
}

export function setAdminKey(key: string) {
  if (typeof window === 'undefined') return
  const value = key.trim()
  if (value) window.sessionStorage.setItem(STORAGE_KEY, value)
  else window.sessionStorage.removeItem(STORAGE_KEY)
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

export async function adminSetup(password: string) {
  const res = await fetch('/api/admin/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'setup', password }),
  })
  const data = (await res.json().catch(() => null)) as { token?: string; expiresAt?: string; error?: string } | null
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
