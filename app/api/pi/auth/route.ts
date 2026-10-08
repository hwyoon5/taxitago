import { after, NextResponse } from 'next/server'
import { describeError, inspectPiAccessToken } from '@/lib/pi-platform'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'

const PI_APP_STUDIO_LOGIN_URL =
  'https://backend.appstudio-u7cm9zhmha0ruwv8.piappengine.com/pi/auth/v1/login'

/**
 * Pi 로그인 세션 재검증 — authenticate 직후 발급된 accessToken을 /v2/me로
 * 확인한다. 만료·위조·uid 불일치 토큰은 401로 거절해 "연동됐는데 실제로는
 * 세션이 끊긴" 상태가 클라이언트에 남지 않게 한다.
 * /v2/me 자체 장애는 502로 구분 — 클라이언트가 재시도 정책을 고를 수 있게 한다.
 *
 * 부가 역할: 같은 토큰을 Pi App Studio 로그인 엔드포인트로 포워딩한다.
 * 브라우저 → piappengine 직접 POST가 CORS로 막히는 환경에서도 App Studio의
 * "Verified" 검증이 토큰을 받도록 보장한다(토큰은 App Studio가 자체 검증).
 */
export async function POST(request: Request) {
  // 어떤 예외로든 응답을 놓치면 클라이언트 로그인이 무한 대기한다 —
  // 핸들러 전체를 가드해 반드시 HTTP 응답을 돌려준다.
  try {
    const body = (await request.json().catch(() => null)) as {
      uid?: unknown
      accessToken?: unknown
    } | null
    const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
    const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : ''
    if (!uid || !accessToken) {
      return NextResponse.json({ ok: false, error: 'uid/accessToken required' }, { status: 400 })
    }

    // 토큰은 요청이 결정된 네트워크의 /v2/me로 검증한다 — 테스트 도메인에서
    // 발급된 테스트넷 토큰을 메인넷 엔드포인트로 내면 거절돼 정상 로그인이
    // "세션 끊김"으로 실패한다.
    const sandbox = isPiSandboxRequest(request)
    const result = await inspectPiAccessToken(accessToken, sandbox)

    // App Studio 검증 포워딩 — 응답을 지연시키지 않도록 after()로 백그라운드
    // 처리한다. 직렬로 기다리면 최대 8초가 로그인 응답에 붙어 클라이언트
    // 타임아웃(15s)과 합쳐져 로그인이 느려진다.
    after(async () => {
      try {
        const studioRes = await fetch(PI_APP_STUDIO_LOGIN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken }),
          signal: AbortSignal.timeout(8_000),
        })
        const studioBody = await studioRes.text().catch(() => '')
        console.log('[Pi] App Studio login forwarded', { status: studioRes.status, body: studioBody.slice(0, 200) })
      } catch (error) {
        console.warn('[Pi] App Studio login forward failed', error)
      }
    })

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
  } catch (error) {
    console.error('[Pi] /api/pi/auth unhandled error', describeError(error))
    return NextResponse.json(
      { ok: false, error: '인증 처리 중 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    )
  }
}
