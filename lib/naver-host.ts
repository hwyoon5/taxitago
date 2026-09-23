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
  const forwardedProto = (request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')).split(',')[0].trim() || 'http'
  return (
    originFromUrl(request.headers.get('origin') || '') ||
    originFromUrl(request.headers.get('referer') || '') ||
    (forwardedHost ? originFromUrl(`${forwardedProto}://${forwardedHost}`) : '') ||
    originFromUrl(url.origin)
  )
}

/** Origins NCP Web Service URL may list. Official docs want host only, e.g. http://localhost not http://localhost:3000. */
export function naverRefererCandidates(request?: Request) {
  const live = requestLiveOrigin(request)
  const listed = (process.env.NAVER_MAP_WEB_SERVICE_URL || process.env.NEXT_PUBLIC_SITE_URL || '')
    .split(/[, \n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const fallbacks = ['https://taxitago.co.kr', 'http://localhost', 'http://127.0.0.1', 'http://localhost:3000', 'http://127.0.0.1:3000']
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
  if (host.endsWith('.pstatic.net')) return true
  return false
}

export async function fetchNaverWithFlexibleHost(url: string, init: RequestInit, request?: Request) {
  const headerSets: Array<Record<string, string>> = naverRefererCandidates(request).map((origin) => ({
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

export function rewriteNaverSdkUrls(body: string) {
  const authPage = JSON.stringify(naverMapsAuthPageUrl())
  return body
    .replaceAll('(et?"https":"http")+"://oapi.map.naver.com', '"/api/naver-maps/upstream/oapi.map.naver.com')
    .replaceAll('(et?"https":"http")+"://openapi.map.naver.com', '"/api/naver-maps/upstream/openapi.map.naver.com')
    .replace(
      'k=/(o|open)api\\.map\\.naver\\.com\\/openapi\\/v3\\/maps\\.js\\b/',
      'k=/(?:(?:o|open)api\\.map\\.naver\\.com\\/openapi\\/v3\\/maps\\.js|naver-maps\\/sdk)\\b/',
    )
    .replace(
      /D=\(t\.location\.href\+""\)/g,
      `D=(function(){var h=String(t.location.href||"");try{var u=new URL(h);if(/^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/i.test(u.hostname)||/^(10|192\\.168)\\.|172\\.(1[6-9]|2\\d|3[0-1])\\./.test(u.hostname))return ${authPage}}catch(e){}return h})()`,
    )
}
