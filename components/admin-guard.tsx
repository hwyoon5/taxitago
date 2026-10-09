'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import AdminLogin from '@/components/admin-login'
import { adminLogout, getAdminKey, setAdminKey } from '@/lib/admin-key'

export type AdminActorInfo = { staffId: string; staffName: string; role: 'master' | 'manager' | 'staff'; position?: string }

type AdminAuthContextValue = { logout: () => void; actor: AdminActorInfo | null }

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null)

export function useAdminAuth() {
  const context = useContext(AdminAuthContext)
  return { logout: context?.logout ?? (() => void adminLogout()), actor: context?.actor ?? null }
}

type GateState = 'checking' | 'login' | 'setup' | 'authed'

const MAX_AUTH_RETRIES = 4

export default function AdminGuard({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<GateState>('checking')
  const [actor, setActor] = useState<AdminActorInfo | null>(null)
  const cancelledRef = useRef(false)

  const checkAuth = useCallback((attempt = 0) => {
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
          definite: res.ok,
          authenticated: Boolean(res.ok && data?.authenticated),
          needsSetup: Boolean(res.ok && data?.needsSetup),
          actor: data?.actor ?? null,
        }
      })
      .catch(() => ({ definite: false, authenticated: false, needsSetup: false, actor: null }))
      .then(({ definite, authenticated, needsSetup, actor: nextActor }) => {
        if (cancelledRef.current) return
        if (authenticated) {
          setActor(nextActor)
          setGate('authed')
          return
        }
        if (!definite) {
          // 네트워크/서버 일시 오류 — 세션이 무효인지 알 수 없으므로 토큰을
          // 지우지 않고 잠시 후 다시 확인한다.
          if (attempt < MAX_AUTH_RETRIES) {
            window.setTimeout(() => checkAuth(attempt + 1), 1200)
            return
          }
          setActor(null)
          setGate('login')
          return
        }
        // 서버가 명시적으로 미인증이라고 답한 경우에만 토큰을 폐기한다.
        setAdminKey('')
        setActor(null)
        setGate(needsSetup ? 'setup' : 'login')
      })
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    checkAuth()
    return () => {
      cancelledRef.current = true
    }
  }, [checkAuth])

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
