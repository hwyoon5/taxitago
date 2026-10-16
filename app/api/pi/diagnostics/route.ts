import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { piPaymentDiagnostics } from '@/lib/pi-platform'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'
import { dataNetwork } from '@/lib/kv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 관리자 결제 진단 — GET /api/pi/diagnostics (x-admin-key 필요).
 * 지갑의 "개발자가 이 결제를 승인하지 못했습니다" 오류를 서버 측에서 분해한다:
 *   - 이 배포가 어떤 Pi 네트워크로 결정됐는지 (host/env 규칙 적용 결과)
 *   - 그 네트워크용 API 키가 env에 실제로 잡혀 있는지 (값이 아니라 이름만)
 *   - 서버가 Pi Payments API에 닿는지 (probe.reachable/status/ms)
 * 승인이 전부 401로 떨어지면 keys.missing/configuredScoped를 먼저 본다 —
 * env에 키가 없으면(missing) 승인 자체가 실패하며, fingerprints로 배포된
 * 키가 지갑이 쓰는 앱의 포털 키와 같은 앱 소유인지 대조한다.
 */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const diag = await piPaymentDiagnostics(isPiSandboxRequest(request))
  // dataScope = 이 배포의 장부 네임스페이스(메인넷이면 taxitago:main:*). 결제
  // 네트워크 판정과 분리해 보여준다 — 둘이 다르면 배포 env 설정을 의심한다.
  const dedicatedKv = ['TESTNET', 'MAINNET'].filter((suffix) =>
    Boolean(process.env[`KV_REST_API_URL_${suffix}`] && process.env[`KV_REST_API_TOKEN_${suffix}`]),
  )
  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    dataScope: {
      network: dataNetwork(),
      dedicatedKv: dedicatedKv.map((suffix) => suffix.toLowerCase()),
    },
    ...diag,
  })
}
