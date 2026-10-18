'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import type { B2bInvoice, B2bMember, B2bOrg, B2bPlan, B2bUsage } from '@/lib/b2b-store'

type B2bState = {
  period: string
  orgs: B2bOrg[]
  members: B2bMember[]
  plans: B2bPlan[]
  invoices: B2bInvoice[]
  usage: B2bUsage[]
}

const SERVICE_LABEL: Record<string, string> = { taxi: '택시', daeri: '대리운전', delivery: '택배' }
const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  issued: { label: '청구됨', cls: 'bg-[#FEF3C7] text-[#B45309]' },
  paid: { label: '결제 완료', cls: 'bg-[#D1FAE5] text-[#047857]' },
  void: { label: '무효', cls: 'bg-[#F1F5F9] text-[#64748B]' },
}

const fmtDate = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''
}
const pi = (n: number) => `${(Number.isFinite(n) ? n : 0).toFixed(4)} Pi`

/** B2B 법인 계정·정기 청구 관리 — 법인/소속원/요금제/이용 내역/인보이스. */
export default function AdminB2b() {
  const [state, setState] = useState<B2bState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState<'orgs' | 'plans' | 'usage' | 'invoices'>('orgs')
  const [busy, setBusy] = useState('')
  const [selectedOrg, setSelectedOrg] = useState('')

  // 법인 등록/수정 폼
  const [orgForm, setOrgForm] = useState({ id: '', name: '', bizNo: '', contactName: '', contactPhone: '', wallet: '', managerUid: '', planId: '', note: '' })
  // 소속원 추가 폼
  const [memberForm, setMemberForm] = useState({ uid: '', memberName: '', role: 'member' })
  // 요금제 폼
  const [planForm, setPlanForm] = useState({ id: '', name: '', discountPct: '0', monthlyFeePi: '0', services: [] as string[], note: '', active: true })
  // 인보이스 발행 폼
  const [issueForm, setIssueForm] = useState({ orgId: '', period: '' })
  const [usageOrg, setUsageOrg] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/b2b', { headers: adminHeaders(), cache: 'no-store' }).catch(() => null)
    const data = (await res?.json().catch(() => null)) as B2bState | null
    if (data?.orgs) {
      setState(data)
      setIssueForm((prev) => ({ ...prev, period: prev.period || data.period }))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 20_000)
    return () => window.clearInterval(timer)
  }, [load])

  const say = (message: string, isError = false) => {
    setError(isError ? message : '')
    setNotice(isError ? '' : message)
    if (!isError) window.setTimeout(() => setNotice(''), 3000)
  }

  const post = async (body: Record<string, unknown>, key: string) => {
    if (busy) return
    setBusy(key)
    try {
      const res = await fetch('/api/admin/b2b', {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; invoice?: B2bInvoice } | null
      if (!res.ok || !data?.ok) {
        const msg =
          data?.error === 'already_issued'
            ? `해당 주기에 이미 발행된 인보이스가 있습니다 (${data.invoice?.id ?? ''})`
            : data?.error === 'empty'
              ? '청구할 이용 내역이 없고 월 구독료도 없습니다'
              : `실패: ${data?.error || res.status}`
        say(msg, true)
        return
      }
      say('처리되었습니다')
      await load()
    } finally {
      setBusy('')
    }
  }

  const orgs = state?.orgs ?? []
  const members = state?.members ?? []
  const plans = state?.plans ?? []
  const invoices = state?.invoices ?? []
  const usage = state?.usage ?? []
  const membersOf = (orgId: string) => members.filter((m) => m.orgId === orgId)
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? id
  const detailOrg = orgs.find((o) => o.id === selectedOrg) ?? null

  const stats = useMemo(() => {
    const unbilled = usage.filter((u) => !u.invoiceId)
    const openInvoices = invoices.filter((i) => i.status === 'issued')
    return {
      activeOrgs: orgs.filter((o) => o.status === 'active').length,
      unbilledCount: unbilled.length,
      unbilledPi: unbilled.reduce((s, u) => s + u.netPi, 0),
      openPi: openInvoices.reduce((s, i) => s + i.totalPi, 0),
    }
  }, [orgs, usage, invoices])

  const editOrg = (org: B2bOrg) =>
    setOrgForm({
      id: org.id,
      name: org.name,
      bizNo: org.bizNo ?? '',
      contactName: org.contactName,
      contactPhone: org.contactPhone,
      wallet: org.wallet ?? '',
      managerUid: org.managerUid ?? '',
      planId: org.planId ?? '',
      note: org.note ?? '',
    })

  const inputCls = 'w-full rounded-xl border border-[#CBD5E1] bg-white px-3 py-2 text-sm font-bold outline-none focus:border-[#4A82B8]'
  const btnCls = 'rounded-xl bg-[#4A82B8] px-4 py-2 text-sm font-black text-white hover:bg-[#3F74A8] disabled:opacity-50'

  if (loading && !state) return <p className="py-10 text-center text-sm font-bold text-[#64748B]">B2B 데이터를 불러오는 중…</p>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['활성 법인', `${stats.activeOrgs}개`],
          ['미청구 이용', `${stats.unbilledCount}건`],
          ['미청구 금액', pi(stats.unbilledPi)],
          ['발행 미수', pi(stats.openPi)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-[#E2E8F0] bg-white p-3">
            <p className="text-[10px] font-black text-[#94A3B8]">{label}</p>
            <p className="mt-1 text-lg font-black text-[#0F172A]">{value}</p>
          </div>
        ))}
      </div>

      {error ? <p className="rounded-xl bg-[#FEF2F2] px-3 py-2 text-xs font-bold text-[#B91C1C]">{error}</p> : null}
      {notice ? <p className="rounded-xl bg-[#ECFDF5] px-3 py-2 text-xs font-bold text-[#047857]">{notice}</p> : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['orgs', '법인 계정'],
            ['plans', '요금제·구독'],
            ['usage', '이용 내역'],
            ['invoices', '인보이스'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full px-4 py-2 text-xs font-black ${tab === id ? 'bg-[#4A82B8] text-white' : 'bg-[#E8F1FA] text-[#4A82B8]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'orgs' ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4">
            <p className="text-xs font-black text-[#475569]">{orgForm.id ? `법인 수정 · ${orgForm.id}` : '신규 법인 등록'}</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input className={inputCls} placeholder="법인명 *" value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} />
              <input className={inputCls} placeholder="사업자등록번호" value={orgForm.bizNo} onChange={(e) => setOrgForm({ ...orgForm, bizNo: e.target.value })} />
              <input className={inputCls} placeholder="담당자 이름" value={orgForm.contactName} onChange={(e) => setOrgForm({ ...orgForm, contactName: e.target.value })} />
              <input className={inputCls} placeholder="담당자 연락처" value={orgForm.contactPhone} onChange={(e) => setOrgForm({ ...orgForm, contactPhone: e.target.value })} />
              <input className={inputCls} placeholder="법인 Pi 지갑 주소" value={orgForm.wallet} onChange={(e) => setOrgForm({ ...orgForm, wallet: e.target.value })} />
              <input className={inputCls} placeholder="포털 담당자 uid (manager)" value={orgForm.managerUid} onChange={(e) => setOrgForm({ ...orgForm, managerUid: e.target.value })} />
              <select className={inputCls} value={orgForm.planId} onChange={(e) => setOrgForm({ ...orgForm, planId: e.target.value })}>
                <option value="">요금제 없음 (종량제)</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} · {plan.discountPct}% 할인{plan.monthlyFeePi > 0 ? ` · 월 ${plan.monthlyFeePi} Pi` : ''}
                  </option>
                ))}
              </select>
              <input className={inputCls} placeholder="메모" value={orgForm.note} onChange={(e) => setOrgForm({ ...orgForm, note: e.target.value })} />
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={!orgForm.name.trim() || Boolean(busy)}
                className={btnCls}
                onClick={() =>
                  void post({ action: 'org-upsert', ...orgForm, id: orgForm.id || undefined, planId: orgForm.planId || undefined }, 'org')
                }
              >
                {orgForm.id ? '수정 저장' : '법인 등록'}
              </button>
              {orgForm.id ? (
                <button type="button" className="rounded-xl border border-[#CBD5E1] px-4 py-2 text-sm font-black text-[#64748B]" onClick={() => setOrgForm({ id: '', name: '', bizNo: '', contactName: '', contactPhone: '', wallet: '', managerUid: '', planId: '', note: '' })}>
                  새 법인
                </button>
              ) : null}
            </div>
          </div>

          {orgs.map((org) => (
            <div key={org.id} className="rounded-2xl border border-[#E2E8F0] bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-[#0F172A]">
                    {org.name}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-black ${org.status === 'active' ? 'bg-[#D1FAE5] text-[#047857]' : 'bg-[#FEE2E2] text-[#B91C1C]'}`}>
                      {org.status === 'active' ? '활성' : '정지'}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-[#64748B]">
                    {org.bizNo ? `사업자 ${org.bizNo} · ` : ''}
                    {org.contactName} {org.contactPhone} · 소속원 {membersOf(org.id).length}명
                    {org.planId ? ` · ${plans.find((p) => p.id === org.planId)?.name ?? org.planId}` : ' · 종량제'}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" className="rounded-lg bg-[#E8F1FA] px-3 py-1.5 text-[11px] font-black text-[#4A82B8]" onClick={() => setSelectedOrg(selectedOrg === org.id ? '' : org.id)}>
                    소속원
                  </button>
                  <button type="button" className="rounded-lg bg-[#E8F1FA] px-3 py-1.5 text-[11px] font-black text-[#4A82B8]" onClick={() => editOrg(org)}>
                    수정
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    className={`rounded-lg px-3 py-1.5 text-[11px] font-black ${org.status === 'active' ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#D1FAE5] text-[#047857]'}`}
                    onClick={() =>
                      void post(
                        {
                          action: 'org-upsert',
                          id: org.id,
                          name: org.name,
                          status: org.status === 'active' ? 'suspended' : 'active',
                        },
                        `status-${org.id}`,
                      )
                    }
                  >
                    {org.status === 'active' ? '정지' : '재개'}
                  </button>
                </div>
              </div>

              {selectedOrg === org.id && detailOrg ? (
                <div className="mt-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <p className="text-[11px] font-black text-[#475569]">소속원 · 파트너 그룹 ({membersOf(org.id).length})</p>
                  <ul className="mt-2 space-y-1">
                    {membersOf(org.id).map((member) => (
                      <li key={member.uid} className="flex items-center justify-between rounded-lg bg-white px-3 py-1.5 text-xs font-bold">
                        <span>
                          {member.name || member.uid}
                          <span className="ml-1.5 text-[10px] font-black text-[#94A3B8]">{member.uid}</span>
                          <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-black ${member.role === 'manager' ? 'bg-[#DBEAFE] text-[#1D4ED8]' : 'bg-[#F1F5F9] text-[#64748B]'}`}>
                            {member.role === 'manager' ? '담당자' : '임직원'}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="text-[10px] font-black text-[#B91C1C]"
                          disabled={Boolean(busy)}
                          onClick={() => void post({ action: 'member-remove', uid: member.uid }, `m-${member.uid}`)}
                        >
                          제외
                        </button>
                      </li>
                    ))}
                    {!membersOf(org.id).length ? <li className="text-xs font-bold text-[#94A3B8]">소속원이 없습니다</li> : null}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <input className="min-w-0 flex-1 rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-bold" placeholder="Pi uid" value={memberForm.uid} onChange={(e) => setMemberForm({ ...memberForm, uid: e.target.value })} />
                    <input className="w-24 rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-bold" placeholder="이름" value={memberForm.memberName} onChange={(e) => setMemberForm({ ...memberForm, memberName: e.target.value })} />
                    <select className="rounded-lg border border-[#CBD5E1] bg-white px-2 py-1.5 text-xs font-bold" value={memberForm.role} onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value })}>
                      <option value="member">임직원</option>
                      <option value="manager">담당자</option>
                    </select>
                    <button
                      type="button"
                      className="rounded-lg bg-[#4A82B8] px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-50"
                      disabled={!memberForm.uid.trim() || Boolean(busy)}
                      onClick={() => {
                        void post({ action: 'member-add', orgId: org.id, ...memberForm }, 'm-add').then(() => setMemberForm({ uid: '', memberName: '', role: 'member' }))
                      }}
                    >
                      추가
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          {!orgs.length ? <p className="py-6 text-center text-xs font-bold text-[#94A3B8]">등록된 법인이 없습니다 — 위 폼에서 첫 법인을 등록하세요.</p> : null}
        </div>
      ) : null}

      {tab === 'plans' ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4">
            <p className="text-xs font-black text-[#475569]">{planForm.id ? `요금제 수정 · ${planForm.id}` : 'B2B 요금제·구독 플랜 등록'}</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input className={inputCls} placeholder="요금제명 *" value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} />
              <div className="flex gap-2">
                <input className={inputCls} type="number" min={0} max={50} placeholder="할인율 %" value={planForm.discountPct} onChange={(e) => setPlanForm({ ...planForm, discountPct: e.target.value })} />
                <input className={inputCls} type="number" min={0} placeholder="월 구독료 Pi (0=종량제)" value={planForm.monthlyFeePi} onChange={(e) => setPlanForm({ ...planForm, monthlyFeePi: e.target.value })} />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="text-[11px] font-black text-[#64748B]">적용 서비스(미선택 시 전체):</span>
              {(['taxi', 'daeri', 'delivery'] as const).map((svc) => (
                <label key={svc} className="flex items-center gap-1 text-xs font-bold">
                  <input
                    type="checkbox"
                    checked={planForm.services.includes(svc)}
                    onChange={(e) =>
                      setPlanForm({
                        ...planForm,
                        services: e.target.checked ? [...planForm.services, svc] : planForm.services.filter((item) => item !== svc),
                      })
                    }
                  />
                  {SERVICE_LABEL[svc]}
                </label>
              ))}
              <label className="flex items-center gap-1 text-xs font-bold">
                <input type="checkbox" checked={planForm.active} onChange={(e) => setPlanForm({ ...planForm, active: e.target.checked })} />
                활성
              </label>
            </div>
            <input className={`${inputCls} mt-2`} placeholder="메모" value={planForm.note} onChange={(e) => setPlanForm({ ...planForm, note: e.target.value })} />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={!planForm.name.trim() || Boolean(busy)}
                className={btnCls}
                onClick={() =>
                  void post(
                    {
                      action: 'plan-upsert',
                      id: planForm.id || undefined,
                      name: planForm.name,
                      services: planForm.services,
                      discountPct: Number(planForm.discountPct) || 0,
                      monthlyFeePi: Number(planForm.monthlyFeePi) || 0,
                      note: planForm.note,
                      active: planForm.active,
                    },
                    'plan',
                  )
                }
              >
                {planForm.id ? '수정 저장' : '요금제 등록'}
              </button>
              {planForm.id ? (
                <button type="button" className="rounded-xl border border-[#CBD5E1] px-4 py-2 text-sm font-black text-[#64748B]" onClick={() => setPlanForm({ id: '', name: '', discountPct: '0', monthlyFeePi: '0', services: [], note: '', active: true })}>
                  새 요금제
                </button>
              ) : null}
            </div>
          </div>
          {plans.map((plan) => (
            <div key={plan.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#E2E8F0] bg-white p-4">
              <div>
                <p className="text-sm font-black text-[#0F172A]">
                  {plan.name}
                  {!plan.active ? <span className="ml-2 rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-black text-[#64748B]">비활성</span> : null}
                </p>
                <p className="mt-0.5 text-[11px] font-bold text-[#64748B]">
                  {plan.services.length ? plan.services.map((s) => SERVICE_LABEL[s]).join('·') : '전 서비스'} · 할인 {plan.discountPct}%
                  {plan.monthlyFeePi > 0 ? ` · 월 구독료 ${plan.monthlyFeePi} Pi` : ' · 종량제'}
                  {plan.note ? ` · ${plan.note}` : ''}
                </p>
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className="rounded-lg bg-[#E8F1FA] px-3 py-1.5 text-[11px] font-black text-[#4A82B8]"
                  onClick={() =>
                    setPlanForm({ id: plan.id, name: plan.name, discountPct: String(plan.discountPct), monthlyFeePi: String(plan.monthlyFeePi), services: plan.services, note: plan.note ?? '', active: plan.active })
                  }
                >
                  수정
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-[#FEE2E2] px-3 py-1.5 text-[11px] font-black text-[#B91C1C] disabled:opacity-50"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    if (window.confirm(`요금제 '${plan.name}'을 삭제할까요? 연결된 법인은 종량제로 전환됩니다.`)) {
                      void post({ action: 'plan-delete', id: plan.id }, `pd-${plan.id}`)
                    }
                  }}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
          {!plans.length ? <p className="py-6 text-center text-xs font-bold text-[#94A3B8]">등록된 요금제가 없습니다.</p> : null}
        </div>
      ) : null}

      {tab === 'usage' ? (
        <div className="space-y-2">
          <select className="rounded-xl border border-[#CBD5E1] bg-white px-3 py-2 text-sm font-bold" value={usageOrg} onChange={(e) => setUsageOrg(e.target.value)}>
            <option value="">전체 법인</option>
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
          <div className="overflow-x-auto rounded-2xl border border-[#E2E8F0] bg-white">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-[#E2E8F0] text-[10px] font-black text-[#94A3B8]">
                  <th className="px-3 py-2">일시</th>
                  <th className="px-3 py-2">법인</th>
                  <th className="px-3 py-2">서비스</th>
                  <th className="px-3 py-2">이용자</th>
                  <th className="px-3 py-2">내용</th>
                  <th className="px-3 py-2 text-right">금액 / 할인 / 청구</th>
                  <th className="px-3 py-2">청구</th>
                </tr>
              </thead>
              <tbody>
                {usage
                  .filter((u) => !usageOrg || u.orgId === usageOrg)
                  .slice(0, 200)
                  .map((u) => (
                    <tr key={u.id} className="border-b border-[#F1F5F9] font-bold text-[#334155]">
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(u.at)}</td>
                      <td className="px-3 py-2">{orgName(u.orgId)}</td>
                      <td className="px-3 py-2">{SERVICE_LABEL[u.service] ?? u.service}</td>
                      <td className="max-w-[110px] truncate px-3 py-2">{u.memberUid}</td>
                      <td className="max-w-[200px] truncate px-3 py-2">{u.label}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {pi(u.grossPi)} / {u.discountPi > 0 ? `-${pi(u.discountPi)}` : '0'} / <span className="font-black">{pi(u.netPi)}</span>
                      </td>
                      <td className="px-3 py-2">
                        {u.invoiceId ? (
                          <span className="rounded-full bg-[#D1FAE5] px-2 py-0.5 text-[9px] font-black text-[#047857]">청구됨</span>
                        ) : (
                          <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[9px] font-black text-[#B45309]">미청구</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!usage.length ? <p className="py-6 text-center text-xs font-bold text-[#94A3B8]">집계된 법인 이용 내역이 없습니다.</p> : null}
          </div>
        </div>
      ) : null}

      {tab === 'invoices' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-[#E2E8F0] bg-white p-4">
            <div>
              <p className="text-[10px] font-black text-[#94A3B8]">법인</p>
              <select className="mt-1 rounded-xl border border-[#CBD5E1] bg-white px-3 py-2 text-sm font-bold" value={issueForm.orgId} onChange={(e) => setIssueForm({ ...issueForm, orgId: e.target.value })}>
                <option value="">선택</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-[10px] font-black text-[#94A3B8]">청구 주기 (YYYY-MM)</p>
              <input className="mt-1 rounded-xl border border-[#CBD5E1] bg-white px-3 py-2 text-sm font-bold" value={issueForm.period} onChange={(e) => setIssueForm({ ...issueForm, period: e.target.value })} placeholder="2025-01" />
            </div>
            <button
              type="button"
              disabled={!issueForm.orgId || Boolean(busy)}
              className={btnCls}
              onClick={() => void post({ action: 'invoice-issue', orgId: issueForm.orgId, period: issueForm.period }, 'issue')}
            >
              합산 청구서 발행
            </button>
          </div>
          {invoices.map((inv) => (
            <div key={inv.id} className="rounded-2xl border border-[#E2E8F0] bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-[#0F172A]">
                    {inv.orgName} · {inv.period}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-black ${INVOICE_STATUS[inv.status]?.cls ?? ''}`}>{INVOICE_STATUS[inv.status]?.label ?? inv.status}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-[#64748B]">
                    {inv.id} · {inv.count}건 ({Object.entries(inv.byService).map(([svc, v]) => `${SERVICE_LABEL[svc]} ${v.count}건`).join(' · ')})
                    · 발행 {fmtDate(inv.issuedAt)} {inv.issuedBy}
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-[#334155]">
                    이용 합계 {pi(inv.netPi)}
                    {inv.discountPi > 0 ? ` (할인 -${pi(inv.discountPi)})` : ''}
                    {inv.monthlyFeePi > 0 ? ` + 구독료 ${pi(inv.monthlyFeePi)}` : ''} = <span className="font-black text-[#1D4ED8]">{pi(inv.totalPi)}</span>
                    {inv.status === 'paid' ? ` · 결제 ${fmtDate(inv.paidAt)} txid ${inv.payTxid?.slice(0, 12) ?? ''}…` : ''}
                    {inv.status === 'void' ? ` · 무효 사유: ${inv.voidReason ?? ''}` : ''}
                  </p>
                </div>
                {inv.status === 'issued' ? (
                  <button
                    type="button"
                    className="rounded-lg bg-[#FEE2E2] px-3 py-1.5 text-[11px] font-black text-[#B91C1C] disabled:opacity-50"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      const reason = window.prompt('무효 처리 사유를 입력하세요 (이용 건은 재청구 가능 상태로 돌아갑니다)')
                      if (reason) void post({ action: 'invoice-void', invoiceId: inv.id, reason }, `void-${inv.id}`)
                    }}
                  >
                    무효 처리
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {!invoices.length ? <p className="py-6 text-center text-xs font-bold text-[#94A3B8]">발행된 인보이스가 없습니다.</p> : null}
        </div>
      ) : null}
    </div>
  )
}
