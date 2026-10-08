import { handlePiApprove } from '@/lib/pi-payment-handlers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * REST형 승인 경로 — POST /api/pi/payments/:id/approve
 * path의 paymentId를 기존 body 기반 핸들러와 같은 검증 흐름으로 넘긴다.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const forward = new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, paymentId: id }),
  })
  return handlePiApprove(forward)
}
