'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import { useAdminAuth } from '@/components/admin-guard'
import { ADMIN_PRIVILEGED_POSITIONS } from '@/lib/staff-positions'
import type { Coupon } from '@/lib/coupon-store'

const fmtDate = (iso?: string) => {
  if (!iso) return '무기한'
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '무기한'
}

const AUDIENCE_LABEL: Record<Coupon['audience'], string> = {
  all: '전체 승객',
  new: '신규 가입자',
  uids: '지정 회원',
}

type Stats = { total: number; active: number; redeemed: number; discounted: number }

/** 승객 할인 쿠폰 발행·현황 관리 — 최고책임자/팀장만 생성·삭제·토글 가능. */
export default function AdminCoupons() {
  const { actor } = useAdminAuth()
  const canEdit = actor?.role === 'master' || ADMIN_PRIVILEGED_POSITIONS.has((actor?.position || '').trim())
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [draft, setDraft] = useState({
    code: '',
    title: '',
    kind: 'amount' as 'amount' | 'percent',
    value: '',
    maxDiscount: '',
    minSpend: '',
    expiresAt: '',
    audience: 'all' as 'all' | 'new' | 'uids',
    newWithinDays: '30',
    targetUids: '',
    maxUses: '',
    perUserLimit: '1',
  })

  const tell = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const res = await fetch('/api/admin/coupons', { headers: adminHeaders(), cache: 'no-store' }).catch(() => null)
    const data = (await res?.json().catch(() => null)) as { coupons?: Coupon[]; stats?: Stats } | null
    if (data?.coupons) setCoupons(data.coupons)
    if (data?.stats) setStats(data.stats)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(true), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/admin/coupons', {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    if (!res.ok || !data?.ok) throw new Error(data?.error || '처리에 실패했습니다.')
    return data
  }

  const create = async () => {
    if (!canEdit || busy) return
    setBusy(true)
    setError('')
    try {
      await post({
        action: 'create',
        code: draft.code,
        title: draft.title,
        kind: draft.kind,
        value: Number(draft.value),
        maxDiscount: Number(draft.maxDiscount) || 0,
        minSpend: Number(draft.minSpend) || 0,
        expiresAt: draft.expiresAt || '',
        audience: draft.audience,
        newWithinDays: Number(draft.newWithinDays) || 0,
        targetUids: draft.targetUids.split(/[\s,]+/).filter(Boolean),
        maxUses: Number(draft.maxUses) || 0,
        perUserLimit: Number(draft.perUserLimit) || 1,
      })
      setDraft({ ...draft, code: '', title: '', value: '', maxDiscount: '', minSpend: '', expiresAt: '', targetUids: '', maxUses: '' })
      tell('쿠폰이 발행되었습니다.')
      void load(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '쿠폰 발행에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (coupon: Coupon) => {
    if (!canEdit || busy) return
    setBusy(true)
    try {
      await post({ action: 'toggle', id: coupon.id, active: !coupon.active })
      void load(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '상태 변경에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (coupon: Coupon) => {
    if (!canEdit || busy) return
    if (!window.confirm(`쿠폰 ${coupon.code}를 삭제할까요? 사용 기록도 함께 사라집니다.`)) return
    setBusy(true)
    try {
      await post({ action: 'delete', id: coupon.id })
      tell('쿠폰이 삭제되었습니다.')
      void load(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const nowIso = new Date().toISOString()
  const filtered = coupons.filter((c) => (filter === 'all' ? true : filter === 'active' ? c.active : !c.active))

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-[#0F172A]">쿠폰 발행 · 현황</h2>
          <p className="mt-0.5 text-[11px] font-bold text-[#94A3B8]">
            승객 Pi 결제 시 코드를 입력하면 할인이 적용됩니다 · 할인분은 플랫폼 부담
            {stats ? ` · 총 ${stats.total}개 / 사용 ${stats.redeemed}건 / 할인 ${stats.discounted.toFixed(7)} Pi` : ''}
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-full bg-[#4A82B8] px-3 py-2 text-xs font-black text-white shadow-[0_6px_14px_rgba(74,130,184,0.28)]">
          새로고침
        </button>
      </div>

      {!canEdit ? (
        <p className="rounded-xl bg-[#FFFBEB] px-3 py-2 text-xs font-black text-[#B45309]">
          읽기 전용 — 쿠폰 발행·삭제는 최고책임자 및 팀장만 가능합니다.
        </p>
      ) : null}
      {error ? <p className="rounded-2xl border-2 border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-xs font-bold text-[#B91C1C]">{error}</p> : null}
      {notice ? <p className="text-center text-xs font-black text-[#047857]">{notice}</p> : null}

      {canEdit ? (
        <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
          <p className="text-sm font-black">새 쿠폰 발행</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="block">
              <span className="text-[10px] font-bold text-[#94A3B8]">쿠폰 코드</span>
              <input
                value={draft.code}
                onChange={(e) => setDraft((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                placeholder="WELCOME20"
                spellCheck={false}
                autoComplete="off"
                maxLength={24}
                className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 font-mono text-xs font-black outline-none focus:border-[#4A82B8]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold text-[#94A3B8]">쿠폰 이름</span>
              <input
                value={draft.title}
                onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
                placeholder="신규 가입 환영 쿠폰"
                maxLength={60}
                className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-bold outline-none focus:border-[#4A82B8]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold text-[#94A3B8]">할인 유형</span>
              <select
                value={draft.kind}
                onChange={(e) => setDraft((p) => ({ ...p, kind: e.target.value as 'amount' | 'percent' }))}
                className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4A82B8]"
              >
                <option value="amount">정액 할인 (Pi)</option>
                <option value="percent">정률 할인 (%)</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-bold text-[#94A3B8]">{draft.kind === 'percent' ? '할인율 (%)' : '할인 금액 (Pi)'}</span>
              <input
                type="number"
                min={0}
                step={draft.kind === 'percent' ? 1 : 0.01}
                value={draft.value}
                onChange={(e) => setDraft((p) => ({ ...p, value: e.target.value }))}
                className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4A82B8]"
              />
            </label>
            {draft.kind === 'percent' ? (
              <label className="block">
                <span className="text-[10px] font-bold text-[#94A3B8]">할인 상한 (Pi, 선택)</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={draft.maxDiscount}
                  onChange={(e) => setDraft((p) => ({ ...p, maxDiscount: e.target.value }))}
                  placeholder="0 = 무제한"
                  className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4A82B8]"
                />
              </label>
            ) : null}
            <label className="block">
              <span className="text-[10px] font-bold text-[#94A3B8]">최소 결제액 (Pi)</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={draft.minSpend}
                onChange={(e) => setDraft((p) => ({ ...p, minSpend: e.target.value }))}
                placeholder="0 = 제한 없음"
                className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4A82B8]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold text-[#94A3B8]">사용 기한</span>
              <input
                type="datetime-local"
                value={draft.expiresAt}
                onChange={(e) => setDraft((p) => ({ ...p, expiresAt: e.target.value }))}
                className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-bold outline-none focus:border-[#4A82B8]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold text-[#94A3B8]">발급 대상</span>
              <select
                value={draft.audience}
                onChange={(e) => setDraft((p) => ({ ...p, audience: e.target.value as 'all' | 'new' | 'uids' }))}
                className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4A82B8]"
              >
                <option value="all">전체 승객</option>
                <option value="new">신규 가입자 (가입 N일 이내)</option>
                <option value="uids">지정 회원 (UID)</option>
              </select>
            </label>
            {draft.audience === 'new' ? (
              <label className="block">
                <span className="text-[10px] font-bold text-[#94A3B8]">가입 후 허용 일수</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={draft.newWithinDays}
                  onChange={(e) => setDraft((p) => ({ ...p, newWithinDays: e.target.value }))}
                  className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4A82B8]"
                />
              </label>
            ) : null}
            {draft.audience === 'uids' ? (
              <label className="col-span-2 block sm:col-span-4">
                <span className="text-[10px] font-bold text-[#94A3B8]">대상 UID 목록 (쉼표·공백 구분)</span>
                <input
                  value={draft.targetUids}
                  onChange={(e) => setDraft((p) => ({ ...p, targetUids: e.target.value }))}
                  placeholder="uid-1, uid-2, …"
                  spellCheck={false}
                  autoComplete="off"
                  className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 font-mono text-xs font-bold outline-none focus:border-[#4A82B8]"
                />
              </label>
            ) : null}
            <label className="block">
              <span className="text-[10px] font-bold text-[#94A3B8]">총 사용 한도</span>
              <input
                type="number"
                min={0}
                step={1}
                value={draft.maxUses}
                onChange={(e) => setDraft((p) => ({ ...p, maxUses: e.target.value }))}
                placeholder="0 = 무제한"
                className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4A82B8]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold text-[#94A3B8]">1인당 사용 한도</span>
              <input
                type="number"
                min={1}
                step={1}
                value={draft.perUserLimit}
                onChange={(e) => setDraft((p) => ({ ...p, perUserLimit: e.target.value }))}
                className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4A82B8]"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={busy || !draft.code.trim() || !draft.title.trim() || !(Number(draft.value) > 0)}
            onClick={() => void create()}
            className="mt-3 w-full rounded-xl bg-[#4A82B8] py-2.5 text-xs font-black text-white shadow-[0_6px_14px_rgba(74,130,184,0.28)] disabled:opacity-50"
          >
            {busy ? '처리 중…' : '쿠폰 발행'}
          </button>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {([
          { id: 'all', label: '전체' },
          { id: 'active', label: '활성' },
          { id: 'inactive', label: '비활성' },
        ] as const).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-black ${filter === f.id ? 'bg-[#4A82B8] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
          >
            {f.label} {f.id === 'all' ? coupons.length : coupons.filter((c) => (f.id === 'active' ? c.active : !c.active)).length}
          </button>
        ))}
      </div>

      {loading ? <p className="rounded-2xl bg-[#F1F5F9] px-4 py-6 text-center text-xs font-bold text-[#64748B]">쿠폰 목록을 불러오는 중…</p> : null}
      {!loading && !filtered.length ? (
        <p className="rounded-2xl border-2 border-dashed border-[#CBD5E1] bg-white px-4 py-8 text-center text-xs font-bold text-[#94A3B8]">발행된 쿠폰이 없습니다.</p>
      ) : null}

      <ul className="space-y-2">
        {filtered.map((coupon) => {
          const expired = coupon.expiresAt ? coupon.expiresAt < nowIso : false
          const depleted = coupon.maxUses > 0 && coupon.redemptions.length >= coupon.maxUses
          const open = expanded === coupon.id
          return (
            <li key={coupon.id} className="rounded-2xl border-2 border-[#E2E8F0] bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="rounded-lg bg-[#0F172A] px-2 py-1 font-mono text-[11px] font-black text-white">{coupon.code}</span>
                  <p className="text-sm font-black text-[#0F172A]">{coupon.title}</p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
                    !coupon.active ? 'bg-[#F1F5F9] text-[#64748B]' : expired ? 'bg-[#FEE2E2] text-[#B91C1C]' : depleted ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#DCFCE7] text-[#15803D]'
                  }`}
                >
                  {!coupon.active ? '비활성' : expired ? '기한 만료' : depleted ? '한도 소진' : '활성'}
                </span>
              </div>
              <p className="mt-2 text-lg font-black text-[#0F172A]">
                {coupon.kind === 'percent' ? `${coupon.value}% 할인` : `${coupon.value.toFixed(7)} Pi 할인`}
                {coupon.kind === 'percent' && coupon.maxDiscount > 0 ? <span className="text-xs font-bold text-[#64748B]"> (최대 {coupon.maxDiscount.toFixed(7)} Pi)</span> : null}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-bold text-[#64748B]">
                <span>대상 {AUDIENCE_LABEL[coupon.audience]}{coupon.audience === 'new' ? ` (${coupon.newWithinDays}일)` : ''}</span>
                <span>기한 {fmtDate(coupon.expiresAt)}</span>
                {coupon.minSpend > 0 ? <span>최소 {coupon.minSpend.toFixed(7)} Pi</span> : null}
                <span>
                  사용 {coupon.redemptions.length}건{coupon.maxUses > 0 ? `/${coupon.maxUses}` : ''} · 1인 {coupon.perUserLimit}회
                </span>
                <span>발행 {fmtDate(coupon.createdAt)}{coupon.createdByName ? ` · ${coupon.createdByName}` : ''}</span>
              </div>
              <div className="mt-3 flex gap-2 border-t border-[#F1F5F9] pt-3">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : coupon.id)}
                  className="flex-1 rounded-xl bg-[#F1F5F9] py-2 text-[11px] font-black text-[#475569]"
                >
                  {open ? '사용 내역 닫기' : `사용 내역 (${coupon.redemptions.length})`}
                </button>
                {canEdit ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void toggle(coupon)}
                      className={`flex-1 rounded-xl py-2 text-[11px] font-black disabled:opacity-50 ${coupon.active ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#DCFCE7] text-[#15803D]'}`}
                    >
                      {coupon.active ? '비활성화' : '활성화'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(coupon)}
                      className="rounded-xl border-2 border-[#FCA5A5] bg-[#FEF2F2] px-4 py-2 text-[11px] font-black text-[#B91C1C] disabled:opacity-50"
                    >
                      삭제
                    </button>
                  </>
                ) : null}
              </div>
              {open ? (
                <ul className="mt-2 space-y-1">
                  {coupon.redemptions.length ? (
                    [...coupon.redemptions].reverse().slice(0, 30).map((r, i) => (
                      <li key={`${r.at}-${i}`} className="rounded-xl bg-[#F8FAFC] px-3 py-2 text-[11px] font-bold text-[#475569]">
                        <span className="font-mono">{r.uid.slice(0, 18)}{r.uid.length > 18 ? '…' : ''}</span>
                        <span className="mx-1.5 text-[#CBD5E1]">|</span>
                        결제 {r.gross.toFixed(7)} → <span className="font-black text-[#047857]">-{r.discount.toFixed(7)} Pi</span>
                        <span className="mx-1.5 text-[#CBD5E1]">|</span>
                        {fmtDate(r.at)}
                        {r.refId ? <span className="ml-1.5 font-mono text-[10px] text-[#94A3B8]">{r.refId.slice(0, 20)}</span> : null}
                      </li>
                    ))
                  ) : (
                    <li className="rounded-xl bg-[#F8FAFC] px-3 py-2.5 text-center text-[11px] font-bold text-[#94A3B8]">아직 사용 내역이 없습니다.</li>
                  )}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
