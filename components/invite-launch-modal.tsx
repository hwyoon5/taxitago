'use client'

import { Gift } from 'lucide-react'

export const INVITE_LAUNCH_NOTICE = '정식 배포(메인넷 런칭) 시 혜택이 최종 지급됩니다.'

export function InviteLaunchModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-[#1e1033]/50 p-5" onClick={onClose} role="presentation">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="invite-launch-title"
        className="w-full max-w-sm rounded-[28px] bg-white px-5 py-6 text-center shadow-[0_20px_48px_rgba(30,16,51,0.28)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#F3E8FF] text-[#4C1FB8]">
          <Gift className="h-7 w-7" />
        </div>
        <p className="mt-4 text-xs font-black tracking-wide text-[#4C1FB8]">친구 초대 혜택</p>
        <h2 id="invite-launch-title" className="mt-2 text-lg font-black leading-7 text-[#0F172A]">
          {INVITE_LAUNCH_NOTICE}
        </h2>
        <button type="button" onClick={onClose} className="mt-6 w-full rounded-2xl bg-[#4C1FB8] py-3.5 text-base font-black text-white">
          확인
        </button>
      </section>
    </div>
  )
}
