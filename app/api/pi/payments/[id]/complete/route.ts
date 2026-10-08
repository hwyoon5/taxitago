import { handlePiComplete } from '@/lib/pi-payment-handlers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * REST형 완료 경로 — POST /api/pi/payments/:id/complete
 * txid 등 나머지 필드는 요청 body 그대로 전달하고 paymentId는 path에서 주입한다.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const forward = new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, paymentId: id }),
  })
  return handlePiComplete(forward)
}
