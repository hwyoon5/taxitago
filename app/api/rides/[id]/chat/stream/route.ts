import { listChatMessages } from '@/lib/comms-engine'
import { subscribeRide } from '@/lib/comms-store'
import type { CommsRole } from '@/lib/comms-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const url = new URL(request.url)
  const actorId = url.searchParams.get('actorId')?.trim() || ''
  const role = (url.searchParams.get('role') === 'driver' ? 'driver' : url.searchParams.get('role') === 'passenger' ? 'passenger' : null) as CommsRole | null
  if (!actorId || !role) {
    return new Response('actorId and role required', { status: 400 })
  }
  const access = listChatMessages(id, actorId, role)
  if (!access.ok) {
    return new Response(access.error, { status: access.error === 'not_found' ? 404 : 403 })
  }

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
      send(`data: ${JSON.stringify({ type: 'snapshot', room: access.room })}\n\n`)
      const unsubscribe = subscribeRide(id, send)
      const ping = setInterval(() => send('event: ping\ndata: {}\n\n'), 15000)
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
