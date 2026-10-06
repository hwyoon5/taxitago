import { NextResponse } from 'next/server'
import { searchKakaoParkingLots, searchKakaoPlaces } from '@/lib/kakao-local'
import { forwardGeocodeOnServer, looksLikeStreetAddress, reverseGeocodeOnServer } from '@/lib/server-geocode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = (searchParams.get('q') || searchParams.get('query') || '').replace(/\u00a0|\u3000/g, ' ').replace(/\s+/g, ' ').trim()
  if (query) {
    const [kakaoResult, naverResult] = await Promise.all([
      searchKakaoPlaces(query).catch((error: unknown) => ({
        places: [],
        notices: [`kakao failed: ${error instanceof Error ? error.message : 'request error'}`],
      })),
      forwardGeocodeOnServer(query).catch((error: unknown) => ({
        places: [],
        notices: [`geocode failed: ${error instanceof Error ? error.message : 'request error'}`],
      })),
    ])
    const seen = new Set<string>()
    const places = [...kakaoResult.places, ...naverResult.places].filter((place) => {
      const key = `${place.name}|${place.address}|${place.lat}|${place.lng}`
      if (seen.has(key)) return false
      seen.add(key)
      return Number.isFinite(place.lat) && Number.isFinite(place.lng) && Boolean(place.address || place.name)
    })
    // 검색된 대표 지점 반경 2km 안의 공영/일반 주차장을 결과 뒤에 덧붙인다.
    const anchor = places[0]
    let parkingNotices: string[] = []
    if (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)) {
      const parking = await searchKakaoParkingLots(anchor.lat, anchor.lng).catch((error: unknown) => ({
        places: [],
        notices: [`parking failed: ${error instanceof Error ? error.message : 'request error'}`],
      }))
      parkingNotices = parking.notices
      for (const lot of parking.places) {
        const key = `${lot.name}|${lot.address}|${lot.lat}|${lot.lng}`
        if (seen.has(key)) continue
        const duplicated = places.some(
          (place) => place.name === lot.name && Math.abs(place.lat - lot.lat) < 0.0004 && Math.abs(place.lng - lot.lng) < 0.0004,
        )
        if (duplicated) continue
        seen.add(key)
        places.push(lot)
      }
    }
    const notices = [...new Set([...kakaoResult.notices, ...naverResult.notices, ...parkingNotices])]
    return NextResponse.json({ places, query, addressSearch: looksLikeStreetAddress(query), notices })
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
