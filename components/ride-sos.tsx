'use client'

import { useState } from 'react'
import { Siren, X } from 'lucide-react'
import { raiseSos } from '@/lib/support-client'
import type { SupportActor } from '@/lib/support-types'

function readGps(fallback: { lat: number; lng: number }) {
  return new Promise<{ lat: number; lng: number; accuracyM: number | null }>((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ ...fallback, accuracyM: null })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
      () => resolve({ ...fallback, accuracyM: null }),
      { enableHighAccuracy: true, timeout: 4000, maximumAge: 5000 },
    )
  })
}

export default function RideSosButton({
  rideId,
  actorId,
  role,
  fallbackLat,
  fallbackLng,
  vehicle,
  plate,
  onNotice,
}: {
  rideId: string
  actorId: string
  role: Exclude<SupportActor, 'admin'>
  fallbackLat: number
  fallbackLng: number
  vehicle?: string
  plate?: string
  onNotice?: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const submit = () => {
    if (busy) return
    setBusy(true)
    setError('')
    void readGps({ lat: fallbackLat, lng: fallbackLng })
      .then((gps) =>
        raiseSos({
          rideId,
          fromId: actorId,
          fromRole: role,
          lat: gps.lat,
          lng: gps.lng,
          accuracyM: gps.accuracyM,
          note: `${vehicle || '차량'} ${plate || ''}`.trim(),
        }),
      )
      .then((result) => {
        setDone(true)
        onNotice?.(result.duplicate ? '이미 접수된 긴급 신고가 있습니다. 운영센터가 확인 중입니다.' : '긴급 신고가 접수되었습니다. 위치와 차량 정보가 운영센터로 전달되었습니다.')
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '신고에 실패했어요.')
        setBusy(false)
      })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setDone(false)
          setError('')
        }}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-[#FECACA] bg-[#FEF2F2] py-3 text-sm font-black text-[#B91C1C]"
      >
        <Siren className="h-4 w-4" />
        긴급 SOS
      </button>
      {open ? (
        <div className="fixed inset-0 z-[110] flex items-end bg-[#1e1033]/60 p-0 sm:items-center sm:p-4">
          <section className="mx-auto w-full max-w-md rounded-t-[32px] bg-white p-5 shadow-2xl sm:rounded-[32px]">
            {done ? (
              <div className="py-6 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#B91C1C] text-white">
                  <Siren className="h-7 w-7" />
                </div>
                <h2 className="mt-4 text-xl font-black text-[#0F172A]">운영센터에 전달되었습니다</h2>
                <p className="mt-2 text-sm font-bold leading-6 text-[#475569]">현재 GPS와 차량 정보가 포함되었습니다. 위급하면 112에도 바로 연락해 주세요.</p>
                <button type="button" onClick={() => setOpen(false)} className="mt-5 w-full rounded-2xl bg-[#0F172A] py-3.5 text-sm font-black text-white">
                  닫기
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-black text-[#B91C1C]">긴급 신고</p>
                    <h2 className="mt-1 text-xl font-black text-[#0F172A]">위급 상황을 운영센터에 알릴까요?</h2>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} className="rounded-full bg-[#F1F5F9] p-2" aria-label="닫기">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <p className="mt-3 text-sm font-bold leading-6 text-[#475569]">
                  신고 즉시 현재 위치{vehicle ? ` · ${vehicle}` : ''}
                  {plate ? ` · ${plate}` : ''}이 함께 전송됩니다. 장난 신고는 제재될 수 있습니다.
                </p>
                {error ? <p className="mt-2 text-xs font-bold text-[#B91C1C]">{error}</p> : null}
                <button type="button" onClick={submit} disabled={busy} className="mt-5 w-full rounded-2xl bg-[#B91C1C] py-4 text-base font-black text-white disabled:opacity-60">
                  {busy ? '위치 전송 중…' : '지금 긴급 신고'}
                </button>
                <button type="button" onClick={() => setOpen(false)} className="mt-2 w-full py-3 text-sm font-bold text-[#64748B]">
                  취소
                </button>
              </>
            )}
          </section>
        </div>
      ) : null}
    </>
  )
}
