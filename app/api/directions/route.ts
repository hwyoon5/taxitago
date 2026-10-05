import { NextResponse } from 'next/server'
import { drivingPathOnServer } from '@/lib/server-directions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const startLat = Number(searchParams.get('startLat') || searchParams.get('originLat'))
  const startLng = Number(searchParams.get('startLng') || searchParams.get('originLng'))
  const destLat = Number(searchParams.get('destLat') || searchParams.get('goalLat'))
  const destLng = Number(searchParams.get('destLng') || searchParams.get('goalLng'))
  // waypoints=lat,lng|lat,lng (최대 5개, 순서 유지)
  const waypoints = (searchParams.get('waypoints') || '')
    .split('|')
    .map((chunk) => {
      const [lat, lng] = chunk.split(',').map(Number)
      return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? { lat, lng }
        : null
    })
    .filter((point): point is { lat: number; lng: number } => point !== null)
    .slice(0, 5)
  if (
    !Number.isFinite(startLat) ||
    !Number.isFinite(startLng) ||
    !Number.isFinite(destLat) ||
    !Number.isFinite(destLng) ||
    Math.abs(startLat) > 90 ||
    Math.abs(destLat) > 90 ||
    Math.abs(startLng) > 180 ||
    Math.abs(destLng) > 180
  ) {
    return NextResponse.json({ error: 'start and dest lat/lng required' }, { status: 400 })
  }
  try {
    const path = await drivingPathOnServer({ lat: startLat, lng: startLng }, { lat: destLat, lng: destLng }, waypoints)
    return NextResponse.json({ path })
  } catch {
    return NextResponse.json({ path: [] })
  }
}
