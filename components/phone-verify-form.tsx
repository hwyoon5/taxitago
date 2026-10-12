'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale } from '@/components/locale-provider'
import { digitsOnly, formatKoreanPhone, isValidKoreanPhone } from '@/lib/phone'

const RESEND_COOLDOWN_SEC = 60

/**
 * 휴대전화 SMS 인증 폼 — POST /api/phone-verify(send/confirm) 시뮬레이션.
 * 번호가 바뀌면 인증 상태를 초기화하고, onVerified는 confirm 성공 시에만 호출된다.
 */
export default function PhoneVerifyForm({
  initialPhone = '',
  onVerified,
}: {
  initialPhone?: string
  onVerified: (phone: string) => void
}) {
  const { t } = useLocale()
  const [phone, setPhone] = useState(initialPhone)
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [devCode, setDevCode] = useState('')
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState<'send' | 'confirm' | null>(null)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const cooldownRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (cooldownRef.current !== null) window.clearInterval(cooldownRef.current)
    }
  }, [])

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN_SEC)
    if (cooldownRef.current !== null) window.clearInterval(cooldownRef.current)
    cooldownRef.current = window.setInterval(() => {
      setCooldown((value) => {
        if (value <= 1 && cooldownRef.current !== null) {
          window.clearInterval(cooldownRef.current)
          cooldownRef.current = null
          return 0
        }
        return value - 1
      })
    }, 1000)
  }

  const changePhone = (value: string) => {
    setPhone(formatKoreanPhone(value))
    // 번호가 바뀌면 이전 인증은 무효 — 재발송·재인증을 강제한다.
    setSent(false)
    setCode('')
    setDevCode('')
    setVerified(false)
    setError('')
  }

  const send = async () => {
    if (busy || cooldown > 0) return
    const digits = digitsOnly(phone)
    if (!isValidKoreanPhone(digits)) {
      setError(t('phone.errPhone'))
      return
    }
    setBusy('send')
    setError('')
    try {
      const res = await fetch('/api/phone-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', phone: digits }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; devCode?: string } | null
      if (!res.ok || !data?.ok) {
        setError(t('phone.errSend'))
        return
      }
      setSent(true)
      setDevCode(typeof data.devCode === 'string' ? data.devCode : '')
      setCode('')
      setVerified(false)
      startCooldown()
    } catch {
      setError(t('phone.errSend'))
    } finally {
      setBusy(null)
    }
  }

  const confirm = async () => {
    if (busy || !sent) return
    if (!/^\d{6}$/.test(code.trim())) {
      setError(t('phone.errCode'))
      return
    }
    setBusy('confirm')
    setError('')
    try {
      const res = await fetch('/api/phone-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', phone: digitsOnly(phone), code: code.trim() }),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null
      if (!res.ok || !data?.ok) {
        setError(t('phone.errCode'))
        return
      }
      setVerified(true)
      setDevCode('')
      onVerified(formatKoreanPhone(phone))
    } catch {
      setError(t('phone.errCode'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <input
          value={phone}
          onChange={(event) => changePhone(event.target.value)}
          placeholder={t('phone.placeholder')}
          inputMode="tel"
          disabled={verified}
          className="min-w-0 flex-1 rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8] disabled:opacity-70"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={verified || busy === 'send' || cooldown > 0 || !phone.trim()}
          className="shrink-0 rounded-2xl bg-[#4A82B8] px-4 text-xs font-black text-white shadow-[0_6px_14px_rgba(74,130,184,0.28)] transition hover:bg-[#3F74A8] disabled:opacity-50"
        >
          {busy === 'send' ? t('phone.sending') : sent ? (cooldown > 0 ? `${t('phone.resend')} (${cooldown}s)` : t('phone.resend')) : t('phone.send')}
        </button>
      </div>
      {sent && !verified ? (
        <>
          <p className="text-[11px] font-bold text-[#047857]">
            {t('phone.sent')}
            {devCode ? ` ${t('phone.devHint', { code: devCode })}` : ''}
          </p>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={t('phone.codePlaceholder')}
              inputMode="numeric"
              className="min-w-0 flex-1 rounded-2xl border-2 border-[#BFDBFE] bg-white px-4 py-3 text-sm font-bold tracking-[0.3em] outline-none focus:border-[#4A82B8]"
            />
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy === 'confirm' || code.trim().length !== 6}
              className="shrink-0 rounded-2xl bg-[#0F172A] px-4 text-xs font-black text-white disabled:opacity-50"
            >
              {busy === 'confirm' ? t('phone.confirming') : t('phone.confirm')}
            </button>
          </div>
        </>
      ) : null}
      {verified ? (
        <p className="flex items-center gap-1.5 text-xs font-black text-[#047857]">
          <span className="inline-block h-2 w-2 rounded-full bg-[#10B981]" />
          {t('phone.verified')} · {formatKoreanPhone(phone)}
        </p>
      ) : null}
      {error ? <p className="text-xs font-bold text-[#BE123C]">{error}</p> : null}
    </div>
  )
}
