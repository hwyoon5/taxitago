'use client'

import Link from 'next/link'
import { Bell, ChevronRight, Headphones, Receipt, Settings } from 'lucide-react'

const moreItems = [
  { href: '/notice', label: '공지사항', caption: '서비스 소식과 업데이트', icon: Bell },
  { href: '/fares', label: '이용요금 안내', caption: '기본요금과 구간 요금', icon: Receipt },
  { href: '/support', label: '고객센터', caption: '1:1 문의와 주요 안내', icon: Headphones },
  { href: '/settings', label: '앱 설정', caption: '알림 및 환경설정', icon: Settings },
]

export default function MoreMenu() {
  return (
    <div className="mt-5 space-y-2">
      {moreItems.map(({ href, label, caption, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex items-center gap-3 rounded-2xl border-2 border-[#CBD5E1] bg-white p-4 shadow-[0_8px_18px_rgba(15,23,42,0.1)] transition hover:border-[#4C1FB8] active:scale-[0.99]"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#B9A3F7] bg-[#E8DCFF] text-[#3B16A8]">
            <Icon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <strong className="block text-sm font-black">{label}</strong>
            <span className="mt-1 block text-xs font-bold text-[#475569]">{caption}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-[#9a93a5]" />
        </Link>
      ))}
    </div>
  )
}
