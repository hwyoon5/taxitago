import { NextResponse } from 'next/server'
import { fetchNaverWithFlexibleHost, isAllowedNaverAssetHost, rewriteNaverSdkUrls } from '@/lib/naver-host'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function upstreamTarget(request: Request) {
  const headerUrl = request.headers.get('x-naver-asset-url') || ''
  if (headerUrl) return headerUrl
  const current = new URL(request.url)
  const queryUrl = current.searchParams.get('u') || ''
  if (queryUrl) return queryUrl
  const marker = '/api/naver-maps/upstream/'
  const index = current.pathname.indexOf(marker)
  if (index < 0) return ''
  const rest = current.pathname.slice(index + marker.length).replace(/\/+$/, '')
  if (!rest || rest.includes('..')) return ''
  const slash = /\/(?:v3\/auth|v1\/validatev3)$/.test(`/${rest}`) ? `${rest}/` : rest
  return `https://${slash}${current.search}`
}

export async function GET(request: Request) {
  const target = upstreamTarget(request)
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return NextResponse.json({ error: 'invalid asset url' }, { status: 400 })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json({ error: 'invalid asset url' }, { status: 400 })
  }
  const host = parsed.hostname.toLowerCase()
  if (host.endsWith('.apigw.ntruss.com') || /reversegeocode|\/v2\/gc/i.test(parsed.pathname)) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 400 })
  }
  if (!isAllowedNaverAssetHost(host)) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 400 })
  }
  const response = await fetchNaverWithFlexibleHost(parsed.toString(), { signal: AbortSignal.timeout(8000) }, request)
  if (!response) return NextResponse.json({ error: 'asset unavailable' }, { status: 502 })
  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  if (/javascript|json|text\//i.test(contentType)) {
    const raw = await response.text()
    const body = /javascript/i.test(contentType) ? rewriteNaverSdkUrls(raw) : raw
    return new NextResponse(body, {
      status: response.status,
      headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' },
    })
  }
  return new NextResponse(response.body, {
    status: response.status,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' },
  })
}
