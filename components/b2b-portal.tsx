'use client'

import { useCallback, useEffect, useState } from 'react'
import { Building2, CircleDollarSign, FileText, Users, X } from 'lucide-react'
import { PiCheckoutButton, describePiUserMessage } from '@/components/pi-checkout'
import type { B2bInvoice, B2bMember, B2bOrg, B2bPlan, B2bUsage } from '@/lib/b2b-store'

type PortalData = {
  member: boolean
  role?: 'manager' | 'member'
  period?: string
  org?: B2bOrg
  plan?: B2bPlan | null
  members?: B2bMember[]
  usage?: B2bUsage[]
  invoices?: B2bInvoice[]
}

const SERVICE_LABEL: Record<string, string> = { taxi: '택시', daeri: '대리운전', delivery: '택배' }
const fmtDate = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''
}
const pi = (n: number) => `${(Number.isFinite(n) ? n : 0).toFixed(4)} Pi`

/**
 * B2B 법인 포털 — 소속 임직원·파트너가 자사 이용 내역과 합산 청구서를 보는
 * 전용 대시보드. 담당자(manager)는 소속원 관리·인보이스 발행·Pi 결제를 할 수 있다.
 */
export default function B2bPortal({ uid, onClose, onNotice }: { uid: string; onClose: () => void; onNotice?: (message: string) => void }) {
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'usage' | 'invoices' | 'members'>('usage')
  const [memberForm, setMemberForm] = useState({ uid: '', memberName: '', role: 'member' })
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/b2b/portal?uid=${encodeURIComponent(uid)}`, { cache: 'no-store' }).catch(() => null)
    const json = (await res?.json().catch(() => null)) as PortalData | null
    if (json) setData(json)
    setLoading(false)
  }, [uid])

  useEffect(() => {
    void load()
  }, [load])

  const isManager = data?.role === 'manager'
  const usage = data?.usage ?? []
  const invoices = data?.invoices ?? []
  const members = data?.members ?? []
  const unbilled = usage.filter((u) => !u.invoiceId)
  const unbilledPi = unbilled.reduce((s, u) => s + u.netPi, 0)
  const openInvoice = invoices.find((inv) => inv.status === 'issued')

  const post = async (body: Record<string, unknown>) => {
    setBusy('post')
    try {
      const res = await fetch('/api/b2b/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, ...body }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !json?.ok) {
        const msg =
          json?.error === 'manager_required'
            ? '법인 담당자만 사용할 수 있습니다'
            : json?.error === 'already_issued'
              ? '해당 주기 인보이스가 이미 발행되어 있습니다'
              : json?.error === 'empty'
                ? '청구할 이용 내역이 없습니다'
                : json?.error === 'payment_unverified'
                  ? '결제 검증에 실패했습니다 — 잠시 후 다시 시도해 주세요'
                  : `실패: ${json?.error || res.status}`
        onNotice?.(msg)
        return null
      }
      await load()
      return json
    } finally {
      setBusy('')
    }
  }

  const confirmInvoicePaid = async (invoiceId: string, paymentId: string, txid: string) => {
    // /api/pi/complete의 백그라운드 마감과 별도로 즉시 확인을 시도한다(멱등).
    const res = await post({ action: 'invoice-confirm', invoiceId, paymentId, txid })
    if (res) onNotice?.('법인 청구서 결제가 완료되었습니다')
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-[#F8FAFC] shadow-2xl sm:rounded-[28px]" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-[#E2E8F0] bg-white px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#E8F1FA] text-[#4A82B8]">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-black text-[#0F172A]">{data?.org?.name ?? '법인 포털'}</p>
              <p className="text-[10px] font-bold text-[#64748B]">
                B2B 법인 계정 {data?.org?.bizNo ? `· 사업자 ${data.org.bizNo}` : ''} {isManager ? '· 담당자' : '· 임직원'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#64748B]">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <p className="py-12 text-center text-sm font-bold text-[#64748B]">불러오는 중…</p>
          ) : !data?.member ? (
            <p className="py-12 text-center text-sm font-bold text-[#64748B]">소속된 법인 계정이 없습니다.</p>
          ) : (
            <div className="space-y-4">
              {data.plan ? (
                <div className="rounded-2xl border border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3">
                  <p className="text-[10px] font-black tracking-wide text-[#4A82B8]">적용 요금제</p>
                  <p className="mt-1 text-sm font-black text-[#0F172A]">
                    {data.plan.name} · {data.plan.discountPct}% 할인
                    {data.plan.monthlyFeePi > 0 ? ` · 월 ${pi(data.plan.monthlyFeePi)}` : ''}
                  </p>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl border border-[#E2E8F0] bg-white p-3.5">
                  <p className="text-[10px] font-black text-[#94A3B8]">{data.period} 미청구 이용</p>
                  <p className="mt-1 text-lg font-black text-[#0F172A]">{unbilled.length}건</p>
                  <p className="text-[11px] font-bold text-[#64748B]">{pi(unbilledPi)}</p>
                </div>
                <div className="rounded-2xl border border-[#E2E8F0] bg-white p-3.5">
                  <p className="text-[10px] font-black text-[#94A3B8]">미결제 청구서</p>
                  <p className="mt-1 text-lg font-black text-[#B45309]">{openInvoice ? pi(openInvoice.totalPi) : '없음'}</p>
                  <p className="text-[11px] font-bold text-[#64748B]">{openInvoice ? `${openInvoice.period} · ${openInvoice.count}건` : '모두 결제 완료'}</p>
                </div>
              </div>

              {isManager && openInvoice ? (
                <PiCheckoutButton
                  amount={openInvoice.totalPi}
                  memo={`법인 청구 ${openInvoice.period}`.slice(0, 25)}
                  metadata={{ kind: 'b2b-invoice', invoiceId: openInvoice.id, orgId: openInvoice.orgId, label: `법인 ${openInvoice.period} 합산 청구` }}
                  advanceOnApproval={false}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#4A82B8] py-3.5 text-sm font-black text-white shadow-[0_10px_20px_rgba(74,130,184,0.35)]"
                  onPaid={(result) => {
                    if (result.paymentId && result.txid) void confirmInvoicePaid(openInvoice.id, result.paymentId, result.txid)
                  }}
                  onFailed={(error) => onNotice?.(describePiUserMessage(error))}
                >
                  <CircleDollarSign className="h-4 w-4" />
                  {openInvoice.period} 청구서 {pi(openInvoice.totalPi)} Pi 결제
                </PiCheckoutButton>
              ) : null}

              {isManager && !openInvoice && unbilled.length > 0 ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  className="w-full rounded-2xl border-2 border-[#4A82B8] bg-white py-3 text-sm font-black text-[#4A82B8] disabled:opacity-50"
                  onClick={() => void post({ action: 'invoice-issue' })}
                >
                  {data.period} 이용 {unbilled.length}건 합산 청구서 발행 ({pi(unbilledPi)})
                </button>
              ) : null}

              <div className="flex gap-1.5">
                {(
                  [
                    ['usage', '이용 내역', FileText],
                    ['invoices', '청구서', CircleDollarSign],
                    ['members', '소속원', Users],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={`flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-black ${tab === id ? 'bg-[#4A82B8] text-white' : 'bg-white text-[#64748B] ring-1 ring-[#E2E8F0]'}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'usage' ? (
                <ul className="space-y-1.5">
                  {usage.slice(0, 100).map((u) => (
                    <li key={u.id} className="rounded-xl border border-[#E2E8F0] bg-white px-3.5 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-xs font-black text-[#0F172A]">{u.label}</p>
                        <p className="shrink-0 text-xs font-black text-[#1D4ED8]">{pi(u.netPi)}</p>
                      </div>
                      <p className="mt-0.5 text-[10px] font-bold text-[#94A3B8]">
                        {fmtDate(u.at)} · {SERVICE_LABEL[u.service] ?? u.service}
                        {isManager ? ` · ${u.memberUid}` : ''}
                        {u.discountPi > 0 ? ` · 할인 -${pi(u.discountPi)}` : ''}
                        {u.invoiceId ? ' · 청구됨' : ' · 미청구'}
                      </p>
                    </li>
                  ))}
                  {!usage.length ? <li className="py-8 text-center text-xs font-bold text-[#94A3B8]">이용 내역이 없습니다.</li> : null}
                </ul>
              ) : null}

              {tab === 'invoices' ? (
                <ul className="space-y-1.5">
                  {invoices.map((inv) => (
                    <li key={inv.id} className="rounded-xl border border-[#E2E8F0] bg-white px-3.5 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-black text-[#0F172A]">
                          {inv.period} 합산 청구서
                          <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-black ${inv.status === 'paid' ? 'bg-[#D1FAE5] text-[#047857]' : inv.status === 'void' ? 'bg-[#F1F5F9] text-[#64748B]' : 'bg-[#FEF3C7] text-[#B45309]'}`}>
                            {inv.status === 'paid' ? '결제 완료' : inv.status === 'void' ? '무효' : '청구됨'}
                          </span>
                        </p>
                        <p className="text-xs font-black text-[#1D4ED8]">{pi(inv.totalPi)}</p>
                      </div>
                      <p className="mt-0.5 text-[10px] font-bold text-[#94A3B8]">
                        {inv.count}건 · 이용 {pi(inv.netPi)}
                        {inv.monthlyFeePi > 0 ? ` + 구독료 ${pi(inv.monthlyFeePi)}` : ''} · 발행 {fmtDate(inv.issuedAt)}
                        {inv.status === 'paid' && inv.paidAt ? ` · 결제 ${fmtDate(inv.paidAt)}` : ''}
                        {inv.status === 'void' && inv.voidReason ? ` · ${inv.voidReason}` : ''}
                      </p>
                    </li>
                  ))}
                  {!invoices.length ? <li className="py-8 text-center text-xs font-bold text-[#94A3B8]">발행된 청구서가 없습니다.</li> : null}
                </ul>
              ) : null}

              {tab === 'members' ? (
                <div className="space-y-2">
                  <ul className="space-y-1.5">
                    {members.map((member) => (
                      <li key={member.uid} className="flex items-center justify-between rounded-xl border border-[#E2E8F0] bg-white px-3.5 py-2.5 text-xs font-bold">
                        <span className="min-w-0">
                          {member.name || member.uid}
                          <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-black ${member.role === 'manager' ? 'bg-[#DBEAFE] text-[#1D4ED8]' : 'bg-[#F1F5F9] text-[#64748B]'}`}>
                            {member.role === 'manager' ? '담당자' : '임직원'}
                          </span>
                        </span>
                        {isManager && member.uid !== uid ? (
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            className="shrink-0 text-[10px] font-black text-[#B91C1C]"
                            onClick={() => void post({ action: 'member-remove', memberUid: member.uid })}
                          >
                            제외
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {isManager ? (
                    <div className="flex gap-1.5">
                      <input
                        className="min-w-0 flex-1 rounded-xl border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs font-bold"
                        placeholder="추가할 임직원 Pi uid"
                        value={memberForm.uid}
                        onChange={(e) => setMemberForm({ ...memberForm, uid: e.target.value })}
                      />
                      <input
                        className="w-20 rounded-xl border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs font-bold"
                        placeholder="이름"
                        value={memberForm.memberName}
                        onChange={(e) => setMemberForm({ ...memberForm, memberName: e.target.value })}
                      />
                      <button
                        type="button"
                        disabled={!memberForm.uid.trim() || Boolean(busy)}
                        className="rounded-xl bg-[#4A82B8] px-3 py-2 text-[11px] font-black text-white disabled:opacity-50"
                        onClick={() =>
                          void post({ action: 'member-add', ...memberForm }).then((res) => {
                            if (res) setMemberForm({ uid: '', memberName: '', role: 'member' })
                          })
                        }
                      >
                        추가
                      </button>
                    </div>
                  ) : (
                    <p className="rounded-xl bg-[#F1F5F9] px-3 py-2 text-[10px] font-bold text-[#64748B]">소속원 관리는 법인 담당자만 할 수 있습니다.</p>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
