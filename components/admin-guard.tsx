'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import AdminLogin from '@/components/admin-login'
import { adminLogout, getAdminKey, setAdminKey } from '@/lib/admin-key'

type AdminAuthContextValue = { logout: () => void }

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null)

export function useAdminAuth() {
  const context = useContext(AdminAuthContext)
  return { logout: context?.logout ?? (() => void adminLogout()) }
}

export default function AdminGuard({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    const token = getAdminKey()
    fetch('/api/admin/session', {
      method: 'GET',
      headers: token ? { 'x-admin-key': token } : {},
      cache: 'no-store',
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { authenticated?: boolean } | null
        return Boolean(res.ok && data?.authenticated)
      })
      .then((ok) => {
        if (cancelled) return
        if (!ok) setAdminKey('')
        setAuthed(ok)
      })
      .catch(() => {
        if (!cancelled) setAuthed(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const logout = () => {
    void adminLogout()
    setAuthed(false)
  }

  if (authed === null) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-sm items-center justify-center bg-[#F8FAFC] text-sm font-bold text-[#64748B]">
        관리자 권한을 확인하는 중…
      </main>
    )
  }
  if (!authed) return <AdminLogin onSuccess={() => setAuthed(true)} />
  return <AdminAuthContext.Provider value={{ logout }}>{children}</AdminAuthContext.Provider>
}
