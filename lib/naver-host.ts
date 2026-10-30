function stripSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function originFromUrl(value: string) {
  const raw = (value || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw.includes('://') ? raw : `http://${raw}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return stripSlash(`${url.protocol}//${url.host}`)
  } catch {
    return ''
  }
}

function hostOnlyOrigin(origin: string) {
  try {
    const url = new URL(origin)
    return stripSlash(`${url.protocol}//${url.hostname}`)
  } catch {
    return ''
  }
}

function isLoopbackOrPrivateHost(hostname: string) {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  return false
}

function pushOrigin(target: string[], seen: Set<string>, raw: string) {
  const origin = originFromUrl(raw)
  if (!origin || seen.has(origin)) return
  seen.add(origin)
  target.push(origin)
  const withoutPort = hostOnlyOrigin(origin)
  if (withoutPort && !seen.has(withoutPort)) {
    seen.add(withoutPort)
    target.push(withoutPort)
  }
}

export function requestLiveOrigin(request?: Request) {
  if (!request) return ''
  const url = new URL(request.url)
  const forwardedHost = (request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host).split(',')[0].trim()
  const forwardedProto = (request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')).split(',')[0].trim()
  const hostname = forwardedHost.split(':')[0]
  const proto = !hostname || isLoopbackOrPrivateHost(hostname) ? (forwardedProto === 'https' ? 'https' : 'http') : 'https'
  const fromRequest = (value: string) => {
    const origin = originFromUrl(value)
    if (!origin) return ''
    try {
      const parsed = new URL(origin)
      if (!isLoopbackOrPrivateHost(parsed.hostname) && parsed.protocol === 'http:') parsed.protocol = 'https:'
      return stripSlash(parsed.origin)
    } catch {
      return origin
    }
  }
  return (
    fromRequest(request.headers.get('origin') || '') ||
    fromRequest(request.headers.get('referer') || '') ||
    (forwardedHost ? fromRequest(`${proto}://${forwardedHost}`) : '') ||
    fromRequest(url.origin)
  )
}

/** Origins NCP Web Service URL may list. Official docs want host only, e.g. http://localhost not http://localhost:3000. */
export function naverRefererCandidates(request?: Request) {
  const live = requestLiveOrigin(request)
  const listed = (process.env.NAVER_MAP_WEB_SERVICE_URL || process.env.NEXT_PUBLIC_SITE_URL || '')
    .split(/[, \n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const fallbacks = ['https://taxitago.co.kr', 'https://test.taxitago.co.kr', 'http://localhost', 'http://127.0.0.1', 'http://localhost:3000', 'http://127.0.0.1:3000']
  const ordered: string[] = []
  const seen = new Set<string>()
  const liveIsPrivate = live ? isLoopbackOrPrivateHost(new URL(live).hostname) : false
  if (liveIsPrivate) {
    listed.forEach((item) => pushOrigin(ordered, seen, item))
    fallbacks.forEach((item) => pushOrigin(ordered, seen, item))
    if (live) pushOrigin(ordered, seen, live)
  } else {
    if (live) pushOrigin(ordered, seen, live)
    listed.forEach((item) => pushOrigin(ordered, seen, item))
    fallbacks.forEach((item) => pushOrigin(ordered, seen, item))
  }
  return ordered
}

export function isAllowedNaverAssetHost(hostname: string) {
  const host = (hostname || '').toLowerCase()
  if (!host) return false
  if (host === 'oapi.map.naver.com' || host === 'openapi.map.naver.com') return true
  if (host === 'nrb.map.naver.net' || host === 'nrbe.map.naver.net') return true
  if (host.endsWith('.pstatic.net')) return true
  return false
}

export async function fetchNaverWithFlexibleHost(url: string, init: RequestInit, request?: Request, refererOrigins?: string[]) {
  const candidates = refererOrigins?.length ? refererOrigins : naverRefererCandidates(request)
  const headerSets: Array<Record<string, string>> = candidates.map((origin) => ({
    Referer: `${origin}/`,
    Origin: origin,
  }))
  headerSets.push({})
  let last: Response | null = null
  for (const extra of headerSets) {
    try {
      const headers = new Headers(init.headers)
      for (const [key, value] of Object.entries(extra)) headers.set(key, value)
      const response = await fetch(url, { ...init, headers, cache: 'no-store' })
      last = response
      if (response.ok) return response
    } catch {
      continue
    }
  }
  return last
}

export function naverMapsAuthPageUrl() {
  const listed = (process.env.NAVER_MAP_WEB_SERVICE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://taxitago.co.kr')
    .split(/[, \n]+/)
    .map((item) => item.trim())
    .find((item) => {
      const origin = originFromUrl(item)
      if (!origin) return false
      try {
        return !isLoopbackOrPrivateHost(new URL(origin).hostname)
      } catch {
        return false
      }
    })
  const origin = originFromUrl(listed || 'https://taxitago.co.kr') || 'https://taxitago.co.kr'
  return `${origin}/`
}

/** Origins registered in NCP console > Application > Web service URL (env list + primary auth page). */
export function naverRegisteredOrigins() {
  const listed = (process.env.NAVER_MAP_WEB_SERVICE_URL || process.env.NEXT_PUBLIC_SITE_URL || '')
    .split(/[, \n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  listed.push(naverMapsAuthPageUrl())
  const seen = new Set<string>()
  const origins: string[] = []
  for (const item of listed) {
    const origin = originFromUrl(item)
    if (origin && !seen.has(origin)) {
      seen.add(origin)
      origins.push(origin)
    }
  }
  return origins
}

/**
 * Auth endpoints (v3/auth, v1/validatev3) carry the page URL as url=/uri=.
 * When that origin is not registered in the NCP console, swap in the primary
 * registered page URL so the check passes on any host (test domain, previews,
 * localhost) — the upstream call is then made with the matching Referer.
 */
export function rewriteNaverAuthTarget(target: string) {
  try {
    const url = new URL(target)
    if (!/\/(?:v3\/auth|v1\/validatev3)\/?$/i.test(url.pathname)) return { target, authEndpoint: false }
    const registered = new Set(naverRegisteredOrigins())
    const authPage = naverMapsAuthPageUrl()
    for (const key of ['url', 'uri']) {
      const value = url.searchParams.get(key)
      if (!value) continue
      const origin = originFromUrl(value)
      if (!origin || !registered.has(origin)) url.searchParams.set(key, authPage)
    }
    return { target: url.toString(), authEndpoint: true }
  } catch {
    return { target, authEndpoint: false }
  }
}

export function rewriteNaverSdkUrls(body: string) {
  const authPage = JSON.stringify(naverMapsAuthPageUrl())
  const registered = JSON.stringify(naverRegisteredOrigins())
  return body
    // Route the auth endpoints through the same-origin proxy. The minified
    // scheme-chooser identifier changes between SDK builds — match any name.
    .replace(
      /\([\w$]+\?"https":"http"\)\+":\/\/(oapi|openapi)\.map\.naver\.com(\/v(?:3\/auth|1\/validatev3))"/g,
      '"/api/naver-maps/upstream/$1.map.naver.com$2/"',
    )
    // The SDK only reads credentials from a <script> whose src matches this
    // regex; widen it so the proxied /api/naver-maps/sdk URL is recognized.
    .replace(
      /\(o\|open\)api\\\.map\\\.naver\\\.com\\\/openapi\\\/v3\\\/maps\\\.js\\b/g,
      '(?:(?:o|open)api\\.map\\.naver\\.com\\/openapi\\/v3\\/maps\\.js|naver-maps\\/sdk)\\b',
    )
    // Auth posts the page URL as url=/uri= — substitute a registered origin
    // when this host is not in the registered Web service URL list.
    .replace(
      /([\w$]+)\.location\.href\+""/g,
      `(function(){var h=String($1.location.href||"");try{var o=new URL(h).origin;if(${registered}.indexOf(o)>=0)return h}catch(e){}return ${authPage}})()`,
    )
}
