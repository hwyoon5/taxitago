'use client'

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { FaresView } from '@/components/more/more-pages'

export default function FaresPage() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md bg-[#F8FAFC] px-4 py-6">
      <Link href="/" className="mb-4 inline-flex items-center gap-1 text-sm font-black text-[#4C1FB8]">
        <ChevronLeft className="h-4 w-4" />
        홈
      </Link>
      <FaresView onBack={() => history.back()} />
    </main>
  )
}
