'use client'

import { useRouter } from 'next/navigation'
import { TermsListView } from '@/components/more/terms-pages'

export default function TermsPage() {
  const router = useRouter()
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-[#F5F6F8]">
      <TermsListView onBack={() => router.push('/')} onOpen={(id) => router.push(`/terms/${id}`)} />
    </main>
  )
}
