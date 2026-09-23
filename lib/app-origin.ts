function toRelativeApiPath(path: string) {
  const raw = String(path || '').trim()
  if (!raw) return '/'
  try {
    if (/^https?:\/\//i.test(raw)) {
      const parsed = new URL(raw)
      return `${parsed.pathname || '/'}${parsed.search || ''}`
    }
  } catch {
    undefined
  }
  return raw.startsWith('/') ? raw : `/${raw}`
}

export function localApiUrls(path: string, query?: string | URLSearchParams) {
  const relative = toRelativeApiPath(path)
  const qIndex = relative.indexOf('?')
  const pathname = (qIndex >= 0 ? relative.slice(0, qIndex) : relative).replace(/\/+$/, '') || ''
  const existingSearch = qIndex >= 0 ? relative.slice(qIndex + 1) : ''
  const extra = query
    ? String(query).replace(/^\?/, '')
    : ''
  const merged = [existingSearch, extra].filter(Boolean).join('&')
  const search = merged ? `?${merged}` : ''
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`
  return [...new Set([`${normalized}${search}`, `${normalized}/${search}`])]
}

export function localEventSourceUrl(path: string, query?: string | URLSearchParams) {
  return localApiUrls(path, query)[0]
}

export async function apiFetch(path: string, init?: RequestInit) {
  const urls = localApiUrls(toRelativeApiPath(path))
  let lastResponse: Response | undefined
  let lastError: unknown
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: 'no-store', ...init })
      lastResponse = response
      if (response.ok) return response
      if (response.status === 404 || response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
        continue
      }
      return response
    } catch (error) {
      lastError = error
    }
  }
  if (lastResponse) return lastResponse
  throw lastError instanceof Error ? lastError : new Error('local api request failed')
}
