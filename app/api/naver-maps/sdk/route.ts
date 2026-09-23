import { NextResponse } from 'next/server'
import { fetchNaverWithFlexibleHost, rewriteNaverSdkUrls } from '@/lib/naver-host'
import { resolveNaverMapClientId } from '@/lib/naver-maps'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sdkTargets(clientId: string, incoming: URLSearchParams) {
  const variants = [
    (() => {
      const params = new URLSearchParams(incoming)
      params.delete('ncpClientId')
      params.delete('submodules')
      if (clientId) params.set('ncpKeyId', clientId)
      return params
    })(),
    (() => {
      const params = new URLSearchParams(incoming)
      params.delete('ncpKeyId')
      params.delete('submodules')
      if (clientId) params.set('ncpClientId', clientId)
      return params
    })(),
  ]
  const hosts = ['https://oapi.map.naver.com/openapi/v3/maps.js', 'https://openapi.map.naver.com/openapi/v3/maps.js']
  const urls: string[] = []
  for (const params of variants) {
    const query = params.toString()
    for (const host of hosts) urls.push(`${host}?${query}`)
  }
  return urls
}

export async function GET(request: Request) {
  const incoming = new URL(request.url)
  const clientId = resolveNaverMapClientId()
  for (const target of sdkTargets(clientId, incoming.searchParams)) {
    const response = await fetchNaverWithFlexibleHost(target, { signal: AbortSignal.timeout(8000) }, request)
    if (!response?.ok) continue
    const body = await response.text()
    if (!body.trim() || body.includes('<html')) continue
    if (/인증이 실패|Authentication Failed/i.test(body) && !/naver\.maps/.test(body)) continue
    const stripped = rewriteNaverSdkUrls(
      body
        .replace(
          /n\.push\(e\+i\[o\]\+"\.js"\)/g,
          '(/geocoder|^gc/i.test(String(i[o]))||n.push(e+i[o]+".js"))',
        )
        .replace(/https?:\/\/[^"' \n]+\/maps-(?:geocoder|gc-js|gc)\.js/gi, '/api/naver-maps/stub'),
    )
    return new NextResponse(stripped, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  }
  return new NextResponse('/* naver maps sdk unavailable */', {
    status: 502,
    headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
  })
}
