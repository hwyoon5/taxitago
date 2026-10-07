'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import AdminLogin from '@/components/admin-login'
import { adminLogout, getAdminKey, setAdminKey } from '@/lib/admin-key'

export type AdminActorInfo = { staffId: string; staffName: string; role: 'master' | 'manager' | 'staff' }

type AdminAuthContextValue = { logout: () => void; actor: AdminActorInfo | null }

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null)

export function useAdminAuth() {
  const context = useContext(AdminAuthContext)
  return { logout: context?.logout ?? (() => void adminLogout()), actor: context?.actor ?? null }
}

type GateState = 'checking' | 'login' | 'setup' | 'authed'

export default function AdminGuard({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<GateState>('checking')
  const [actor, setActor] = useState<AdminActorInfo | null>(null)

  const checkAuth = () => {
    const token = getAdminKey()
    fetch('/api/admin/auth', {
      method: 'GET',
      headers: token ? { 'x-admin-key': token } : {},
      cache: 'no-store',
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as {
          authenticated?: boolean
          needsSetup?: boolean
          actor?: AdminActorInfo | null
        } | null
        return {
          authenticated: Boolean(res.ok && data?.authenticated),
          needsSetup: Boolean(res.ok && data?.needsSetup),
          actor: data?.actor ?? null,
        }
      })
      .then(({ authenticated, needsSetup, actor: nextActor }) => {
        if (authenticated) {
          setActor(nextActor)
          setGate('authed')
          return
        }
        setAdminKey('')
        setActor(null)
        setGate(needsSetup ? 'setup' : 'login')
      })
      .catch(() => {
        setAdminKey('')
        setActor(null)
        setGate('login')
      })
  }

  useEffect(() => {
    let cancelled = false
    const token = getAdminKey()
    fetch('/api/admin/auth', {
      method: 'GET',
      headers: token ? { 'x-admin-key': token } : {},
      cache: 'no-store',
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as {
          authenticated?: boolean
          needsSetup?: boolean
          actor?: AdminActorInfo | null
        } | null
        return {
          authenticated: Boolean(res.ok && data?.authenticated),
          needsSetup: Boolean(res.ok && data?.needsSetup),
          actor: data?.actor ?? null,
        }
      })
      .then(({ authenticated, needsSetup, actor: nextActor }) => {
        if (cancelled) return
        if (authenticated) {
          setActor(nextActor)
          setGate('authed')
          return
        }
        setAdminKey('')
        setActor(null)
        setGate(needsSetup ? 'setup' : 'login')
      })
      .catch(() => {
        if (!cancelled) {
          setAdminKey('')
          setActor(null)
          setGate('login')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const logout = () => {
    void adminLogout()
    setActor(null)
    setGate('login')
  }

  if (gate === 'checking') {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-sm items-center justify-center bg-[#F8FAFC] text-sm font-bold text-[#64748B]">
        관리자 권한을 확인하는 중…
      </main>
    )
  }
  if (gate !== 'authed') {
    return <AdminLogin mode={gate} onSuccess={checkAuth} />
  }
  return <AdminAuthContext.Provider value={{ logout, actor }}>{children}</AdminAuthContext.Provider>
}
