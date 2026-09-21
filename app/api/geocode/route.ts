import { NextResponse } from 'next/server'
import { reverseGeocodeOnServer } from '@/lib/server-geocode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const lat = Number(searchParams.get('lat'))
  const lng = Number(searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 })
  }
  try {
    const address = await reverseGeocodeOnServer(lat, lng)
    return NextResponse.json({ address, lat, lng })
  } catch {
    return NextResponse.json({ address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng })
  }
}
