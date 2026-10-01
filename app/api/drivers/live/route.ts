import { getDriverActiveRide, getDriverOffer } from '@/lib/dispatch-engine'
import { subscribeDriverLive } from '@/lib/dispatch-store'
import { driverEarningsStats } from '@/lib/escrow-engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const driverId = params.get('driverId')?.trim() || ''
  if (!driverId) return new Response('driverId required', { status: 400 })
  const aliasIds = params.getAll('altDriverId').map((id) => id.trim()).filter((id) => id && id !== driverId)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      const push = () => {
        void (async () => {
          const pending = getDriverOffer(driverId)
          send('dispatch', {
            ride: pending?.ride ?? null,
            offer: pending?.offer ?? null,
            active: getDriverActiveRide(driverId),
            earnings: await driverEarningsStats(driverId, aliasIds),
          })
        })().catch(() => undefined)
      }
      send('ping', { at: Date.now() })
      push()
      const unsubscribe = subscribeDriverLive(driverId, push)
      const ping = setInterval(() => {
        try {
          push()
          send('ping', { at: Date.now() })
        } catch {
          close()
        }
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
