import { readMapGetCenter, type MapLatLng } from '@/lib/map-center'
import type { NaverMapInstance, NaverMapsSdk } from '@/lib/naver-maps'

const SETTLE_MS = 280

export function createSettleDebounce(onSettle: () => void, waitMs = SETTLE_MS) {
  let timer = 0
  const kick = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = 0
      try {
        onSettle()
      } catch (error) {
        console.error('[map] settle handler failed', error)
      }
    }, waitMs)
  }
  const stop = () => {
    window.clearTimeout(timer)
    timer = 0
  }
  return { kick, stop }
}

export function watchMapSettle(
  map: NaverMapInstance,
  sdk: NaverMapsSdk,
  root: HTMLElement | null,
  onSettle: (center: MapLatLng) => void,
  waitMs = SETTLE_MS,
): () => void {
  const debounce = createSettleDebounce(() => {
    try {
      const center = readMapGetCenter(map)
      if (center) onSettle(center)
    } catch (error) {
      console.error('[map] settle handler failed', error)
    }
  }, waitMs)

  let armed = false
  const isInsideMap = (event: Event) => {
    if (!root) return true
    const target = event.target
    return target instanceof Node && root.contains(target)
  }
  const arm = (event: Event) => {
    try {
      if (isInsideMap(event)) armed = true
    } catch (error) {
      console.error('[map] pointer arm failed', error)
    }
  }
  const onPointerEnd = () => {
    try {
      if (!armed) return
      armed = false
      debounce.kick()
    } catch (error) {
      console.error('[map] pointer end failed', error)
    }
  }

  const idleListener = sdk.Event?.addListener?.(map, 'idle', () => {
    try {
      debounce.kick()
    } catch (error) {
      console.error('[map] idle handler failed', error)
    }
  })

  const startEvents = ['mousedown', 'touchstart', 'pointerdown'] as const
  const endEvents = ['mouseup', 'touchend', 'pointerup'] as const
  for (const name of startEvents) {
    window.addEventListener(name, arm, true)
  }
  for (const name of endEvents) {
    window.addEventListener(name, onPointerEnd, true)
  }

  return () => {
    debounce.stop()
    try {
      if (idleListener) sdk.Event?.removeListener?.(idleListener)
    } catch {
      undefined
    }
    for (const name of startEvents) {
      window.removeEventListener(name, arm, true)
    }
    for (const name of endEvents) {
      window.removeEventListener(name, onPointerEnd, true)
    }
  }
}
