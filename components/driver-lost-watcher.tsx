'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchLostInbox } from '@/lib/support-client'
import { playCommsAlert, primeCommsAlertAudio } from '@/lib/alert-sound'
import type { LostItem } from '@/lib/support-types'

const POLL_MS = 6000
const BANNER_MS = 20000

/**
 * 기사가 홈/다른 탭을 보고 있을 때도 새 분실물 접수를 감지하는 전역 와처.
 * 기사/파트너 탭에서는 DriverDashboard 자체 폴링이 알림을 담당하므로
 * 이 컴포넌트는 그 외 탭에서만 마운트된다.
 */
export default function DriverLostWatcher({
  driverId,
  onOpen,
}: {
  driverId: string
  onOpen: (itemId: string) => void
}) {
  const [alert, setAlert] = useState<LostItem | null>(null)
  const seenRef = useRef<Set<string> | null>(null)
  const dismissedRef = useRef<Set<string>>(new Set())
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    if (!driverId) return
    primeCommsAlertAudio()
    let live = true
    const pull = () => {
      void fetchLostInbox(driverId, 'driver')
        .then((items) => {
          if (!live) return
          const ids = new Set(items.map((row) => row.id))
          const arrived = seenRef.current
            ? items.filter((row) => !seenRef.current!.has(row.id) && !dismissedRef.current.has(row.id))
            : []
          seenRef.current = ids
          if (arrived.length) {
            playCommsAlert('call')
            setAlert(arrived[0])
          }
        })
        .catch(() => undefined)
    }
    pull()
    const timer = window.setInterval(pull, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') pull()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', pull)
    return () => {
      live = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', pull)
    }
  }, [driverId])

  // 배너는 일정 시간 뒤 자동으로 접힌다 — 같은 건은 다시 울리지 않는다.
  useEffect(() => {
    if (!alert) return
    const timer = window.setTimeout(() => setAlert(null), BANNER_MS)
    return () => window.clearTimeout(timer)
  }, [alert])

  if (!alert) return null
  return (
    <div className="fixed inset-x-0 top-3 z-[120] mx-auto w-full max-w-md px-4">
      <div className="rounded-2xl border-2 border-[#FCA5A5] bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.28)]">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FEF2F2] text-lg">🧳</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-black text-[#DC2626]">새로운 분실물 접수</p>
            <p className="mt-0.5 truncate text-sm font-black text-[#0F172A]">{alert.itemType} · {alert.route}</p>
            <p className="mt-0.5 text-[10px] font-bold text-[#94A3B8]">
              {alert.kind === 'lost' ? '이용자가 물건을 분실했습니다.' : '습득물이 접수되었습니다.'} 터치하면 채팅이 바로 열립니다.
            </p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              const id = alert.id
              setAlert(null)
              onOpenRef.current(id)
            }}
            className="rounded-xl bg-[#DC2626] py-2 text-xs font-black text-white"
          >
            채팅 열기
          </button>
          <button
            type="button"
            onClick={() => {
              dismissedRef.current.add(alert.id)
              setAlert(null)
            }}
            className="rounded-xl border-2 border-[#CBD5E1] py-2 text-xs font-black text-[#475569]"
          >
            나중에
          </button>
        </div>
      </div>
    </div>
  )
}
