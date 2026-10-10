import { NextResponse } from 'next/server'
import { registerDevice } from '@/lib/device-store'

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

  const device = await registerDevice({
    deviceId: typeof body.deviceId === 'string' ? body.deviceId : '',
    type: typeof body.type === 'string' ? body.type : '',
    ownerUid: typeof body.ownerUid === 'string' ? body.ownerUid : undefined,
    ownerName: typeof body.ownerName === 'string' ? body.ownerName : undefined,
    spec: body.spec,
    status: typeof body.status === 'string' ? body.status : undefined,
  })
  if (!device) {
    return NextResponse.json({ error: 'invalid_fields' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, device })
}
