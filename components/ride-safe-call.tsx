'use client'

import { useEffect, useState } from 'react'
import { Phone, PhoneOff } from 'lucide-react'
import { startSafeCallSession, updateSafeCall } from '@/lib/comms-client'
import type { CommsRole, PublicSafeCall } from '@/lib/comms-types'

export default function RideSafeCall({
  rideId,
  actorId,
  role,
  peerName,
  onHangup,
}: {
  rideId: string
  actorId: string
  role: CommsRole
  peerName: string
  onHangup: () => void
}) {
  const [call, setCall] = useState<PublicSafeCall | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void startSafeCallSession(rideId, actorId, role)
      .then((next) => {
        if (cancelled) return
        setCall(next)
        window.setTimeout(() => {
          void updateSafeCall(rideId, actorId, role, 'answer').then((live) => {
            if (!cancelled) setCall(live)
          })
        }, 1400)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '안심 통화에 실패했어요.')
      })
    return () => {
      cancelled = true
    }
  }, [rideId, actorId, role])

  const hangup = () => {
    void updateSafeCall(rideId, actorId, role, 'hangup').finally(onHangup)
  }

  const talking = call?.status === 'active'
  return (
    <div className="fixed inset-0 z-[97] flex items-center justify-center bg-[#1e1033]/70 p-6">
      <section className="w-full max-w-sm rounded-[32px] bg-white p-6 text-center shadow-2xl">
        <p className="text-xs font-black text-[#4C1FB8]">안심번호 통화</p>
        <div className="relative mx-auto mt-5 flex h-28 w-28 items-center justify-center">
          <span className={`absolute inset-0 rounded-full border-2 border-[#C4B5FD] ${talking ? 'animate-pulse' : 'animate-ping'}`} />
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#4C1FB8] text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)]">
            <Phone className="h-8 w-8" />
          </span>
        </div>
        <h3 className="mt-5 text-xl font-black text-[#0F172A]">{peerName}</h3>
        <p className="mt-1 font-mono text-sm font-black text-[#4C1FB8]">{call?.peerVirtualNumber || '050-****-****'}</p>
        <p className="mt-1 text-[11px] font-bold text-[#64748B]">내 안심번호 {call?.myVirtualNumber || '배정 중'}</p>
        <p className="mt-2 text-sm font-bold text-[#64748B]">
          {error || (talking ? '통화 중 · 실제 번호는 노출되지 않습니다' : '가상 번호로 연결 중입니다...')}
        </p>
        <a
          href={call?.peerVirtualNumber ? `tel:${call.peerVirtualNumber.replace(/-/g, '')}` : undefined}
          className="mt-4 inline-block text-xs font-black text-[#4C1FB8]"
        >
          안심번호로 전화 앱 열기
        </a>
        <button type="button" onClick={hangup} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#BE123C] py-3.5 font-black text-white">
          <PhoneOff className="h-5 w-5" />
          끊기
        </button>
      </section>
    </div>
  )
}
