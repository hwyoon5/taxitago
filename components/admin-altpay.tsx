'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import type { AltPayFeeLedger, AltPayRecord } from '@/lib/altpay-store'

type AltPayState = {
  records: AltPayRecord[]
  ledgers: AltPayFeeLedger[]
  summary: { total: number; open: number; lockedProviders: number; outstanding: number }
}

const METHOD_LABEL: Record<string, string> = { card: '카드', cash: '현금', bank: '계좌이체', other: '기타' }
const SERVICE_LABEL: Record<string, string> = { taxi: '택시', daeri: '대리', delivery: '택배', bicycle: '자전거', kickboard: '킥보드', ev: 'EV 충전', parking: '주차' }
const STATUS_LABEL: Record<string, string> = { open: '수수료 미입금', recovered: '수수료 회수 완료', waived: '면제' }

const fmtDate = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

const shortId = (id: string) => (id.length > 18 ? `${id.slice(0, 14)}…` : id)

/** 타 결제 수단 완료·미입금 수수료 이월 모니터링 — 완료 로그, 제공자별
 *  수수료 장부, 입금/면제/차단 해제 조치. */
export default function AdminAltPay() {
  const [state, setState] = useState<AltPayState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  const [tab, setTab] = useState<'records' | 'ledgers'>('records')

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/altpay', { headers: adminHeaders(), cache: 'no-store' }).catch(() => null)
    const data = (await res?.json().catch(() => null)) as AltPayState | null
    if (data?.records) setState(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const say = (message: string, isError = false) => {
    setError(isError ? message : '')
    setNotice(isError ? '' : message)
    if (!isError) window.setTimeout(() => setNotice(''), 3000)
  }

  const act = async (key: string, body: Record<string, unknown>, done: string) => {
    setBusyId(key)
    try {
      const res = await fetch('/api/admin/altpay', {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        say(data?.error || '처리 실패', true)
      } else {
        say(done)
        await load()
      }
    } finally {
      setBusyId('')
    }
  }

  if (loading && !state) return <p className="py-10 text-center text-sm font-bold text-[#94A3B8]">불러오는 중…</p>
  const summary = state?.summary

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-3">
          <p className="text-[10px] font-black text-[#64748B]">타 결제 완료</p>
          <p className="mt-1 text-xl font-black text-[#0F172A]">{summary?.total ?? 0}건</p>
        </div>
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-3">
          <p className="text-[10px] font-black text-[#64748B]">수수료 미입금 건</p>
          <p className="mt-1 text-xl font-black text-[#B45309]">{summary?.open ?? 0}건</p>
        </div>
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-3">
          <p className="text-[10px] font-black text-[#64748B]">미입금 잔액 합계</p>
          <p className="mt-1 text-xl font-black text-[#B45309]">{(summary?.outstanding ?? 0).toFixed(2)} Pi</p>
        </div>
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-3">
          <p className="text-[10px] font-black text-[#64748B]">자동 차단 제공자</p>
          <p className="mt-1 text-xl font-black text-[#B91C1C]">{summary?.lockedProviders ?? 0}명</p>
        </div>
      </div>
      {notice ? <p className="rounded-xl bg-[#DCFCE7] px-3 py-2 text-xs font-black text-[#15803D]">{notice}</p> : null}
      {error ? <p className="rounded-xl bg-[#FEE2E2] px-3 py-2 text-xs font-black text-[#B91C1C]">{error}</p> : null}

      <div className="flex gap-1.5">
        {(
          [
            ['records', `완료 로그 ${summary?.total ?? 0}`],
            ['ledgers', `제공자 수수료 장부 ${state?.ledgers.length ?? 0}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-xl px-3 py-2 text-xs font-black ${tab === id ? 'bg-[#0F172A] text-white' : 'bg-white text-[#475569] ring-1 ring-[#E2E8F0]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'records' ? (
        <div className="space-y-2">
          {state?.records.length ? (
            state.records.map((row) => (
              <div key={row.id} className="rounded-2xl border border-[#E2E8F0] bg-white p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-[#0F172A]">
                      {SERVICE_LABEL[row.service] || row.service} · {row.amount.toFixed(2)} Pi
                      <span className="ml-1.5 text-[11px] font-bold text-[#64748B]">({METHOD_LABEL[row.method] || row.method})</span>
                    </p>
                    <p className="mt-1 text-[11px] font-bold text-[#475569]">
                      이용자 {shortId(row.userId)} → 제공자 {row.providerName || shortId(row.providerId)}
                      {row.refId ? ` · ${row.refId}` : ''}
                    </p>
                    <p className="mt-0.5 text-[10px] font-bold text-[#94A3B8]">
                      사유: {row.reason} · 수수료 {row.fee.toFixed(2)} Pi(율 {row.feeRate}%)
                      {row.recovered > 0 ? ` · 회수 ${row.recovered.toFixed(2)} Pi` : ''} · {fmtDate(row.at)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${
                      row.status === 'open' ? 'bg-[#FEF3C7] text-[#B45309]' : row.status === 'waived' ? 'bg-[#F1F5F9] text-[#64748B]' : 'bg-[#DCFCE7] text-[#15803D]'
                    }`}
                  >
                    {STATUS_LABEL[row.status] || row.status}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <p className="rounded-2xl border border-dashed border-[#E2E8F0] py-8 text-center text-xs font-bold text-[#94A3B8]">타 결제 수단으로 완료된 이용이 없습니다</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {state?.ledgers.length ? (
            state.ledgers.map((row) => (
              <div key={row.providerId} className="rounded-2xl border border-[#E2E8F0] bg-white p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-[#0F172A]">{row.providerName || shortId(row.providerId)}</p>
                    <p className="mt-0.5 text-[10px] font-bold text-[#94A3B8]">{shortId(row.providerId)} · 누적 {row.count}회 · 발생 {row.accrued.toFixed(2)} · 회수 {row.recovered.toFixed(2)} · 면제 {row.waived.toFixed(2)}</p>
                    <p className="mt-1 text-base font-black text-[#B45309]">미입금 {row.balance.toFixed(2)} Pi</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${row.lockedAt ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#DCFCE7] text-[#15803D]'}`}>
                    {row.lockedAt ? `자동 차단 · ${fmtDate(row.lockedAt)}` : '정상'}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {row.balance > 0 ? (
                    <>
                      <button
                        type="button"
                        disabled={busyId === `settle-${row.providerId}`}
                        onClick={() => void act(`settle-${row.providerId}`, { action: 'settle', providerId: row.providerId }, '수수료 입금 처리 완료')}
                        className="rounded-xl bg-[#0F766E] px-3 py-2 text-[11px] font-black text-white disabled:opacity-50"
                      >
                        전액 입금 처리
                      </button>
                      <button
                        type="button"
                        disabled={busyId === `waive-${row.providerId}`}
                        onClick={() => void act(`waive-${row.providerId}`, { action: 'waive', providerId: row.providerId }, '수수료 면제 완료')}
                        className="rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 text-[11px] font-black text-[#475569] disabled:opacity-50"
                      >
                        전액 면제
                      </button>
                    </>
                  ) : null}
                  {row.lockedAt ? (
                    <button
                      type="button"
                      disabled={busyId === `unlock-${row.providerId}`}
                      onClick={() => void act(`unlock-${row.providerId}`, { action: 'unlock', providerId: row.providerId }, '차단 해제 완료')}
                      className="rounded-xl bg-[#B91C1C] px-3 py-2 text-[11px] font-black text-white disabled:opacity-50"
                    >
                      차단 해제
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <p className="rounded-2xl border border-dashed border-[#E2E8F0] py-8 text-center text-xs font-bold text-[#94A3B8]">미입금 수수료 장부가 없습니다</p>
          )}
        </div>
      )}
      <p className="text-[10px] font-bold leading-4 text-[#94A3B8]">
        미입금 수수료는 다음 정상 정산 시 제공자 net에서 자동 합산 차감되고, 잔액이 0이 되면 자동 차단이 해제됩니다. 15초 간격으로 자동 새로고침됩니다.
      </p>
    </div>
  )
}
