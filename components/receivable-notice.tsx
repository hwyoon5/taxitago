'use client'

import { AlertTriangle, Headset, Mail, Phone, X } from 'lucide-react'
import { useLocale } from '@/components/locale-provider'
import { SUPPORT_EMAIL, SUPPORT_MAILTO, SUPPORT_PHONE, SUPPORT_TEL } from '@/lib/contact-info'

export type ReceivableNotice = {
  /** 미수 금액 (Pi) */
  amount: number
  /** 서비스 표시명 (예: '자전거 이용') */
  service: string
  /** 이용 장소/구간 */
  place: string
  /** 서비스 제공자(파트너) 상호 */
  partnerName: string
  /** 제공자 연락처 — 등록된 경우만 */
  partnerPhone: string
  /** 이용자에게 보여 줄 실패 사유 */
  reason: string
  /** 누적 페널티 포인트 — 서버 응답 도착 후 채워진다 */
  points?: number
  /** 이용 제한 해제 시각 — 제한 중이면 ISO 문자열 */
  restrictedUntil?: string | null
}

/**
 * 셀프·무인 서비스 종료 시점 결제 실패 안내 시트.
 * - 잔액 부족 등으로 Pi 결제가 완료되지 않았음을 즉시 알린다.
 * - 미수금이 서버 장부에 기록됐음을 안내하고, 제공자·고객센터 연락처를 보여
 *   계좌이체 등 다른 수단으로 정산하도록 유도한다.
 * - [다시 결제하기]는 시트를 닫고 결제 버튼을 다시 누르게 하는 경로다.
 */
export default function ReceivableNoticeSheet({
  notice,
  onClose,
}: {
  notice: ReceivableNotice
  onClose: () => void
}) {
  const { t } = useLocale()
  const insufficient = notice.reason === 'insufficient'
  const title = insufficient ? t('recv.titleInsufficient') : t('recv.titleFailed')

  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-[#0F172A]/50 sm:items-center" onClick={onClose}>
      <section
        className="w-full max-w-md rounded-t-[28px] bg-white px-5 pb-7 pt-4 shadow-2xl sm:rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="receivable-notice-title"
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-[#E2E8F0]" />
        <div className="flex items-center justify-between gap-2">
          <h3 id="receivable-notice-title" className="flex items-center gap-1.5 text-lg font-black text-[#0F172A]">
            <AlertTriangle className="h-5 w-5 text-[#D97706]" />
            {title}
          </h3>
          <button type="button" onClick={onClose} aria-label={t('settings.close')} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F1F5F9] text-[#64748B]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-[13px] font-bold leading-5 text-[#475569]">
          {insufficient ? t('recv.descInsufficient') : t('recv.descFailed')}
        </p>

        {/* 미수 내역 */}
        <div className="mt-4 rounded-2xl border-2 border-[#F59E0B] bg-[#FFFBEB] p-4">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-black text-[#92400E]">{t('recv.owed')}</p>
            <p className="text-lg font-black tabular-nums text-[#0F172A]">{notice.amount.toFixed(7)} Pi</p>
          </div>
          <p className="mt-1 text-[11px] font-bold leading-4 text-[#64748B]">
            {notice.service}
            {notice.place ? ` · ${notice.place}` : ''}
          </p>
          <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-[11px] font-black text-[#B45309]">
            {t('recv.recorded')}
          </p>
        </div>

        {/* 반복 미수 페널티·이용 제한 경고 */}
        {(notice.points ?? 0) > 0 ? (
          <p className="mt-3 rounded-2xl bg-[#FEF2F2] px-4 py-3 text-[11px] font-bold leading-5 text-[#B91C1C]">
            {t('recv.penalty', { points: String(notice.points ?? 0) })}
            {notice.restrictedUntil
              ? `\n${t('recv.restricted', { until: new Date(notice.restrictedUntil).toLocaleDateString() })}`
              : ''}
          </p>
        ) : null}

        {/* 제공자·고객센터 연락처 */}
        <div className="mt-3 rounded-2xl bg-[#F8FAFC] p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-black text-[#334155]">
            <Headset className="h-3.5 w-3.5 text-[#4A82B8]" />
            {t('recv.contactTitle')}
          </p>
          {notice.partnerName ? (
            <p className="mt-1.5 text-[11px] font-bold text-[#475569]">
              {t('recv.provider', { name: notice.partnerName })}
              {notice.partnerPhone ? ` · ${notice.partnerPhone}` : ''}
            </p>
          ) : null}
          <p className="mt-1.5 text-[11px] font-bold text-[#475569]">
            {t('recv.support')}
            {SUPPORT_PHONE ? ` · ${SUPPORT_PHONE}` : ''} · {SUPPORT_EMAIL}
          </p>
          <p className="mt-1.5 text-[11px] font-bold leading-4 text-[#64748B]">{t('recv.manualHint')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {SUPPORT_TEL ? (
              <a
                href={SUPPORT_TEL}
                className="inline-flex items-center justify-center gap-1.5 rounded-2xl border-2 border-[#BFDBFE] bg-white py-2.5 text-[12px] font-black text-[#4A82B8]"
              >
                <Phone className="h-3.5 w-3.5" />
                {t('recv.callSupport')}
              </a>
            ) : null}
            <a
              href={SUPPORT_MAILTO}
              className={`inline-flex items-center justify-center gap-1.5 rounded-2xl border-2 border-[#BFDBFE] bg-white py-2.5 text-[12px] font-black text-[#4A82B8] ${SUPPORT_TEL ? '' : 'col-span-2'}`}
            >
              <Mail className="h-3.5 w-3.5" />
              {t('recv.mailSupport')}
            </a>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-2xl bg-[#4A82B8] py-3.5 text-sm font-black text-white transition hover:bg-[#3F74A8] active:scale-[0.99]"
        >
          {t('recv.retry')}
        </button>
      </section>
    </div>
  )
}
