import { NextResponse } from 'next/server'
import { fetchNaverWithFlexibleHost, isAllowedNaverAssetHost, rewriteNaverSdkUrls } from '@/lib/naver-host'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function proxy(request: Request, path: string[]) {
  const incoming = new URL(request.url)
  const joined = path.map((part) => decodeURIComponent(part)).join('/')
  const host = joined.split('/')[0]?.toLowerCase() || ''
  if (host.endsWith('.apigw.ntruss.com') || /reversegeocode|\/v2\/gc/i.test(joined)) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 400 })
  }
  if (!isAllowedNaverAssetHost(host)) {
    return NextResponse.json({ error: 'host not allowed' }, { status: 400 })
  }
  const target = `https://${joined}${incoming.search}`
  const init: RequestInit = {
    method: request.method,
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  }
  const contentTypeIn = request.headers.get('content-type')
  if (contentTypeIn) init.headers = { 'Content-Type': contentTypeIn }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer()
  }
  const response = await fetchNaverWithFlexibleHost(target, init, request)
  if (!response) return NextResponse.json({ error: 'asset unavailable' }, { status: 502 })
  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  }
  if (/javascript|json|text\//i.test(contentType)) {
    const body = await response.text()
    const rewritten = /javascript/i.test(contentType) ? rewriteNaverSdkUrls(body) : body
    return new NextResponse(rewritten, { status: response.status, headers })
  }
  return new NextResponse(response.body, { status: response.status, headers })
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  return proxy(request, path || [])
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  return proxy(request, path || [])
}
