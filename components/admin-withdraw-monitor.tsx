'use client'

import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { adminHeaders } from '@/lib/admin-key'
import type { WithdrawalRequest } from '@/lib/withdrawal-queue'

const STATUS_LABEL: Record<WithdrawalRequest['status'], string> = {
  pending: '승인 대기',
  approved: '승인 완료',
  rejected: '거절',
  sent: '즉시 전송',
  failed: '실패',
}

const STATUS_TONE: Record<WithdrawalRequest['status'], string> = {
  pending: 'bg-[#FEF3C7] text-[#B45309]',
  approved: 'bg-[#DCFCE7] text-[#15803D]',
  rejected: 'bg-[#FEE2E2] text-[#B91C1C]',
  sent: 'bg-[#DBEAFE] text-[#1D4ED8]',
  failed: 'bg-[#FEE2E2] text-[#B91C1C]',
}

const isToday = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

/** 마스터 대시보드용 — 직원이 집행한 출금·송금 내역을 실시간으로 노출한다. */
export default function AdminWithdrawMonitor() {
  const [requests, setRequests] = useState<WithdrawalRequest[]>([])

  const load = () => {
    void fetch('/api/admin/withdraw', { headers: adminHeaders(), cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { requests?: WithdrawalRequest[] } | null
        if (res.ok) setRequests(data?.requests ?? [])
      })
      .catch(() => undefined)
  }

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 15000)
    return () => window.clearInterval(timer)
  }, [])

  if (!requests.length) return null

  const pending = requests.filter((row) => row.status === 'pending')
  const staffToday = requests.filter(
    (row) => row.requestedBy !== 'master' && (row.status === 'sent' || row.status === 'approved') && isToday(row.createdAt),
  )
  const todayTotal = staffToday.reduce((sum, row) => sum + row.amount, 0)

  return (
    <section className={`rounded-2xl border-2 p-3 ${pending.length ? 'border-[#FCA5A5] bg-[#FEF2F2]' : 'border-[#FDE68A] bg-[#FFFBEB]'}`}>
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1 text-[11px] font-black text-[#B45309]">
          <ShieldAlert size={13} /> 직원 자금 집행 모니터
        </p>
        <button
          type="button"
          onClick={load}
          className="rounded-full border border-[#FDE68A] bg-white px-2 py-0.5 text-[9px] font-black text-[#B45309]"
        >
          새로고침
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`rounded-full px-2 py-1 text-[10px] font-black ${pending.length ? 'bg-[#DC2626] text-white' : 'bg-white text-[#64748B]'}`}>
          승인 대기 {pending.length}건
        </span>
        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-[#1D4ED8]">
          오늘 직원 전송 {staffToday.length}건 · {todayTotal.toFixed(3)} Pi
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {requests.slice(0, 5).map((row) => (
          <p key={row.id} className="truncate text-[10px] font-bold text-[#78716C]">
            {new Date(row.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {' · '}
            <span className="font-black text-[#0F172A]">{row.amount.toFixed(4)} Pi</span>
            {' → '}
            {row.recipient.slice(0, 10)}…
            {' · '}
            {row.requestedByName || row.requestedBy}
            {' · '}
            <span className={`rounded-full px-1 py-0.5 text-[9px] font-black ${STATUS_TONE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
            {row.flag ? ` · ${row.flag}` : ''}
          </p>
        ))}
      </div>
    </section>
  )
}
