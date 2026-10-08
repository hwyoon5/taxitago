import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname === '/validation-key.txt' || pathname === '/validation-key.txt/') {
    const host = (request.headers.get('host') || '').split(':')[0].toLowerCase()
    const isTestnet =
      host.includes('test.taxitago.co.kr') ||
      request.nextUrl.searchParams.get('pi_network') === 'testnet'
    const target = isTestnet ? '/test-validation-key.txt' : '/main-validation-key.txt'
    return NextResponse.rewrite(new URL(target, request.url))
  }
  if (pathname === '/api/geocode') {
    const url = request.nextUrl.clone()
    url.pathname = '/api/geocode/'
    return NextResponse.rewrite(url)
  }
  if (
    pathname === '/api/pi/approve' ||
    pathname === '/api/pi/complete' ||
    pathname === '/api/pi/auth' ||
    pathname === '/api/escrow/lock' ||
    pathname === '/api/partner/link' ||
    pathname === '/api/drivers/active' ||
    pathname === '/api/drivers/earnings'
  ) {
    const url = request.nextUrl.clone()
    url.pathname = `${pathname}/`
    return NextResponse.rewrite(url)
  }
  const deliveryAccept = pathname.match(/^\/api\/deliveries\/([^/]+)\/accept$/)
  if (deliveryAccept) {
    const url = request.nextUrl.clone()
    url.pathname = `/api/deliveries/${deliveryAccept[1]}/accept/`
    return NextResponse.rewrite(url)
  }
  const deliveryById = pathname.match(/^\/api\/deliveries\/([^/]+)$/)
  if (deliveryById && deliveryById[1] !== 'accept') {
    const url = request.nextUrl.clone()
    url.pathname = `/api/deliveries/${deliveryById[1]}/`
    return NextResponse.rewrite(url)
  }
  if (pathname === '/api/deliveries') {
    const url = request.nextUrl.clone()
    url.pathname = '/api/deliveries/'
    return NextResponse.rewrite(url)
  }
  const rideAction = pathname.match(/^\/api\/rides\/([^/]+)\/(cancel|progress|abandon|complete)$/)
  if (rideAction) {
    const url = request.nextUrl.clone()
    url.pathname = `/api/rides/${rideAction[1]}/${rideAction[2]}/`
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
  matcher: ['/validation-key.txt', '/validation-key.txt/', '/api/geocode', '/api/pi/approve', '/api/pi/complete', '/api/pi/auth', '/api/escrow/lock', '/api/partner/link', '/api/drivers/active', '/api/drivers/earnings', '/api/deliveries', '/api/deliveries/:id', '/api/deliveries/:id/accept', '/api/rides/:id/cancel', '/api/rides/:id/progress', '/api/rides/:id/abandon', '/api/rides/:id/complete', '/api/naver-maps/upstream/:path*'],
}
