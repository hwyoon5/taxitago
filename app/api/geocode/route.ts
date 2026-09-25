import { NextResponse } from 'next/server'
import { searchKakaoPlaces } from '@/lib/kakao-local'
import { forwardGeocodeOnServer, looksLikeStreetAddress, reverseGeocodeOnServer } from '@/lib/server-geocode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = (searchParams.get('q') || searchParams.get('query') || '').replace(/\u00a0|\u3000/g, ' ').replace(/\s+/g, ' ').trim()
  if (query) {
    const [kakaoPlaces, naverPlaces] = await Promise.all([
      searchKakaoPlaces(query).catch(() => []),
      forwardGeocodeOnServer(query).catch(() => []),
    ])
    const seen = new Set<string>()
    const places = [...kakaoPlaces, ...naverPlaces].filter((place) => {
      const key = `${place.name}|${place.address}|${place.lat}|${place.lng}`
      if (seen.has(key)) return false
      seen.add(key)
      return Number.isFinite(place.lat) && Number.isFinite(place.lng) && Boolean(place.address || place.name)
    })
    return NextResponse.json({ places, query, addressSearch: looksLikeStreetAddress(query) })
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
