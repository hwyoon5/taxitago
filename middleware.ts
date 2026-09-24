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
    const rest = pathname.slice(prefix.length).replace(/\/+$/, '')
    if (rest && !rest.includes('..')) {
      const url = request.nextUrl.clone()
      url.pathname = '/api/naver-maps/asset/'
      url.search = `?u=${encodeURIComponent(`https://${rest}${request.nextUrl.search}`)}`
      return NextResponse.rewrite(url)
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/api/geocode', '/api/naver-maps/upstream/:path*'],
}
