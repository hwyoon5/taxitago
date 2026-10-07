'use client'

import { useEffect, useMemo, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import type { AuditEntry } from '@/lib/audit-store'

const AUDIT_LABEL: Record<string, string> = {
  rates: '수수료율 변경',
  fare: '요금·수수료 설정',
  settle: '정산 처리',
  'settle-all': '일괄 정산',
  adjust: '수동 보정',
  reconcile: '내역 동기화',
  wallet: '지갑 주소 변경',
  deposit: '입금 기록',
  withdraw: '수수료 출금',
  login: '직원 로그인',
  staff: '직원 계정',
  partner: '기사·파트너',
  zone: '회피 구역',
  ticket: '문의·분실물',
}

const KIND_TONE: Record<string, string> = {
  login: 'bg-[#DCFCE7] text-[#15803D]',
  staff: 'bg-[#DBEAFE] text-[#1D4ED8]',
  withdraw: 'bg-[#FEE2E2] text-[#B91C1C]',
  settle: 'bg-[#EDE9FE] text-[#4C1FB8]',
  'settle-all': 'bg-[#EDE9FE] text-[#4C1FB8]',
  ticket: 'bg-[#FEF3C7] text-[#92400E]',
}

const PAGE_SIZE = 15

const dateKey = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

export default function AdminAuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [staffFilter, setStaffFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  const load = () => {
    setLoading(true)
    void fetch('/api/admin/audit', { headers: adminHeaders(), cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { entries?: AuditEntry[] } | null
        if (!res.ok) throw new Error('load_failed')
        setEntries(data?.entries ?? [])
      })
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const staffOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of entries) {
      if (entry.actor) map.set(entry.actor, entry.actorName || (entry.actor === 'master' ? '최고 관리자' : entry.actor))
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [entries])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (staffFilter && entry.actor !== staffFilter) return false
      if (kindFilter && entry.kind !== kindFilter) return false
      const day = dateKey(entry.createdAt)
      if (dateFrom && day < dateFrom) return false
      if (dateTo && day > dateTo) return false
      if (q) {
        const haystack = `${entry.actor} ${entry.actorName ?? ''} ${entry.detail ?? ''} ${entry.reason ?? ''} ${entry.refId ?? ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [entries, staffFilter, kindFilter, dateFrom, dateTo, query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const paged = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  useEffect(() => {
    setPage(0)
  }, [staffFilter, kindFilter, dateFrom, dateTo, query])

  return (
    <section className="mt-4 space-y-3">
      <div className="rounded-[24px] border-2 border-[#CBD5E1] bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-black text-[#4C1FB8]">필터 · {filtered.length}건</p>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-full border-2 border-[#D8CCF5] bg-white px-3 py-1.5 text-[10px] font-black text-[#4C1FB8] disabled:opacity-60"
          >
            {loading ? '불러오는 중…' : '새로고침'}
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <select
            value={staffFilter}
            onChange={(event) => setStaffFilter(event.target.value)}
            className="rounded-xl border-2 border-[#CBD5E1] px-2.5 py-2 text-xs font-bold outline-none focus:border-[#4C1FB8]"
          >
            <option value="">전체 직원</option>
            {staffOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}({id})
              </option>
            ))}
          </select>
          <select
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value)}
            className="rounded-xl border-2 border-[#CBD5E1] px-2.5 py-2 text-xs font-bold outline-none focus:border-[#4C1FB8]"
          >
            <option value="">전체 작업</option>
            {Object.entries(AUDIT_LABEL).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="rounded-xl border-2 border-[#CBD5E1] px-2.5 py-2 text-xs font-bold outline-none focus:border-[#4C1FB8]"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className="rounded-xl border-2 border-[#CBD5E1] px-2.5 py-2 text-xs font-bold outline-none focus:border-[#4C1FB8]"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="내용·사유·참조 검색"
            className="col-span-2 rounded-xl border-2 border-[#CBD5E1] px-3 py-2 text-xs font-bold outline-none focus:border-[#4C1FB8]"
          />
        </div>
        {dateFrom || dateTo ? (
          <button
            type="button"
            onClick={() => {
              setDateFrom('')
              setDateTo('')
            }}
            className="mt-2 rounded-full border-2 border-[#FCA5A5] bg-white px-2.5 py-1 text-[10px] font-black text-[#DC2626]"
          >
            날짜 해제
          </button>
        ) : null}
      </div>

      <div className="space-y-2">
        {!loading && !paged.length ? (
          <p className="rounded-2xl border-2 border-dashed border-[#CBD5E1] bg-white p-5 text-center text-sm font-bold text-[#64748B]">
            조건에 맞는 업무 기록이 없습니다.
          </p>
        ) : null}
        {paged.map((entry) => (
          <article key={entry.id} className="rounded-2xl border-2 border-[#E2E8F0] bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex min-w-0 items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${KIND_TONE[entry.kind] || 'bg-[#EDE9FE] text-[#4C1FB8]'}`}>
                  {AUDIT_LABEL[entry.kind] || entry.kind}
                </span>
                <span className="truncate text-[11px] font-black text-[#0F172A]">
                  {entry.actorName || (entry.actor === 'master' ? '최고 관리자' : entry.actor)}
                  <span className="font-bold text-[#94A3B8]"> · {entry.actor}</span>
                </span>
              </p>
              <span className="shrink-0 text-[10px] font-bold text-[#94A3B8]">
                {new Date(entry.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
            {entry.detail ? <p className="mt-1.5 text-xs font-bold leading-5 text-[#334155]">{entry.detail}</p> : null}
            {entry.reason ? <p className="mt-0.5 text-[11px] font-bold text-[#64748B]">사유: {entry.reason}</p> : null}
            {entry.refId ? <p className="mt-0.5 text-[10px] font-bold text-[#CBD5E1]">{entry.refId}</p> : null}
          </article>
        ))}
      </div>

      {filtered.length > PAGE_SIZE ? (
        <div className="flex items-center justify-between rounded-2xl border-2 border-[#CBD5E1] bg-white px-3 py-2">
          <button
            type="button"
            disabled={safePage === 0}
            onClick={() => setPage((prev) => Math.max(0, prev - 1))}
            className="rounded-full border-2 border-[#D8CCF5] bg-white px-3 py-1.5 text-[10px] font-black text-[#4C1FB8] disabled:opacity-40"
          >
            ‹ 이전
          </button>
          <span className="text-[11px] font-black text-[#64748B]">
            {filtered.length}건 · {safePage + 1}/{totalPages} 페이지
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
            className="rounded-full border-2 border-[#D8CCF5] bg-white px-3 py-1.5 text-[10px] font-black text-[#4C1FB8] disabled:opacity-40"
          >
            다음 ›
          </button>
        </div>
      ) : null}
    </section>
  )
}
