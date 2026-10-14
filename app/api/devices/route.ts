import { NextResponse, after } from 'next/server'
import { listDevices, setDeviceRentalState } from '@/lib/device-store'
import { partnerFeedsStale } from '@/lib/partner-source-store'
import { syncPartnerFeeds } from '@/lib/partner-feed'

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
/** 활성 피드가 이 주기보다 오래됐으면 응답 후 백그라운드로 재동기화한다. */
const FEED_STALE_MS = 60_000

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const type = (searchParams.get('type') || '').trim()
  const uid = (searchParams.get('uid') || '').trim()
  const devices = await listDevices({
    type: type || undefined,
    ownerUid: uid || undefined,
  })

  // 파트너 피드가 stale이면 응답 이후 백그라운드 재동기화 — 다음 폴링부터 반영된다.
  const stale = await partnerFeedsStale(FEED_STALE_MS).catch(() => false)
  if (stale) {
    after(() => syncPartnerFeeds().catch((error) => console.error('[PartnerFeed] auto sync failed', error)))
  }

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

const RENTAL_ERRORS: Record<string, string> = {
  not_found: '등록된 기기를 찾을 수 없습니다.',
  not_rentable: '파트너가 대여를 허용하지 않은 기기입니다.',
  already_rented: '다른 이용자가 이미 대여한 기기입니다.',
  not_rented: '대여 중이 아닌 기기입니다.',
}

/**
 * 이용자 대여·반납 전이 — { deviceId, rent: true|false, renterId? }.
 * 서버가 상태 전이를 검증해 동일 기기의 중복 대여를 막는다.
 */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    deviceId?: unknown
    rent?: unknown
    renterId?: unknown
  } | null
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : ''
  const rent = body?.rent === true ? true : body?.rent === false ? false : null
  const renterId = typeof body?.renterId === 'string' ? body.renterId.trim() : ''
  if (!deviceId || rent === null) {
    return NextResponse.json({ error: 'invalid_fields' }, { status: 400 })
  }
  const result = await setDeviceRentalState(deviceId, rent, renterId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error, message: RENTAL_ERRORS[result.error] }, { status: 409 })
  }
  return NextResponse.json({ ok: true, device: result.device })
}
