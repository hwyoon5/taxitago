import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname === '/api/geocode') {
    const url = request.nextUrl.clone()
    url.pathname = '/api/geocode/'
    return NextResponse.rewrite(url)
  }
  const prefix = '/api/naver-maps/upstream/'
  if (pathname.startsWith(prefix)) {
    const rest = pathname.slice(prefix.length)
    const path = rest.replace(/\/+$/, '')
    if (path && !path.includes('..')) {
      const slash = /\/(?:v3\/auth|v1\/validatev3)\/?$/.test(`/${path}`) ? `${path}/` : path
      const target = `https://${slash}${request.nextUrl.search}`
      const url = request.nextUrl.clone()
      url.pathname = '/api/naver-maps/asset/'
      url.search = `?u=${encodeURIComponent(target)}`
      const headers = new Headers(request.headers)
      headers.set('x-naver-asset-url', target)
      return NextResponse.rewrite(url, { request: { headers } })
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/geocode', '/api/naver-maps/upstream/:path*'],
}
