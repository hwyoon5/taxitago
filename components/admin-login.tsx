'use client'

import Link from 'next/link'
import { useState } from 'react'
import { adminLogin, adminResetPassword, adminSetup } from '@/lib/admin-key'

export default function AdminLogin({ mode, onSuccess }: { mode: 'login' | 'setup'; onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [setupPassword, setSetupPassword] = useState('')
  const [setupConfirm, setSetupConfirm] = useState('')

  const submitLogin = () => {
    const value = password.trim()
    if (!value || busy) return
    setBusy(true)
    setError('')
    void adminLogin(value)
      .then(() => {
        setPassword('')
        onSuccess()
      })
      .catch((loginError) => {
        const reason = loginError instanceof Error ? loginError.message : ''
        setError(reason === 'setup_required' ? '비밀번호가 아직 설정되지 않았습니다.' : '비밀번호가 올바르지 않습니다.')
      })
      .finally(() => setBusy(false))
  }

  const submitSetup = () => {
    const value = setupPassword.trim()
    if (!value || busy) return
    if (value.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (value !== setupConfirm) {
      setError('비밀번호가 서로 다릅니다.')
      return
    }
    setBusy(true)
    setError('')
    void adminSetup(value)
      .then(() => {
        setSetupPassword('')
        setSetupConfirm('')
        onSuccess()
      })
      .catch((setupError) => {
        const reason = setupError instanceof Error ? setupError.message : ''
        setError(
          reason === 'already_configured'
            ? '이미 비밀번호가 설정되어 있습니다. 로그인해 주세요.'
            : '설정에 실패했습니다. 잠시 후 다시 시도해 주세요.',
        )
      })
      .finally(() => setBusy(false))
  }

  const submitReset = () => {
    const code = otpCode.trim()
    if (!code || !newPassword || busy) return
    if (newPassword !== confirmPassword) {
      setError('새 비밀번호가 서로 다릅니다.')
      return
    }
    if (newPassword.trim().length < 8) {
      setError('새 비밀번호는 8자 이상이어야 합니다.')
      return
    }
    setBusy(true)
    setError('')
    void adminResetPassword(code, newPassword)
      .then(() => {
        setResetOpen(false)
        setOtpCode('')
        setNewPassword('')
        setConfirmPassword('')
        setNotice('비밀번호가 재설정되었습니다. 새 비밀번호로 로그인해 주세요.')
      })
      .catch((resetError) => {
        const reason = resetError instanceof Error ? resetError.message : ''
        setError(
          reason === 'totp_not_configured'
            ? 'OTP 인증이 설정되지 않았습니다. 서버에 ADMIN_TOTP_SECRET을 등록해 주세요.'
            : reason === 'invalid_code'
              ? '인증 번호가 올바르지 않습니다. Google OTP 앱의 6자리를 확인해 주세요.'
              : '재설정에 실패했습니다. 잠시 후 다시 시도해 주세요.',
        )
      })
      .finally(() => setBusy(false))
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center bg-[#F8FAFC] px-6 text-[#0F172A]">
      <p className="text-xs font-black text-[#4C1FB8]">ADMIN</p>
      {mode === 'setup' ? (
        <>
          <h1 className="mt-1 text-2xl font-black">관리자 비밀번호 설정</h1>
          <p className="mt-1 text-sm font-bold text-[#64748B]">최초 접속입니다. 관리자 비밀번호를 새로 설정해 주세요.</p>
          <input
            type="password"
            value={setupPassword}
            onChange={(event) => setSetupPassword(event.target.value)}
            placeholder="새 비밀번호 (8자 이상)"
            className="mt-4 w-full rounded-2xl border-2 border-[#CBD5E1] px-3 py-3 text-sm font-bold outline-none focus:border-[#4C1FB8]"
          />
          <input
            type="password"
            value={setupConfirm}
            onChange={(event) => setSetupConfirm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitSetup()
            }}
            placeholder="비밀번호 확인"
            className="mt-2 w-full rounded-2xl border-2 border-[#CBD5E1] px-3 py-3 text-sm font-bold outline-none focus:border-[#4C1FB8]"
          />
          {error ? <p className="mt-2 text-xs font-black text-[#DC2626]">{error}</p> : null}
          <button
            type="button"
            disabled={busy || !setupPassword}
            onClick={submitSetup}
            className="mt-3 w-full rounded-2xl bg-[#4C1FB8] py-3 text-sm font-black text-white disabled:opacity-60"
          >
            {busy ? '설정 중…' : '비밀번호 설정하고 시작'}
          </button>
        </>
      ) : (
        <>
          <h1 className="mt-1 text-2xl font-black">관리자 인증</h1>
          <p className="mt-1 text-sm font-bold text-[#64748B]">관리자 비밀번호를 입력해 주세요.</p>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitLogin()
            }}
            placeholder="관리자 비밀번호"
            className="mt-4 w-full rounded-2xl border-2 border-[#CBD5E1] px-3 py-3 text-sm font-bold outline-none focus:border-[#4C1FB8]"
          />
          {error ? <p className="mt-2 text-xs font-black text-[#DC2626]">{error}</p> : null}
          {notice ? <p className="mt-2 text-xs font-black text-[#047857]">{notice}</p> : null}
          <button
            type="button"
            disabled={busy}
            onClick={submitLogin}
            className="mt-3 w-full rounded-2xl bg-[#4C1FB8] py-3 text-sm font-black text-white disabled:opacity-60"
          >
            {busy ? '확인 중…' : '로그인'}
          </button>
          <button
            type="button"
            onClick={() => {
              setResetOpen((open) => !open)
              setError('')
            }}
            className="mt-3 w-full text-center text-xs font-black text-[#64748B]"
          >
            비밀번호를 잊으셨나요? Google OTP로 재설정
          </button>
          {resetOpen ? (
            <div className="mt-3 rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] p-4">
              <p className="text-xs font-black text-[#4C1FB8]">본인 인증 — Google OTP 6자리</p>
              <input
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="인증 번호 6자리"
                className="mt-2 w-full rounded-xl border-2 border-[#CBD5E1] px-3 py-2.5 text-center text-lg font-black tracking-[0.5em] outline-none focus:border-[#4C1FB8]"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="새 비밀번호 (8자 이상)"
                className="mt-2 w-full rounded-xl border-2 border-[#CBD5E1] px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4C1FB8]"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="새 비밀번호 확인"
                className="mt-2 w-full rounded-xl border-2 border-[#CBD5E1] px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4C1FB8]"
              />
              <button
                type="button"
                disabled={busy || otpCode.length !== 6 || !newPassword}
                onClick={submitReset}
                className="mt-2 w-full rounded-xl bg-[#0F172A] py-2.5 text-xs font-black text-white disabled:opacity-50"
              >
                {busy ? '처리 중…' : 'OTP 확인 후 비밀번호 재설정'}
              </button>
            </div>
          ) : null}
        </>
      )}
      <Link href="/" className="mt-3 text-center text-xs font-black text-[#64748B]">홈으로</Link>
    </main>
  )
}
