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
