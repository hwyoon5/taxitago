import { NextResponse } from 'next/server'
import { handlePiCorsPreflight, PI_CORS_HEADERS } from '@/lib/pi-payment-handlers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const OPTIONS = handlePiCorsPreflight

const MAX_FIELD = 300

function sanitize(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (typeof value === 'string') return value.slice(0, MAX_FIELD)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return depth > 2 ? '[…]' : value.slice(0, 10).map((v) => sanitize(v, depth + 1))
  if (typeof value === 'object') {
    if (depth > 2) return '{…}'
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
      // 토큰·시크릿 류는 아예 기록하지 않는다.
      if (/token|secret|key|seed|authorization/i.test(key)) out[key] = '[redacted]'
      else out[key] = sanitize(v, depth + 1)
    }
    return out
  }
  return String(value).slice(0, MAX_FIELD)
}

/**
 * 클라이언트 결제 생명주기 트레이스 — POST /api/pi/trace (공개, 비저장).
 * Pi Browser 안에서는 개발자 콘솔을 볼 수 없어, SDK 콜백이 실제로 발사됐는지
 * (onReadyForServerApproval 도달 여부)와 어느 오리진으로 요청했는지를 서버
 * 로그로 볼 수 있게 하는 용도다. 지갑 시트 중 페이지 fetch가 스로틀돼도
 * beacon이 먼저 도착하도록 클라이언트는 sendBeacon으로 보낸다.
 * '요청이 서버에 아예 안 온다' 문제의 유일한 진단 창구 — 반드시 로그만 남기고
 * 204로 끝낸다.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    label?: unknown
    extra?: unknown
  } | null
  const label = typeof body?.label === 'string' ? body.label.slice(0, 120) : '(no label)'
  console.log(`[Pi-trace] ${label}`, sanitize(body?.extra))
  return new NextResponse(null, { status: 204, headers: PI_CORS_HEADERS })
}
