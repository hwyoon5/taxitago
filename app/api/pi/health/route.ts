import { NextResponse } from 'next/server'
import { piPaymentHealth } from '@/lib/pi-platform'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 결제 사전 점검 — GET /api/pi/health (공개, 민감 정보 없음).
 * 지갑 시트가 열리기 전에 서버의 Pi API 키가 유효한지 probe한다.
 * ready=false면 실제 approve도 실패하므로 클라이언트는 결제를 시작하지
 * 않고 즉시 명확한 에러를 보여 지갑의 '승인 프로세스 시간 초과'를 피한다.
 */
export async function GET(request: Request) {
  const effectiveSandbox = isPiSandboxRequest(request)
  try {
    const health = await piPaymentHealth(effectiveSandbox)
    return NextResponse.json(
      { ok: true, generatedAt: new Date().toISOString(), ...health },
      { status: health.ready ? 200 : 503 },
    )
  } catch (error) {
    // 키가 아예 없는 등 — 체크아웃을 조용히 진행시키면 지갑 만료로 끝나므로
    // not-ready를 명시해 빠른 실패로 전환한다.
    const message = error instanceof Error ? error.message : 'health check failed'
    console.error('[Pi] /api/pi/health error', { message })
    return NextResponse.json(
      { ok: true, ready: false, keyStatus: 'unconfigured', message, network: effectiveSandbox ? 'testnet' : 'mainnet' },
      { status: 503 },
    )
  }
}
