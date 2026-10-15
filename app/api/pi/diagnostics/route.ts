import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { piPaymentDiagnostics } from '@/lib/pi-platform'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 관리자 결제 진단 — GET /api/pi/diagnostics (x-admin-key 필요).
 * 지갑의 "개발자가 이 결제를 승인하지 못했습니다" 오류를 서버 측에서 분해한다:
 *   - 이 배포가 어떤 Pi 네트워크로 결정됐는지 (host/env 규칙 적용 결과)
 *   - 그 네트워크용 API 키가 env에 실제로 잡혀 있는지 (값이 아니라 이름만)
 *   - 서버가 Pi Payments API에 닿는지 (probe.reachable/status/ms)
 * 승인이 전부 401로 떨어지면 configuredScoped가 비어 있는지 먼저 본다 —
 * 내장 테스트넷 폴백 키만 있는 상태(builtinFallbackOnly)는 다른 앱 소유 키라
 * 모든 승인이 거절돼 지갑 만료로 이어진다.
 */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const diag = await piPaymentDiagnostics(isPiSandboxRequest(request))
  return NextResponse.json({ ok: true, generatedAt: new Date().toISOString(), ...diag })
}
