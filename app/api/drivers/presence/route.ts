import { NextResponse } from 'next/server'
import { upsertDriverPresence } from '@/lib/dispatch-engine'
import { ensureSeedDrivers, flushDispatchPersist } from '@/lib/dispatch-store'
import { isUsableCoord } from '@/lib/ride-session'
import { getRegistryUser, isUserLocked } from '@/lib/user-registry'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  ensureSeedDrivers()
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  const lat = body?.lat
  const lng = body?.lng
  const online = body?.online !== false && body?.status !== 'offline'
  if (!driverId || !isUsableCoord(lat, lng)) {
    return NextResponse.json({ error: 'driverId and coordinates required' }, { status: 400 })
  }
  // 이용 정지(Lock) 기사는 온라인 전환을 차단한다 — 오프라인 전환은 허용.
  if (online && (await isUserLocked(driverId).catch(() => false))) {
    return NextResponse.json({ error: '관리자에 의해 이용이 정지된 계정입니다.' }, { status: 403 })
  }
  // 메인넷은 Pi 인증+KYC 가입을 마친 등록 기사만 온라인 전환할 수 있다 —
  // 레지스트리 등록 여부로 확인한다(가입 시점 /api/partner/link POST가
  // 토큰·스코프를 검증했으므로 하트비트마다 토큰을 검증할 필요는 없다).
  // 테스트넷은 미등록 개발 uid도 온라인 전환을 허용해 매칭 테스트를 막지 않는다.
  if (online && !isPiSandboxRequest(request)) {
    const piUid = typeof body?.piUid === 'string' ? body.piUid.trim() : ''
    const registered = await getRegistryUser(piUid || driverId).catch(() => null)
    if (!registered || registered.withdrawnAt) {
      return NextResponse.json(
        { error: 'Pi 계정 연동 및 기사 등록 후 이용해 주세요.', registrationRequired: true },
        { status: 403 },
      )
    }
  }
  // 서비스 자격·차량 등급은 레지스트리(등록 정보)를 우선 — 클라이언트 힌트는
  // 레지스트리에 등록이 없을 때만 쓴다(임의 위장 방지).
  const registeredUser = await getRegistryUser(
    (typeof body?.piUid === 'string' ? body.piUid.trim() : '') || driverId,
  ).catch(() => null)
  const driver = upsertDriverPresence({
    id: driverId,
    lat: Number(lat),
    lng: Number(lng),
    status: online ? 'online' : 'offline',
    name: typeof body?.name === 'string' ? body.name : undefined,
    vehicle: typeof body?.vehicle === 'string' ? body.vehicle : undefined,
    plate: typeof body?.plate === 'string' ? body.plate : undefined,
    wallet: typeof body?.wallet === 'string' ? body.wallet : undefined,
    piUid: typeof body?.piUid === 'string' ? body.piUid : undefined,
    phone: typeof body?.phone === 'string' ? body.phone : undefined,
    altDriverId: typeof body?.altDriverId === 'string' ? body.altDriverId.trim() : undefined,
    serviceType: registeredUser?.serviceType || (typeof body?.serviceType === 'string' ? body.serviceType.trim() : undefined),
    serviceRoles: registeredUser?.serviceRoles ?? (Array.isArray(body?.serviceRoles) ? (body.serviceRoles as string[]) : undefined),
    deliveryVehicles: registeredUser?.deliveryVehicles ?? (Array.isArray(body?.deliveryVehicles) ? (body.deliveryVehicles as string[]) : undefined),
    vehicleTiers: registeredUser?.vehicleTiers ?? (Array.isArray(body?.vehicleTiers) ? (body.vehicleTiers as string[]) : undefined),
  })
  await flushDispatchPersist()
  return NextResponse.json({ ok: true, driver })
}
