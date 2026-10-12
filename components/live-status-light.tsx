'use client'

import { useEffect, useState } from 'react'
import { useLocale } from '@/components/locale-provider'

type Level = 'green' | 'yellow' | 'red'

const POLL_MS = 15_000

const DOT: Record<Level, { cls: string; glow: string; label: string }> = {
  green: { cls: 'bg-[#22C55E]', glow: '0 0 6px 2px rgba(34,197,94,0.75)', label: '원활' },
  yellow: { cls: 'bg-[#EAB308]', glow: '0 0 6px 2px rgba(234,179,8,0.75)', label: '보통' },
  red: { cls: 'bg-[#EF4444]', glow: '0 0 6px 2px rgba(239,68,68,0.75)', label: '혼잡' },
}
const ORDER: Level[] = ['green', 'yellow', 'red']

/**
 * 홈 헤더 신호등 — /api/presence 집계(매칭 대기 수요 vs 온라인 기사)로
 * 현재 서비스 혼잡도를 초록/노랑/빨강으로 표시하고 활성 색만 깜빡인다.
 * 기준: 매칭 대기 3건 이상 또는 대기가 있는데 온라인 기사 0명 → 빨강,
 * 대기 1건 이상 → 노랑, 그 외 → 초록.
 */
export default function LiveStatusLight() {
  const { t } = useLocale()
  const [level, setLevel] = useState<Level>('green')
  const [live, setLive] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/presence', { cache: 'no-store' })
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean
          matching?: { demand?: number; driversOnline?: number }
        } | null
        if (cancelled || !data?.ok) return
        const demand = data.matching?.demand ?? 0
        const drivers = data.matching?.driversOnline ?? 0
        setLevel(demand >= 3 || (demand >= 1 && drivers === 0) ? 'red' : demand >= 1 ? 'yellow' : 'green')
        setLive(true)
      } catch {
        // 마지막 상태를 유지한다 — 신호등은 참고 표시라 실패가 치명적이지 않다.
      }
    }
    void load()
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return (
    <span className="flex items-center gap-2" role="status" aria-label={`${t('home.liveStatus')} ${DOT[level].label}`}>
      <span className="text-[10px] font-bold text-[#475569]">{t('home.liveStatus')}</span>
      <span className="flex items-center gap-1.5">
        {ORDER.map((key) => {
          const active = key === level && live
          return (
            <span
              key={key}
              className={`h-2.5 w-2.5 rounded-full transition ${active ? `${DOT[key].cls} animate-pulse` : 'bg-[#CBD5E1]'}`}
              style={active ? { boxShadow: DOT[key].glow } : undefined}
            />
          )
        })}
      </span>
    </span>
  )
}
