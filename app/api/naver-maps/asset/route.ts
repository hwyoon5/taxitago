import { NextResponse } from 'next/server'
import { fetchNaverWithFlexibleHost, isAllowedNaverAssetHost, rewriteNaverSdkUrls } from '@/lib/naver-host'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get('u') || ''
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
