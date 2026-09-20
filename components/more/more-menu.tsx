'use client'

import Link from 'next/link'
import { Bell, ChevronRight, FileText, Headphones, Receipt, Settings } from 'lucide-react'
import { useLocale } from '@/components/locale-provider'
import type { MessageKey } from '@/lib/i18n'

export const moreItems = [
  { href: '/notice', id: 'notice', labelKey: 'more.notice', captionKey: 'more.noticeCaption', icon: Bell },
  { href: '/fares', id: 'fares', labelKey: 'more.fares', captionKey: 'more.faresCaption', icon: Receipt },
  { href: '/support', id: 'support', labelKey: 'more.support', captionKey: 'more.supportCaption', icon: Headphones },
  { href: '/terms', id: 'terms', labelKey: 'more.terms', captionKey: 'more.termsCaption', icon: FileText },
  { href: '/settings', id: 'settings', labelKey: 'more.settings', captionKey: 'more.settingsCaption', icon: Settings },
] as const

export type MoreItemId = (typeof moreItems)[number]['id']

export default function MoreMenu({ onOpen }: { onOpen?: (id: MoreItemId) => void }) {
  const { t } = useLocale()
  return (
    <div className="mt-5 space-y-2">
      {moreItems.map(({ href, id, labelKey, captionKey, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={(event) => {
            if (!onOpen) return
            event.preventDefault()
            onOpen(id)
          }}
          className="flex items-center gap-3 rounded-2xl border-2 border-[#CBD5E1] bg-white p-4 shadow-[0_8px_18px_rgba(15,23,42,0.1)] transition hover:border-[#4C1FB8] active:scale-[0.99]"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#B9A3F7] bg-[#E8DCFF] text-[#3B16A8]">
            <Icon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <strong className="block text-sm font-black">{t(labelKey as MessageKey)}</strong>
            <span className="mt-1 block text-xs font-bold text-[#475569]">{t(captionKey as MessageKey)}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-[#9a93a5]" />
        </Link>
      ))}
    </div>
  )
}
