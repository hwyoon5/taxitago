'use client'

import { useCallback, useEffect, useState } from 'react'
import { Megaphone, X } from 'lucide-react'
import type { BroadcastEntry } from '@/lib/broadcast-store'

const DISMISS_KEY = 'taxitago.dismissed-broadcasts'

function loadDismissed(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

/**
 * 관리자 방송 배너 — banner=true로 등록된 최신 공지를 앱 상단에 노출.
 * 30초 폴링으로 새 방송이 등록되면 새로고침 없이 뜨고, 닫으면 해당 공지는 다시 안 보인다.
 */
export default function BroadcastBanner({ audience = 'passenger', region = '' }: { audience?: 'passenger' | 'driver' | 'partner' | 'staff'; region?: string }) {
  const [entry, setEntry] = useState<BroadcastEntry | null>(null)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/broadcasts?audience=${audience}${region ? `&region=${region}` : ''}`, { cache: 'no-store' }).catch(() => null)
    const data = (await res?.json().catch(() => null)) as { broadcasts?: BroadcastEntry[] } | null
    const banner = (data?.broadcasts ?? []).find((item) => item.banner)
    if (!banner || loadDismissed().includes(banner.id)) {
      setEntry(null)
      return
    }
    setEntry(banner)
  }, [audience, region])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  if (!entry) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify([...loadDismissed(), entry.id].slice(-50)))
    } catch {
      undefined
    }
    setEntry(null)
  }

  return (
    <div className="mt-2 overflow-hidden rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA]" role="status">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-start gap-2 px-3.5 py-3 text-left">
        <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-[#4A82B8]" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black text-[#0F172A]">{entry.title}</p>
          <p className={`mt-0.5 text-[11px] font-bold leading-4 text-[#475569] ${expanded ? '' : 'line-clamp-1'}`}>{entry.body}</p>
        </div>
        <span
          role="button"
          tabIndex={0}
          aria-label="공지 배너 닫기"
          onClick={(event) => {
            event.stopPropagation()
            dismiss()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.stopPropagation()
              dismiss()
            }
          }}
          className="shrink-0 rounded-full bg-white/70 p-1 text-[#64748B]"
        >
          <X className="h-3.5 w-3.5" />
        </span>
      </button>
    </div>
  )
}
