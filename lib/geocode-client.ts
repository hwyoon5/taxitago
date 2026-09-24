export const ADDRESS_LOADING = '새로운 주소를 불러오는 중...'

export function fallbackCoordAddress(lat: number, lng: number) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

const REVERSE_FAIL_LABEL = '주소를 찾을 수 없습니다'

function displayReverseLabel(value: string) {
  const label = value.trim()
  if (!label || isCoordText(label)) return ''
  if (/확인하는 중|수신하는 중|불러오는 중|갱신하는 중/.test(label)) return ''
  return label
}

export function createLiveAddressLookup(
  apply: (lat: number, lng: number, address: string) => void,
  intervalMs = 220,
) {
  let timer = 0
  let lastFire = 0
  let requestId = 0
  let wanted: { lat: number; lng: number } | null = null
  const fire = () => {
    if (!wanted) return
    window.clearTimeout(timer)
    const lat = wanted.lat
    const lng = wanted.lng
    const id = ++requestId
    const liveLat = Number(lat)
    const liveLng = Number(lng)
    lastFire = Date.now()
    runApartFromCaller(() => {
      void lookupAddressFromApi(liveLat, liveLng)
        .then((label) => {
          if (id !== requestId) return
          apply(liveLat, liveLng, displayReverseLabel(label) || REVERSE_FAIL_LABEL)
        })
        .catch(() => {
          if (id !== requestId) return
          apply(liveLat, liveLng, REVERSE_FAIL_LABEL)
        })
    })
  }
  return {
    run(lat: number, lng: number) {
      const nextLat = Number(lat)
      const nextLng = Number(lng)
      if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return
      wanted = { lat: nextLat, lng: nextLng }
      const wait = lastFire ? Math.max(0, intervalMs - (Date.now() - lastFire)) : 0
      window.clearTimeout(timer)
      if (wait === 0) fire()
      else timer = window.setTimeout(fire, wait)
    },
    flush() {
      if (!wanted) return
      lastFire = 0
      fire()
    },
    stop() {
      requestId += 1
      window.clearTimeout(timer)
      wanted = null
      lastFire = 0
    },
  }
}

const jsonHeaders = { Accept: 'application/json' } as const

const ADDRESS_LOOKUP_TIMEOUT_MS = 6000

function pageOrigin() {
  if (typeof window === 'undefined') return ''
  const origin = window.location.origin
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin
  return origin.replace(/^http:/i, 'https:')
}

function geocodeCandidates(search: string) {
  const query = search.startsWith('?') ? search : `?${search}`
  const paths = [`/api/geocode/${query}`, `/api/geocode${query}`]
  const origin = pageOrigin()
  if (!origin) return paths
  return paths.map((path) => new URL(path, origin).href)
}

function httpsLocation(current: string, location: string) {
  try {
    const next = new URL(location, current)
    if (next.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/i.test(next.hostname)) next.protocol = 'https:'
    if (next.protocol !== 'https:' && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(next.origin)) return ''
    return next.href
  } catch {
    return ''
  }
}

function isCoordText(value: string) {
  return /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(value.trim())
}

async function readGeocodeResponse(response: Response) {
  if (!response.ok) return null
  const text = await response.text()
  const body = text.trim()
  if (!body.startsWith('{') && !body.startsWith('[')) return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return null
  }
}

async function fetchGeocodeJson(search: string, signal?: AbortSignal) {
  const seen = new Set<string>()
  const queue = geocodeCandidates(search)
  while (queue.length) {
    const url = queue.shift()
    if (!url || seen.has(url)) continue
    seen.add(url)
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'manual',
        signal,
        headers: jsonHeaders,
      })
      if (response.status >= 300 && response.status < 400) {
        const next = httpsLocation(url, response.headers.get('location') || '')
        if (next) queue.push(next)
        continue
      }
      const data = await readGeocodeResponse(response)
      if (data) return data
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
    }
  }
  return null
}

async function fetchReverseJson(search: string, signal?: AbortSignal) {
  const seen = new Set<string>()
  const queue = geocodeCandidates(search)
  while (queue.length) {
    const url = queue.shift()
    if (!url || seen.has(url)) continue
    seen.add(url)
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'follow',
        signal,
        headers: jsonHeaders,
      })
      const data = await readGeocodeResponse(response)
      if (data) return data
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
    }
  }
  return null
}

