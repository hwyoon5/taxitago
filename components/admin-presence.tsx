'use client'

import { useEffect, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import type { StaffPresence } from '@/lib/admin-presence-store'

const BEAT_MS = 30_000
const POLL_MS = 20_000

/**
 * 관리자 접속 현황 위젯 — 화면이 열려 있는 동안 30초마다 하트비트를 보내
 * '근무 중'으로 표시되고, 20초마다 동료 접속자 목록을 갱신한다.
 * 탭을 닫거나 로그아웃하면 다음 폴링(최대 90초)부터 목록에서 빠진다.
 */
export default function AdminPresence() {
  const [staff, setStaff] = useState<StaffPresence[]>([])
  const [self, setSelf] = useState('')

  useEffect(() => {
    let alive = true
    const beat = () => {
      void fetch('/api/admin/presence', { method: 'POST', headers: adminHeaders() }).catch(() => undefined)
    }
    const load = () => {
      void fetch('/api/admin/presence', { headers: adminHeaders(), cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { staff?: StaffPresence[]; self?: string } | null) => {
          if (!alive || !data) return
          setStaff(data.staff ?? [])
          setSelf(data.self ?? '')
        })
        .catch(() => undefined)
    }
    beat()
    load()
    const beatTimer = window.setInterval(beat, BEAT_MS)
    const pollTimer = window.setInterval(load, POLL_MS)
    // 탭이 닫힐 때 마지막으로 접속 해제를 시도한다(keepalive).
    const drop = () => {
      try {
        void fetch('/api/admin/presence', { method: 'DELETE', headers: adminHeaders(), keepalive: true })
      } catch {
        undefined
      }
    }
    window.addEventListener('pagehide', drop)
    return () => {
      alive = false
      window.clearInterval(beatTimer)
      window.clearInterval(pollTimer)
      window.removeEventListener('pagehide', drop)
      drop()
    }
  }, [])

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border-2 border-[#CBD5E1] bg-white px-3 py-2">
      <span className="flex items-center gap-1.5 text-[11px] font-black text-[#047857]">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#22C55E]" />
        </span>
        근무 중 {staff.length}명
      </span>
      {staff.map((member) => (
        <span
          key={member.staffId}
          className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
            member.staffId === self ? 'bg-[#4C1FB8] text-white' : 'bg-[#F1F5F9] text-[#475569]'
          }`}
        >
          {member.staffName}
          {member.position ? ` · ${member.position}` : ''}
          {member.staffId === self ? ' (나)' : ''}
        </span>
      ))}
    </div>
  )
}
