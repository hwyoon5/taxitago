'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'

type SanctionRow = {
  uid: string
  username: string
  wallet: string
  role?: string
  name?: string
  phone?: string
  plate?: string
  region?: string
  detail?: string
  linkedAt: string
  updatedAt: string
  locked?: boolean
  lockedAt?: string
  lockedBy?: string
  lockReason?: string
  lockedUntil?: string
  withdrawnAt?: string
}

const DURATIONS = [
  { key: '1', label: '1일', days: 1 },
  { key: '3', label: '3일', days: 3 },
  { key: '7', label: '7일', days: 7 },
  { key: '30', label: '30일', days: 30 },
  { key: '90', label: '90일', days: 90 },
  { key: 'forever', label: '영구 정지', days: 0 },
] as const

const fmtDate = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

const roleMeta = (role?: string) =>
  role === '기사'
    ? { label: '기사', cls: 'bg-[#E6F7F4] text-[#0D9488]' }
    : role === '파트너'
      ? { label: '파트너', cls: 'bg-[#FEF3E2] text-[#D97706]' }
      : { label: '승객', cls: 'bg-[#E8F1FA] text-[#4A82B8]' }

const matchQuery = (user: SanctionRow, query: string) => {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [user.name, user.username, user.phone, user.uid, user.wallet, user.plate]
    .filter((v): v is string => Boolean(v))
    .some((v) => v.toLowerCase().includes(q))
}

/** 이용 정지 남은 기간 — 영구/기간 만료 구분 표기. */
const untilLabel = (row: SanctionRow) => {
  if (!row.lockedUntil) return '영구 정지'
  const ms = Date.parse(row.lockedUntil) - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return '기간 만료'
  const hours = Math.ceil(ms / 3_600_000)
  if (hours >= 48) return `${fmtDate(row.lockedUntil)}까지 · ${Math.ceil(hours / 24)}일 남음`
  return `${fmtDate(row.lockedUntil)}까지 · ${hours}시간 남음`
}

