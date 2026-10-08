import { NextResponse } from 'next/server'
import { inspectPiAccessToken } from '@/lib/pi-platform'

/**
 * Pi 로그인 세션 재검증 — authenticate 직후 발급된 accessToken을 /v2/me로
 * 확인한다. 만료·위조·uid 불일치 토큰은 401로 거절해 "연동됐는데 실제로는
 * 세션이 끊긴" 상태가 클라이언트에 남지 않게 한다.
 * /v2/me 자체 장애는 502로 구분 — 클라이언트가 재시도 정책을 고를 수 있게 한다.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    uid?: unknown
    accessToken?: unknown
  } | null
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : ''
  if (!uid || !accessToken) {
    return NextResponse.json({ ok: false, error: 'uid/accessToken required' }, { status: 400 })
  }

  const result = await inspectPiAccessToken(accessToken)
  if (result.status === 'ok' && result.uid === uid) {
    return NextResponse.json({ ok: true, uid })
  }
  if (result.status === 'unreachable') {
    return NextResponse.json(
      { ok: false, error: 'Pi 인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 502 },
    )
  }
  console.warn('[Pi] /api/pi/auth rejected', { uid, status: result.status, tokenUid: result.uid })
  return NextResponse.json(
    { ok: false, error: 'Pi 로그인 세션이 끊겼습니다. 파이 브라우저에서 다시 로그인한 뒤 시도해 주세요.' },
    { status: 401 },
  )
}
