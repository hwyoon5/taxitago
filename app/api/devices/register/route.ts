import { NextResponse } from 'next/server'
import { getDevice, registerDevice, removePartnerDevice, updatePartnerDevice } from '@/lib/device-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 파트너 시설·기기 명시 등록 — 카테고리별 스펙을 deviceId 단위로 upsert한다.
 * 파트너 가입·프로필 수정 폼이 호출한다. DEVICE_INGEST_TOKEN이 설정되어
 * 있으면 x-device-key 헤더로 검증(외부 단말 연동용), 브라우저 폼 호출은
 * 토큰 미설정 시 무인증으로 받는다.
 */
export async function POST(request: Request) {
  const required = (process.env.DEVICE_INGEST_TOKEN || '').trim()
  const key = (request.headers.get('x-device-key') || '').trim()
  if (required && key !== required) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    deviceId?: unknown
    type?: unknown
    ownerUid?: unknown
    ownerName?: unknown
    spec?: unknown
    status?: unknown
  } | null
  if (!body) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : ''
  const ownerUid = typeof body.ownerUid === 'string' ? body.ownerUid.trim() : ''
  // 소유자가 다른 등록 기기의 ID는 점유할 수 없다 — 409로 명시한다.
  const existing = deviceId ? await getDevice(deviceId).catch(() => null) : null
  if (existing?.ownerUid && existing.ownerUid !== ownerUid) {
    return NextResponse.json({ error: 'device_owned' }, { status: 409 })
  }
  const device = await registerDevice({
    deviceId,
    type: typeof body.type === 'string' ? body.type : '',
    ownerUid: ownerUid || undefined,
    ownerName: typeof body.ownerName === 'string' ? body.ownerName : undefined,
    spec: body.spec,
    status: typeof body.status === 'string' ? body.status : undefined,
  })
  if (!device) {
    return NextResponse.json({ error: 'invalid_fields' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, device })
}

/** 소유 파트너의 등록 정보 수정 — spec 필드를 부분 병합한다. */
export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    deviceId?: unknown
    ownerUid?: unknown
    spec?: unknown
  } | null
  const device = await updatePartnerDevice({
    deviceId: typeof body?.deviceId === 'string' ? body.deviceId : '',
    ownerUid: typeof body?.ownerUid === 'string' ? body.ownerUid : '',
    spec: body?.spec && typeof body.spec === 'object' ? (body.spec as Record<string, unknown>) : undefined,
  })
  if (!device) {
    return NextResponse.json({ error: 'not_found_or_forbidden' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, device })
}

/** 소유 파트너의 등록 기기 삭제 — ownerUid가 일치해야 한다. */
export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    deviceId?: unknown
    ownerUid?: unknown
  } | null
  const removed = await removePartnerDevice(
    typeof body?.deviceId === 'string' ? body.deviceId : '',
    typeof body?.ownerUid === 'string' ? body.ownerUid : '',
  )
  if (!removed) {
    return NextResponse.json({ error: 'not_found_or_forbidden' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
