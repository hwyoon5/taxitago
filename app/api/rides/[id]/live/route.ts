import { getPublicRide, resumeAssignedTracking, subscribeRideLive } from '@/lib/dispatch-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  resumeAssignedTracking()
  const snapshot = getPublicRide(id)
  if (!snapshot) return new Response('not_found', { status: 404 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          unsubscribe()
        }
      }
      const pushRide = () => {
        const ride = getPublicRide(id)
        if (!ride) return
        send(`event: ride\ndata: ${JSON.stringify({ ride })}\n\n`)
      }
      pushRide()
      const unsubscribe = subscribeRideLive(id, () => pushRide())
      const ping = setInterval(() => {
        pushRide()
        send('event: ping\ndata: {}\n\n')
      }, 2000)
      const close = () => {
        clearInterval(ping)
        unsubscribe()
        try {
          controller.close()
        } catch {
          undefined
        }
      }
      request.signal.addEventListener('abort', close)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
