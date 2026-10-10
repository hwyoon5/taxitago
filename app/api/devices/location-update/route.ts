import { NextResponse } from 'next/server'
import { reportDeviceLocation } from '@/lib/device-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 기기 GPS 위치 신고 수신 엔드포인트.
 * DEVICE_INGEST_TOKEN이 설정되어 있으면 `x-device-key` 헤더로 검증한다 —
 * 미설정이면 테스트넷/로컬 편의로 무인증 수신한다.
 */
export async function POST(request: Request) {
  const required = (process.env.DEVICE_INGEST_TOKEN || '').trim()
  if (required) {
    const key = (request.headers.get('x-device-key') || '').trim()
    if (key !== required) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const body = (await request.json().catch(() => null)) as {
    deviceId?: unknown
    type?: unknown
    latitude?: unknown
    longitude?: unknown
    lat?: unknown
    lng?: unknown
    batteryLevel?: unknown
    battery?: unknown
    status?: unknown
  } | null
  if (!body) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const device = await reportDeviceLocation({
    deviceId: typeof body.deviceId === 'string' ? body.deviceId : '',
    type: typeof body.type === 'string' ? body.type : '',
    latitude: Number(body.latitude ?? body.lat),
    longitude: Number(body.longitude ?? body.lng),
    batteryLevel: Number(body.batteryLevel ?? body.battery),
    status: typeof body.status === 'string' ? body.status : 'active',
  })
  if (!device) {
    return NextResponse.json({ error: 'invalid_fields' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, deviceId: device.deviceId, lastSeen: device.lastSeen })
}
