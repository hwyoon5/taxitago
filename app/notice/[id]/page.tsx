'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { NoticeDetailView } from '@/components/more/more-pages'

export default function NoticeDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md bg-[#F8FAFC] px-4 py-6">
      <Link href="/notice" className="mb-4 inline-flex items-center gap-1 text-sm font-black text-[#4C1FB8]">
        <ChevronLeft className="h-4 w-4" />
        공지사항
      </Link>
      <NoticeDetailView id={params.id} onBack={() => router.push('/notice')} />
    </main>
  )
}
