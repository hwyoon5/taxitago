'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { PaginationBar, PageSizeSelect, usePagination } from '@/components/admin-pagination'
import { adminHeaders } from '@/lib/admin-key'

export type AdminUserRow = {
  uid: string
  username: string
  wallet: string
  role?: string
  name?: string
  phone?: string
  region?: string
  serviceType?: string
  linkedAt: string
  updatedAt: string
  locked?: boolean
  lockedAt?: string
  lockedBy?: string
  lockReason?: string
  spendable?: number
  creditTotal?: number
  spendTotal?: number
}

type Stats = {
  total: number
  joinedThisMonth: number
  drivers: number
  locked: number
  monthly: { month: string; count: number }[]
}

const ROLE_LABEL: Record<string, string> = { 기사: '기사', 파트너: '파트너', 승객: '승객' }
const short = (value?: string) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—')
const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : '—')

export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [openUid, setOpenUid] = useState('')
  const [busy, setBusy] = useState(false)
  const [lockReason, setLockReason] = useState('')
  const [adjust, setAdjust] = useState<{ action: 'credit' | 'debit'; amount: string; reason: string }>({
    action: 'credit',
    amount: '',
    reason: '',
  })

  const tell = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2500)
  }

  const reload = useCallback((query: string) => {
    setLoading(true)
    void fetch(`/api/admin/users${query ? `?q=${encodeURIComponent(query)}` : ''}`, {
      headers: adminHeaders(),
      cache: 'no-store',
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error || 'load_failed')
        return data as { users: AdminUserRow[]; stats: Stats }
      })
      .then((data) => {
        setUsers(data.users)
        setStats(data.stats)
        setError('')
      })
      .catch(() => setError('가입자 목록을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => reload(q), 250)
    return () => window.clearTimeout(timer)
  }, [q, reload])

  const patch = (body: Record<string, unknown>) =>
    fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(body),
    }).then(async (res) => {
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'failed')
      return data
    })

  const post = (body: Record<string, unknown>) =>
    fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(body),
    }).then(async (res) => {
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'failed')
      return data
    })

  const toggleLock = (user: AdminUserRow) => {
    if (busy) return
    setBusy(true)
    void patch({ action: user.locked ? 'unlock' : 'lock', uid: user.uid, reason: lockReason.trim() })
      .then(() => {
        tell(user.locked ? '이용 정지를 해제했습니다.' : '계정을 이용 정지(Lock)했습니다.')
        setLockReason('')
        reload(q)
      })
      .catch((err) => setError(err instanceof Error && err.message !== 'failed' ? err.message : '처리에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const submitAdjust = (user: AdminUserRow) => {
    if (busy) return
    const amount = Number(adjust.amount)
    if (!Number.isFinite(amount) || amount <= 0 || !adjust.reason.trim()) return
    setBusy(true)
    void post({ action: adjust.action, uid: user.uid, wallet: user.wallet, amount, reason: adjust.reason.trim() })
      .then(() => {
        tell(adjust.action === 'credit' ? `+${amount} Pi 수동 입금을 반영했습니다.` : `-${amount} Pi 수동 출금을 반영했습니다.`)
        setAdjust({ action: 'credit', amount: '', reason: '' })
        reload(q)
      })
      .catch((err) => setError(err instanceof Error && err.message !== 'failed' ? err.message : '보정 처리에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const maxMonth = useMemo(() => Math.max(1, ...(stats?.monthly ?? []).map((m) => m.count)), [stats])
  const pg = usePagination(users, 10, [users])

  return (
    <div className="mt-4 space-y-4">
      {error ? <p className="text-xs font-black text-[#DC2626]">{error}</p> : null}

      {/* 가입자 통계 */}
      {stats ? (
        <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: '전체 가입자', value: stats.total, color: '#0F172A' },
              { label: '이번 달 가입', value: stats.joinedThisMonth, color: '#4C1FB8' },
              { label: '기사·파트너', value: stats.drivers, color: '#047857' },
              { label: '정지 계정', value: stats.locked, color: '#DC2626' },
            ].map((card) => (
              <div key={card.label} className="rounded-xl bg-[#F8FAFC] px-1 py-2.5">
                <p className="text-lg font-black" style={{ color: card.color }}>{card.value}</p>
                <p className="mt-0.5 text-[10px] font-black text-[#64748B]">{card.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <p className="text-[10px] font-black text-[#94A3B8]">최근 6개월 가입 추이</p>
            <div className="mt-1.5 flex h-20 items-end gap-1.5">
              {stats.monthly.map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[9px] font-black text-[#475569]">{m.count || ''}</span>
                  <div
                    className="w-full rounded-t-md bg-[#4C1FB8]/80"
                    style={{ height: `${Math.max(4, Math.round((m.count / maxMonth) * 56))}px` }}
                  />
                  <span className="text-[9px] font-bold text-[#94A3B8]">{m.month.slice(5)}월</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* 검색 + 페이지 크기 */}
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="이름 · 전화번호 · 지갑 주소 · UID 검색"
          className="min-w-0 flex-1 rounded-xl border-2 border-[#CBD5E1] bg-white px-4 py-2.5 text-sm font-bold outline-none focus:border-[#4C1FB8]"
        />
        <PageSizeSelect
          pageSize={pg.pageSize}
          onChange={pg.setPageSize}
          className="shrink-0 rounded-xl border-2 border-[#CBD5E1] bg-white px-2 py-2.5 text-xs font-black text-[#475569] outline-none focus:border-[#4C1FB8]"
        />
      </div>

      {/* 가입자 목록 */}
      <section className="space-y-2">
        {loading ? <p className="text-center text-xs font-bold text-[#94A3B8]">불러오는 중…</p> : null}
        {!loading && !users.length ? (
          <p className="rounded-2xl border-2 border-dashed border-[#CBD5E1] bg-white px-4 py-8 text-center text-xs font-bold text-[#94A3B8]">
            {q ? '검색 결과가 없습니다.' : '등록된 가입자가 없습니다.'}
          </p>
        ) : null}
        {pg.paged.map((user) => {
          const open = openUid === user.uid
          return (
            <div key={user.uid} className={`rounded-2xl border-2 bg-white p-3.5 ${user.locked ? 'border-[#FCA5A5]' : 'border-[#CBD5E1]'}`}>
              <button
                type="button"
                onClick={() => setOpenUid(open ? '' : user.uid)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-black text-[#0F172A]">
                    <span className="truncate">{user.name || user.username}</span>
                    <span className="rounded-full bg-[#EDE9FE] px-1.5 py-0.5 text-[9px] font-black text-[#4C1FB8]">
                      {ROLE_LABEL[user.role || ''] || user.role || '승객'}
                    </span>
                    {user.locked ? (
                      <span className="rounded-full bg-[#FEE2E2] px-1.5 py-0.5 text-[9px] font-black text-[#DC2626]">정지됨</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[10px] font-bold text-[#64748B]">
                    {short(user.wallet)} · {user.phone || '연락처 없음'}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-black text-[#0F172A]">{(user.spendable ?? 0)} Pi</p>
                  <p className="text-[9px] font-bold text-[#94A3B8]">가입 {fmtDate(user.linkedAt)}</p>
                </div>
              </button>

              {open ? (
                <div className="mt-3 space-y-2.5 border-t border-[#E2E8F0] pt-3">
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] font-bold text-[#475569]">
                    <div><dt className="text-[9px] font-black text-[#94A3B8]">UID</dt><dd className="truncate font-mono">{user.uid}</dd></div>
                    <div><dt className="text-[9px] font-black text-[#94A3B8]">지갑 주소</dt><dd className="truncate font-mono">{user.wallet || '—'}</dd></div>
                    <div><dt className="text-[9px] font-black text-[#94A3B8]">아이디</dt><dd>{user.username}</dd></div>
                    <div><dt className="text-[9px] font-black text-[#94A3B8]">지역/업종</dt><dd>{[user.region, user.serviceType].filter(Boolean).join(' · ') || '—'}</dd></div>
                    <div><dt className="text-[9px] font-black text-[#94A3B8]">누적 입금</dt><dd>{user.creditTotal ?? 0} Pi</dd></div>
                    <div><dt className="text-[9px] font-black text-[#94A3B8]">누적 지출</dt><dd>{user.spendTotal ?? 0} Pi</dd></div>
                  </dl>
                  {user.locked ? (
                    <p className="rounded-lg bg-[#FEF2F2] px-2.5 py-1.5 text-[10px] font-bold text-[#B91C1C]">
                      정지됨 · {user.lockedBy || '관리자'} · {fmtDate(user.lockedAt)}{user.lockReason ? ` · 사유: ${user.lockReason}` : ''}
                    </p>
                  ) : null}

                  {/* Lock / 해제 */}
                  <div className="rounded-xl bg-[#F8FAFC] p-2.5">
                    <p className="text-[10px] font-black text-[#475569]">계정 이용 정지</p>
                    {!user.locked ? (
                      <input
                        value={lockReason}
                        onChange={(event) => setLockReason(event.target.value)}
                        placeholder="정지 사유 (선택)"
                        maxLength={60}
                        className="mt-1.5 w-full rounded-lg border border-[#CBD5E1] px-2.5 py-1.5 text-xs font-bold outline-none focus:border-[#DC2626]"
                      />
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => toggleLock(user)}
                      className={`mt-1.5 w-full rounded-xl py-2 text-xs font-black text-white disabled:opacity-50 ${user.locked ? 'bg-[#047857]' : 'bg-[#DC2626]'}`}
                    >
                      {user.locked ? '이용 정지 해제' : 'Lock (이용 정지)'}
                    </button>
                  </div>

                  {/* 수동 입·출금 보정 */}
                  <div className="rounded-xl bg-[#F8FAFC] p-2.5">
                    <p className="text-[10px] font-black text-[#475569]">수동 입·출금 보정</p>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      {(['credit', 'debit'] as const).map((action) => (
                        <button
                          key={action}
                          type="button"
                          onClick={() => setAdjust((prev) => ({ ...prev, action }))}
                          className={`rounded-lg py-1.5 text-[11px] font-black ${adjust.action === action ? 'bg-[#4C1FB8] text-white' : 'bg-white text-[#64748B]'}`}
                        >
                          {action === 'credit' ? '입금 (Credit)' : '출금 (Debit)'}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={0.0000001}
                      value={adjust.amount}
                      onChange={(event) => setAdjust((prev) => ({ ...prev, amount: event.target.value }))}
                      placeholder="금액 (Pi)"
                      className="mt-1.5 w-full rounded-lg border border-[#CBD5E1] px-2.5 py-1.5 text-xs font-bold outline-none focus:border-[#4C1FB8]"
                    />
                    <input
                      value={adjust.reason}
                      onChange={(event) => setAdjust((prev) => ({ ...prev, reason: event.target.value }))}
                      placeholder="사유 (필수 — 감사 로그에 기록됨)"
                      maxLength={60}
                      className="mt-1.5 w-full rounded-lg border border-[#CBD5E1] px-2.5 py-1.5 text-xs font-bold outline-none focus:border-[#4C1FB8]"
                    />
                    <button
                      type="button"
                      disabled={busy || !(Number(adjust.amount) > 0) || !adjust.reason.trim()}
                      onClick={() => submitAdjust(user)}
                      className="mt-1.5 w-full rounded-xl bg-[#0F172A] py-2 text-xs font-black text-white disabled:opacity-50"
                    >
                      {adjust.action === 'credit' ? '입금 반영' : '출금 반영'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
        <PaginationBar
          total={pg.total}
          rangeStart={pg.rangeStart}
          rangeEnd={pg.rangeEnd}
          page={pg.page}
          totalPages={pg.totalPages}
          pageButtons={pg.pageButtons}
          onPage={pg.setPage}
        />
      </section>
      {notice ? <p className="text-center text-xs font-black text-[#047857]">{notice}</p> : null}
    </div>
  )
}
