'use client'

import { useParams, useRouter } from 'next/navigation'
import { TermsDetailView } from '@/components/more/terms-pages'

export default function TermsDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-[#F5F6F8]">
      <TermsDetailView id={params.id} onBack={() => router.push('/terms')} />
    </main>
  )
}
