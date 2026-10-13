'use client'

import { useState } from 'react'
import { apiFetch } from '@/lib/app-origin'
import { useLocale } from '@/components/locale-provider'
import type { MessageKey } from '@/lib/i18n'

export type AppliedCoupon = { code: string; title: string; discount: number; payable: number }

const REJECT_KEYS: Record<string, MessageKey> = {
  not_found: 'coupon.errNotFound',
  inactive: 'coupon.errInactive',
  expired: 'coupon.errExpired',
  min_spend: 'coupon.errMinSpend',
  audience: 'coupon.errAudience',
  limit_total: 'coupon.errLimit',
  limit_user: 'coupon.errLimit',
}

/**
 * 결제 화면 공용 쿠폰 입력 — 코드 검증(/api/coupons) 후 적용 정보를 부모에 올린다.
 * 실제 차감·사용 기록은 payFromBalance(couponCode) → /api/wallet/spend에서 일어난다.
 */
export function CouponCodeField({
  uid,
  gross,
  onApplied,
}: {
  uid: string
  gross: number
  onApplied: (applied: AppliedCoupon | null) => void
}) {
  const { t } = useLocale()
  const [code, setCode] = useState('')
  const [applied, setApplied] = useState<AppliedCoupon | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  const apply = async () => {
    const trimmed = code.trim()
    if (!trimmed || !uid || checking) return
    setChecking(true)
    setError('')
    try {
      const res = await apiFetch(
        `/api/coupons?code=${encodeURIComponent(trimmed)}&uid=${encodeURIComponent(uid)}&amount=${gross}`,
        { cache: 'no-store' },
      )
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        coupon?: { code: string; title: string }
        discount?: number
        payable?: number
      } | null
      if (!data?.ok || !data.coupon) {
        setError(t(REJECT_KEYS[data?.error ?? ''] ?? 'coupon.errGeneric'))
        return
      }
      const next: AppliedCoupon = {
        code: data.coupon.code,
        title: data.coupon.title,
        discount: Number(data.discount) || 0,
        payable: Number(data.payable) || 0,
      }
      setApplied(next)
      onApplied(next)
    } catch {
      setError(t('coupon.errGeneric'))
    } finally {
      setChecking(false)
    }
  }

  const clear = () => {
    setApplied(null)
    setError('')
    onApplied(null)
  }

  if (applied) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-2xl border-2 border-[#BBF7D0] bg-[#ECFDF5] px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-black text-[#047857]">
            {applied.title || applied.code} · -{applied.discount.toFixed(7)} Pi
          </p>
          <p className="text-[10px] font-bold text-[#059669]">{t('coupon.payable', { v: applied.payable.toFixed(7) })}</p>
        </div>
        <button type="button" onClick={clear} className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-[#047857]">
          {t('coupon.remove')}
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] px-3 py-2">
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder={t('coupon.placeholder')}
          spellCheck={false}
          autoComplete="off"
          maxLength={24}
          className="w-full bg-transparent font-mono text-xs font-black text-[#0F172A] outline-none placeholder:font-sans placeholder:font-bold placeholder:text-[#94A3B8]"
        />
        <button
          type="button"
          disabled={!code.trim() || checking || !uid}
          onClick={() => void apply()}
          className="shrink-0 rounded-xl bg-[#4A82B8] px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-50"
        >
          {checking ? t('coupon.checking') : t('coupon.apply')}
        </button>
      </div>
      {error ? <p className="mt-1.5 text-center text-[11px] font-black text-[#DC2626]">{error}</p> : null}
    </div>
  )
}
