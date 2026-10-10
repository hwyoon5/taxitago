import { NextResponse } from 'next/server'
import { listDevices } from '@/lib/device-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

/**
 * 공개 기기·시설 목록 — 사용자 지도/목록 화면이 카테고리·소유자·반경으로 조회한다.
 * ?type=bicycle|kickboard|ev|parking  ?uid=<ownerUid>
 * ?near=<lat>,<lng>&radius=<km>  — 중심점 반경 필터
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const type = (searchParams.get('type') || '').trim()
  const uid = (searchParams.get('uid') || '').trim()
  const devices = await listDevices({
    type: type || undefined,
    ownerUid: uid || undefined,
  })

  const near = (searchParams.get('near') || '').split(',')
  const nearLat = Number(near[0])
  const nearLng = Number(near[1])
  const radius = Number(searchParams.get('radius'))
  if (Number.isFinite(nearLat) && Number.isFinite(nearLng) && Number.isFinite(radius) && radius > 0) {
    const filtered = devices.filter((row) => haversineKm(nearLat, nearLng, row.latitude, row.longitude) <= radius)
    return NextResponse.json({ ok: true, devices: filtered, count: filtered.length })
  }
  return NextResponse.json({ ok: true, devices, count: devices.length })
}
