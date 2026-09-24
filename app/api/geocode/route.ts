import { NextResponse } from 'next/server'
import { forwardGeocodeOnServer, reverseGeocodeOnServer } from '@/lib/server-geocode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = (searchParams.get('q') || searchParams.get('query') || '').trim()
  if (query) {
    const places = await forwardGeocodeOnServer(query)
    return NextResponse.json({ places, query })
  }
  const lat = Number(searchParams.get('lat'))
  const lng = Number(searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: 'lat and lng or q required' }, { status: 400 })
  }
  const address = (await reverseGeocodeOnServer(lat, lng)).trim()
  const safe = address && !/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(address) ? address : '주소를 찾을 수 없습니다'
  return NextResponse.json({ address: safe, lat, lng })
}