/** 관리자 블랙리스트·이용 제한 관리 — 검색, 기간/영구 정지, 해제. */
export default function AdminBlacklist() {
  const [users, setUsers] = useState<SanctionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [target, setTarget] = useState<SanctionRow | null>(null)
  const [duration, setDuration] = useState<string>('7')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualQuery, setManualQuery] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/users', { headers: adminHeaders(), cache: 'no-store' }).catch(() => null)
    const data = (await res?.json().catch(() => null)) as { users?: SanctionRow[] } | null
    if (data?.users) setUsers(data.users)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const say = (message: string, isError = false) => {
    setError(isError ? message : '')
    setNotice(isError ? '' : message)
    if (!isError) window.setTimeout(() => setNotice(''), 3000)
  }

  const patch = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => null)) as { user?: SanctionRow; message?: string } | null
    if (res.status === 409) {
      await load()
      throw new Error('다른 사용자에 의해 내용이 변경되었습니다. 최신 정보를 불러온 후 다시 시도해 주세요.')
    }
    if (!res.ok || !data?.user) throw new Error('처리에 실패했습니다.')
    setUsers((prev) => prev.map((row) => (row.uid === data.user!.uid ? { ...row, ...data.user, locked: Boolean(data.user!.lockedAt) } : row)))
    return data.user
  }

  const sanction = async () => {
    if (!target || busy) return
    if (!reason.trim()) {
      say('정지 사유를 입력해 주세요.', true)
      return
    }
    setBusy(true)
    try {
      const days = DURATIONS.find((d) => d.key === duration)?.days ?? 0
      const until = days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : 'permanent'
      await patch({ action: 'lock', uid: target.uid, reason: reason.trim(), until, baseUpdatedAt: target.updatedAt })
      say(`${target.name || target.username} 계정을 ${days > 0 ? `${days}일간 ` : '영구 '}이용 정지했습니다.`)
      setTarget(null)
      setReason('')
      setDuration('7')
    } catch (err) {
      say(err instanceof Error ? err.message : '처리에 실패했습니다.', true)
    } finally {
      setBusy(false)
    }
  }

  const release = async (row: SanctionRow) => {
    if (busy) return
    setBusy(true)
    try {
      await patch({ action: 'unlock', uid: row.uid, baseUpdatedAt: row.updatedAt })
      say(`${row.name || row.username} 계정의 이용 정지를 해제했습니다.`)
    } catch (err) {
      say(err instanceof Error ? err.message : '처리에 실패했습니다.', true)
    } finally {
      setBusy(false)
    }
  }

  const lockedRows = users.filter((row) => row.locked && !row.withdrawnAt).sort((a, b) => (b.lockedAt || '').localeCompare(a.lockedAt || ''))
  const results = users.filter((row) => matchQuery(row, query) && !row.locked)
  const shown = query.trim() ? results.slice(0, 30) : []
  const permanent = lockedRows.filter((row) => !row.lockedUntil).length

  // 직접 등록 모달 — UID/아이디 정확 일치를 우선하고, 부분 일치 후보도 함께 보여준다.
  const manualQ = manualQuery.trim().toLowerCase()
  const manualExact = manualQ ? users.filter((row) => row.uid.toLowerCase() === manualQ || row.username.toLowerCase() === manualQ) : []
  const manualCandidates = manualQ
    ? [...manualExact, ...users.filter((row) => !manualExact.includes(row) && matchQuery(row, manualQuery))].slice(0, 8)
    : []

  const openSanction = (row: SanctionRow) => {
    setTarget(row)
    setReason('')
    setDuration('7')
    setError('')
    setManualOpen(false)
    setManualQuery('')
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-[#0F172A]">블랙리스트 · 이용 제한 관리</h2>
          <p className="mt-0.5 text-[11px] font-bold text-[#94A3B8]">
            악성·노쇼·약관 위반 이용자를 검색해 기간/영구 정지를 부여합니다. 정지 즉시 로그인·호출·결제·출금·기사 영업이 차단됩니다.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setManualOpen(true)
              setManualQuery('')
            }}
            className="rounded-full border-2 border-[#DC2626] bg-[#FEF2F2] px-3 py-2 text-xs font-black text-[#DC2626]"
          >
            + 직접 등록
          </button>
          <button type="button" onClick={() => void load()} className="rounded-full bg-[#4A82B8] px-3 py-2 text-xs font-black text-white shadow-[0_6px_14px_rgba(74,130,184,0.28)]">
            새로고침
          </button>
        </div>
      </div>

      {error ? <p className="rounded-2xl border-2 border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-xs font-bold text-[#B91C1C]">{error}</p> : null}
      {notice ? <p className="rounded-2xl border-2 border-[#86EFAC] bg-[#F0FDF4] px-4 py-3 text-xs font-bold text-[#15803D]">{notice}</p> : null}

      <section className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border-2 border-[#DC2626] bg-[#FEF2F2] px-3 py-3 text-center">
          <p className="text-xl font-black text-[#DC2626]">{lockedRows.length}</p>
          <p className="text-[10px] font-black text-[#B91C1C]">이용 정지 중</p>
        </div>
        <div className="rounded-2xl border-2 border-[#F59E0B] bg-[#FFFBEB] px-3 py-3 text-center">
          <p className="text-xl font-black text-[#92400E]">{lockedRows.length - permanent}</p>
          <p className="text-[10px] font-black text-[#92400E]">기간 정지</p>
        </div>
        <div className="rounded-2xl border-2 border-[#0F172A] bg-[#0F172A] px-3 py-3 text-center">
          <p className="text-xl font-black text-white">{permanent}</p>
          <p className="text-[10px] font-black text-[#94A3B8]">영구 정지</p>
        </div>
      </section>

      <section className="rounded-2xl border-2 border-[#FCA5A5] bg-white p-4">
        <h3 className="text-xs font-black text-[#B91C1C]">이용 정지 중인 이용자 · {lockedRows.length}명</h3>
        <div className="mt-3 space-y-2">
          {loading ? (
            <p className="rounded-xl bg-[#F8FAFC] px-3 py-4 text-center text-[11px] font-bold text-[#94A3B8]">불러오는 중…</p>
          ) : !lockedRows.length ? (
            <p className="rounded-xl bg-[#F8FAFC] px-3 py-4 text-center text-[11px] font-bold text-[#94A3B8]">현재 이용 정지된 이용자가 없습니다.</p>
          ) : (
            lockedRows.map((row) => {
              const meta = roleMeta(row.role)
              return (
                <div key={row.uid} className="rounded-xl border-2 border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${meta.cls}`}>{meta.label}</span>
                      <p className="truncate text-xs font-black text-[#0F172A]">{row.name || row.username}</p>
                      <span className="shrink-0 rounded-full bg-[#DC2626] px-1.5 py-0.5 text-[9px] font-black text-white">
                        {row.lockedUntil ? '기간 정지' : '영구 정지'}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void release(row)}
                      className="shrink-0 rounded-xl bg-[#047857] px-3 py-1.5 text-[10px] font-black text-white disabled:opacity-50"
                    >
                      정지 해제
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] font-bold text-[#B91C1C]">
                    {untilLabel(row)} · {row.lockedBy || '관리자'} · {fmtDate(row.lockedAt)} 처리
                  </p>
                  {row.lockReason ? <p className="mt-0.5 text-[10px] font-bold text-[#64748B]">사유: {row.lockReason}</p> : null}
                  <p className="mt-0.5 truncate text-[10px] font-bold text-[#94A3B8]">
                    {row.username}
                    {row.phone ? ` · ${row.phone}` : ''} · UID {row.uid.slice(0, 14)}
                  </p>
                </div>
              )
            })
          )}
        </div>
      </section>

      <section className="rounded-2xl border-2 border-[#E2E8F0] bg-white p-4">
        <h3 className="text-xs font-black text-[#334155]">제재 대상 검색</h3>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="이름 · 연락처 · 아이디 · UID · 지갑 주소 · 차량번호로 검색"
          className="mt-2 w-full rounded-xl border-2 border-[#E2E8F0] px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4A82B8]"
        />
        <div className="mt-3 space-y-2">
          {!query.trim() ? (
            <p className="rounded-xl bg-[#F8FAFC] px-3 py-4 text-center text-[11px] font-bold text-[#94A3B8]">
              검색어를 입력하면 정지 대상 후보가 표시됩니다.
            </p>
          ) : !shown.length ? (
            <p className="rounded-xl bg-[#F8FAFC] px-3 py-4 text-center text-[11px] font-bold text-[#94A3B8]">
              일치하는 이용자가 없습니다.
            </p>
          ) : (
            shown.map((row) => {
              const meta = roleMeta(row.role)
              return (
                <div key={row.uid} className="flex items-center justify-between gap-2 rounded-xl border border-[#E2E8F0] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${meta.cls}`}>{meta.label}</span>
                      <p className="truncate text-xs font-black text-[#0F172A]">{row.name || row.username}</p>
                      {row.withdrawnAt ? <span className="rounded-full bg-[#F1F5F9] px-1.5 py-0.5 text-[9px] font-black text-[#64748B]">탈퇴</span> : null}
                    </div>
                    <p className="mt-0.5 truncate text-[10px] font-bold text-[#64748B]">
                      {row.username}
                      {row.phone ? ` · ${row.phone}` : ''}
                      {row.plate ? ` · ${row.plate}` : ''} · UID {row.uid.slice(0, 14)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openSanction(row)}
                    className="shrink-0 rounded-xl bg-[#DC2626] px-3 py-2 text-[10px] font-black text-white"
                  >
                    이용 정지
                  </button>
                </div>
              )
            })
          )}
          {results.length > shown.length ? (
            <p className="text-center text-[10px] font-bold text-[#94A3B8]">결과 {results.length}건 중 30건만 표시 — 검색어를 더 입력해 좁혀 주세요.</p>
          ) : null}
        </div>
      </section>

      {manualOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setManualOpen(false)}>
          <section className="w-full max-w-md rounded-[24px] bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <p className="text-sm font-black text-[#0F172A]">수동 제재 추가</p>
            <p className="mt-1 text-[11px] font-bold leading-5 text-[#64748B]">
              UID 또는 아이디(사용자명)를 입력해 대상을 조회한 뒤 정지 기간과 사유를 지정합니다.
            </p>
            <input
              type="text"
              value={manualQuery}
              onChange={(event) => setManualQuery(event.target.value)}
              placeholder="UID 또는 아이디 입력 (이름·연락처도 검색 가능)"
              spellCheck={false}
              autoComplete="off"
              autoFocus
              className="mt-3 w-full rounded-xl border-2 border-[#E2E8F0] px-3 py-2.5 font-mono text-sm font-bold outline-none focus:border-[#DC2626]"
            />
            <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
              {!manualQ ? (
                <p className="rounded-xl bg-[#F8FAFC] px-3 py-4 text-center text-[11px] font-bold text-[#94A3B8]">
                  대상 식별자를 입력하면 아래에 후보가 표시됩니다.
                </p>
              ) : !manualCandidates.length ? (
                <p className="rounded-xl bg-[#F8FAFC] px-3 py-4 text-center text-[11px] font-bold text-[#94A3B8]">
                  일치하는 이용자가 없습니다. 가입자 레지스트리에 등록된 계정만 정지할 수 있습니다.
                </p>
              ) : (
                manualCandidates.map((row) => {
                  const meta = roleMeta(row.role)
                  const exact = manualExact.includes(row)
                  return (
                    <button
                      key={row.uid}
                      type="button"
                      onClick={() => openSanction(row)}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl border-2 px-3 py-2.5 text-left ${
                        exact ? 'border-[#DC2626] bg-[#FEF2F2]' : 'border-[#E2E8F0] bg-white'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${meta.cls}`}>{meta.label}</span>
                          <span className="truncate text-xs font-black text-[#0F172A]">{row.name || row.username}</span>
                          {row.locked ? <span className="rounded-full bg-[#DC2626] px-1.5 py-0.5 text-[9px] font-black text-white">정지 중</span> : null}
                          {exact ? <span className="rounded-full bg-[#0F172A] px-1.5 py-0.5 text-[9px] font-black text-white">정확 일치</span> : null}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] font-bold text-[#64748B]">
                          {row.username} · UID {row.uid}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] font-black text-[#DC2626]">선택 ›</span>
                    </button>
                  )
                })
              )}
            </div>
            <button
              type="button"
              onClick={() => setManualOpen(false)}
              className="mt-3 w-full rounded-xl bg-[#F1F5F9] py-2.5 text-xs font-black text-[#475569]"
            >
              닫기
            </button>
          </section>
        </div>
      ) : null}

      {target ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setTarget(null)}>
          <section className="w-full max-w-md rounded-[24px] bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <p className="text-sm font-black text-[#0F172A]">이용 정지 · {target.name || target.username}</p>
            <p className="mt-1 text-[11px] font-bold text-[#64748B]">
              {roleMeta(target.role).label} · {target.username}
              {target.phone ? ` · ${target.phone}` : ''}
            </p>
            <p className="mt-3 text-[10px] font-black text-[#475569]">정지 기간</p>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {DURATIONS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setDuration(d.key)}
                  className={`rounded-xl border-2 px-2 py-2 text-xs font-black ${
                    duration === d.key ? 'border-[#DC2626] bg-[#FEF2F2] text-[#DC2626]' : 'border-[#E2E8F0] bg-white text-[#475569]'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[10px] font-black text-[#475569]">정지 사유 (필수 · 감사 로그 기록)</p>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={120}
              placeholder="예: 반복 노쇼, 기사 폭언, 부정 결제 시도, 약관 위반"
              className="mt-1.5 w-full rounded-xl border-2 border-[#E2E8F0] px-3 py-2.5 text-xs font-bold outline-none focus:border-[#DC2626]"
            />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTarget(null)}
                className="rounded-xl bg-[#F1F5F9] py-2.5 text-xs font-black text-[#475569]"
              >
                취소
              </button>
              <button
                type="button"
                disabled={busy || !reason.trim()}
                onClick={() => void sanction()}
                className="rounded-xl bg-[#DC2626] py-2.5 text-xs font-black text-white disabled:opacity-50"
              >
                {busy ? '처리 중…' : '이용 정지 확정'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