export async function lookupAddressFromApi(lat: number, lng: number, signal?: AbortSignal) {
  const liveLat = Number(lat)
  const liveLng = Number(lng)
  if (!Number.isFinite(liveLat) || !Number.isFinite(liveLng) || Math.abs(liveLat) > 90 || Math.abs(liveLng) > 180) {
    return REVERSE_FAIL_LABEL
  }
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), ADDRESS_LOOKUP_TIMEOUT_MS)
  const onCallerAbort = () => timeout.abort()
  signal?.addEventListener('abort', onCallerAbort, { once: true })
  let settled = false
  const finish = (value: string) => {
    if (settled) return value
    settled = true
    return value
  }
  try {
    const data = await Promise.race([
      fetchReverseJson(`lat=${encodeURIComponent(String(liveLat))}&lng=${encodeURIComponent(String(liveLng))}`, timeout.signal).catch((error) => {
        if (signal?.aborted) throw error
        return null
      }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), ADDRESS_LOOKUP_TIMEOUT_MS)
      }),
    ])
    const payload = data as { address?: unknown } | null
    const label = typeof payload?.address === 'string' ? displayReverseLabel(payload.address) : ''
    return finish(label || REVERSE_FAIL_LABEL)
  } catch (error) {
    if (signal?.aborted) throw error
    return finish(REVERSE_FAIL_LABEL)
  } finally {
    clearTimeout(timer)
    timeout.abort()
    signal?.removeEventListener('abort', onCallerAbort)
  }
}

function runApartFromCaller(task: () => void) {
  const safe = () => {
    try {
      task()
    } catch (error) {
      console.error('[geocode] lookup start failed', error)
    }
  }
  try {
    if (typeof queueMicrotask === 'function') queueMicrotask(safe)
    else setTimeout(safe, 0)
  } catch (error) {
    console.error('[geocode] lookup schedule failed', error)
    safe()
  }
}

export function requestAddressLookup(lat: number, lng: number, onAddress: (address: string) => void) {
  const liveLat = Number(lat)
  const liveLng = Number(lng)
  let sent = false
  const deliver = (address: string) => {
    if (sent) return
    sent = true
    try {
      onAddress(displayReverseLabel(address) || REVERSE_FAIL_LABEL)
    } catch (error) {
      console.error('[geocode] address apply failed', error)
    }
  }
  const watchdog = setTimeout(() => deliver(REVERSE_FAIL_LABEL), ADDRESS_LOOKUP_TIMEOUT_MS + 400)
  runApartFromCaller(() => {
    void lookupAddressFromApi(liveLat, liveLng)
      .then((address) => {
        clearTimeout(watchdog)
        deliver(address)
      })
      .catch(() => {
        clearTimeout(watchdog)
        deliver(REVERSE_FAIL_LABEL)
      })
  })
}

export type SearchedPlace = { name: string; address: string; jibun: string; category: string; lat: number; lng: number }

export async function searchPlacesFromApi(query: string, signal?: AbortSignal) {
  const q = query.trim()
  if (!q) return [] as SearchedPlace[]
  try {
    const data = (await fetchGeocodeJson(`q=${encodeURIComponent(q)}`, signal)) as {
      places?: Array<{ name?: unknown; address?: unknown; jibun?: unknown; category?: unknown; lat?: unknown; lng?: unknown }>
    } | null
    if (!data) return []
    return (data.places || [])
      .map((item) => {
        const name = typeof item.name === 'string' ? item.name.trim() : q
        const address = typeof item.address === 'string' && item.address.trim() && !isCoordText(item.address) ? item.address.trim() : name
        const jibun = typeof item.jibun === 'string' ? item.jibun.trim() : ''
        const category = typeof item.category === 'string' ? item.category.trim() : ''
        const lat = Number(item.lat)
        const lng = Number(item.lng)
        if (!address || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
        return { name: name || q, address, jibun: jibun || '', category: category || '', lat, lng }
      })
      .filter((item): item is SearchedPlace => Boolean(item))
  } catch {
    return [] as SearchedPlace[]
  }
}

export type DrivingPathPoint = { lat: number; lng: number }

function parseDrivingPathPayload(data: unknown): DrivingPathPoint[] {
  if (!data || typeof data !== 'object') return []
  const root = data as { path?: unknown; route?: unknown }
  const rows = Array.isArray(root.path) ? root.path : Array.isArray(root.route) ? root.route : []
  return rows
    .map((item) => {
      if (Array.isArray(item) && item.length >= 2) {
        const first = Number(item[0])
        const second = Number(item[1])
        if (!Number.isFinite(first) || !Number.isFinite(second)) return null
        if (Math.abs(second) <= 90 && Math.abs(first) <= 180) return { lat: second, lng: first }
        if (Math.abs(first) <= 90 && Math.abs(second) <= 180) return { lat: first, lng: second }
        return null
      }
      if (!item || typeof item !== 'object') return null
      const point = item as { lat?: unknown; lng?: unknown }
      const lat = Number(point.lat)
      const lng = Number(point.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
      return { lat, lng }
    })
    .filter((item): item is DrivingPathPoint => Boolean(item))
}

export async function fetchDrivingPath(
  origin: DrivingPathPoint,
  dest: DrivingPathPoint,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    startLat: String(origin.lat),
    startLng: String(origin.lng),
    destLat: String(dest.lat),
    destLng: String(dest.lng),
  })
  const query = params.toString()
  const urls = [`/api/directions/?${query}`, `/api/directions?${query}`]
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        signal,
        headers: jsonHeaders,
      })
      if (!response.ok) continue
      const points = parseDrivingPathPayload(await response.json())
      if (points.length >= 2) return points
    } catch (error) {
      if (signal?.aborted) throw error
    }
  }
  return [] as DrivingPathPoint[]
}
