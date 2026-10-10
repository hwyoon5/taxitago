'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import { isPiWalletAddress } from '@/lib/pi-wallet'
import { type SettlementEntry, type SettlementService } from '@/lib/settlement-types'
import AdminWithdraw from '@/components/admin-withdraw'
import AdminWithdrawMonitor from '@/components/admin-withdraw-monitor'
import AdminWalletHistory from '@/components/admin-wallet-history'
import type { AuditEntry } from '@/lib/audit-store'
import type { DepositEntry } from '@/lib/deposit-store'
import type { WalletTxEntry } from '@/lib/wallet-history'
import { buildSettlementCsv } from '@/lib/settlement-csv'

type ServiceSummary = { label: string; count: number; gross: number; commission: number; net: number }
type TxBucket = { count: number; total: number; fee?: number }
type TxTotals = {
  deposit: { count: number; total: number }
  /** 전체 출금(수수료 인출 + 이용자 잔액 반환). */
  withdraw: TxBucket
  /** 수수료 수익의 실제 인출 — 순수익 계산에는 이것만 차감한다. */
  feeWithdraw?: TxBucket
  /** 이용자 잔액 반환 — 플랫폼 수익 지출이 아니므로 통계에서 제외. */
  userWithdraw?: TxBucket
  reward?: { count: number; total: number }
}
/** 수익 인출분 — feeWithdraw가 없는 구형 응답은 전체 출금을 보수적으로 사용한다. */
const feeOut = (totals: TxTotals | null): TxBucket => totals?.feeWithdraw ?? totals?.withdraw ?? { count: 0, total: 0, fee: 0 }
type Summary = {
  count: number
  gross: number
  commission: number
  net: number
  pendingCount: number
  pendingNet: number
  byService: Record<SettlementService, ServiceSummary>
}

const SERVICES: SettlementService[] = ['taxi', 'daeri', 'delivery', 'bicycle', 'kickboard', 'ev', 'parking']
const SERVICE_LABEL: Record<SettlementService, string> = {
  taxi: '택시',
  daeri: '대리운전',
  delivery: '택배',
  bicycle: '자전거',
  kickboard: '킥보드',
  ev: 'EV충전',
  parking: '주차',
}
const SERVICE_TONE: Record<SettlementService, string> = {
  taxi: 'bg-[#DBEAFE] text-[#1D4ED8]',
  daeri: 'bg-[#FEF3C7] text-[#B45309]',
  delivery: 'bg-[#DCFCE7] text-[#15803D]',
  bicycle: 'bg-[#D1FAE5] text-[#047857]',
  kickboard: 'bg-[#FFE4E6] text-[#BE123C]',
  ev: 'bg-[#E0E7FF] text-[#4338CA]',
  parking: 'bg-[#F1F5F9] text-[#475569]',
}

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
  spend: '잔액 결제 차감',
}

const pi = (value: number) => `${value.toFixed(7)} Pi`
const PAGE_SIZE = 10

export default function AdminSettlements() {
  const [entries, setEntries] = useState<SettlementEntry[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [filter, setFilter] = useState<'all' | SettlementService>('all')
  const [period, setPeriod] = useState<'all' | 'today' | 'd7' | 'd30'>('all')
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [actionReason, setActionReason] = useState('')
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [deposits, setDeposits] = useState<(DepositEntry & { userCredited?: boolean; servicePayment?: boolean })[]>([])
  const [depositTotal, setDepositTotal] = useState<{ count: number; total: number } | null>(null)
  const [history, setHistory] = useState<WalletTxEntry[]>([])
  const [historyTotals, setHistoryTotals] = useState<TxTotals | null>(null)
  const [adminWallet, setAdminWallet] = useState('')
  const [depositBusy, setDepositBusy] = useState(false)
  const [depositForm, setDepositForm] = useState({ txid: '', fromWallet: '', amount: '', memo: '' })
  const [showAudit, setShowAudit] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ gross: string; memo: string; driverId: string; driverName: string; status: 'pending' | 'settled'; reason: string } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [view, setView] = useState<'summary' | 'detail' | 'wallet'>('summary')
  const [queryDate, setQueryDate] = useState('')
  const [page, setPage] = useState(1)

  const tell = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  const reload = useCallback(() => {
    void fetch('/api/admin/settlements', { headers: adminHeaders(), cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error || 'load_failed')
        return data as { entries: SettlementEntry[]; summary: Summary; audit?: AuditEntry[]; deposits?: DepositEntry[]; depositTotal?: { count: number; total: number }; history?: WalletTxEntry[]; historyTotals?: TxTotals; adminWallet?: string }
      })
      .then((data) => {
        setEntries(data.entries)
        setSummary(data.summary)
        setAudit(data.audit ?? [])
        setDeposits(data.deposits ?? [])
        setDepositTotal(data.depositTotal ?? null)
        setHistory(data.history ?? [])
        setHistoryTotals(data.historyTotals ?? null)
        setAdminWallet(typeof data.adminWallet === 'string' ? data.adminWallet : '')
        setError('')
      })
      .catch(() => setError('정산 내역을 불러오지 못했습니다.'))
  }, [])

  useEffect(() => {
    reload()
    const timer = window.setInterval(reload, 10000)
    // 탭 복귀·창 포커스 시 즉시 재조회 — 수수료 갱신이 폴링 주기까지 지연되지 않게 한다.
    const onWake = () => { if (document.visibilityState === 'visible') reload() }
    window.addEventListener('focus', reload)
    document.addEventListener('visibilitychange', onWake)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', reload)
      document.removeEventListener('visibilitychange', onWake)
    }
  }, [reload])

  const patch = (body: Record<string, unknown>) =>
    fetch('/api/admin/settlements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(body),
    }).then(async (res) => {
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'failed')
      return data
    })

  const settleEntry = (id: string) => {
    if (busy) return
    setBusy(true)
    void patch({ action: 'settle', id, reason: actionReason })
      .then(() => reload())
      .catch(() => setError('정산 처리에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const settleAll = () => {
    if (busy || !summary?.pendingCount) return
    setBusy(true)
    void patch({ action: 'settle-all', reason: actionReason })
      .then((data: { count?: number }) => {
        tell(`${data.count ?? 0}건을 정산 완료로 처리했습니다.`)
        reload()
      })
      .catch(() => setError('일괄 정산에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const reconcile = () => {
    if (syncing) return
    setSyncing(true)
    void patch({ action: 'reconcile', reason: actionReason })
      .then((data: { synced?: number }) => {
        tell(data.synced ? `기사 수익 ${data.synced}건을 장부와 동기화했습니다.` : '장부와 기사 수익이 이미 일치합니다.')
        reload()
      })
      .catch(() => setError('내역 동기화에 실패했습니다.'))
      .finally(() => setSyncing(false))
  }

  const openEditor = (entry: SettlementEntry) => {
    setEditing(entry.id)
    setDraft({ gross: String(entry.gross), memo: entry.memo, driverId: entry.driverId, driverName: entry.driverName, status: entry.status, reason: '' })
  }

  const saveAdjust = () => {
    if (busy || !editing || !draft) return
    const gross = Number(draft.gross)
    if (!Number.isFinite(gross) || gross <= 0) {
      setError('정산 금액을 확인해 주세요.')
      return
    }
    setBusy(true)
    void patch({ action: 'adjust', id: editing, gross, memo: draft.memo, driverId: draft.driverId, driverName: draft.driverName, status: draft.status, reason: draft.reason })
      .then(() => {
        setEditing(null)
        setDraft(null)
        tell('정산 내역을 보정하고 기사 수익에 반영했습니다.')
        reload()
      })
      .catch(() => setError('정산 보정에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const submitDeposit = (event: FormEvent) => {
    event.preventDefault()
    if (depositBusy) return
    const txid = depositForm.txid.trim()
    const fromWallet = depositForm.fromWallet.trim()
    const amount = Number(depositForm.amount)
    if (!txid) {
      setError('트랜잭션 ID를 입력해 주세요.')
      return
    }
    if (!isPiWalletAddress(fromWallet)) {
      setError('보낸 지갑 주소가 올바르지 않습니다. (G로 시작하는 56자리)')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('입금 금액이 올바르지 않습니다.')
      return
    }
    setDepositBusy(true)
    void patch({ action: 'deposit', txid, fromWallet, amount, memo: depositForm.memo, reason: depositForm.memo })
      .then((data) => {
        setDepositForm({ txid: '', fromWallet: '', amount: '', memo: '' })
        setError('')
        const chain = (data as { chainStatus?: string } | undefined)?.chainStatus
        tell(
          chain === 'verified'
            ? '입금 기록을 추가했습니다. (체인 검증 완료 — 이용자 잔액에 자동 반영됩니다)'
            : '입금 기록을 추가했습니다. (체인 미확인 — 이용자 잔액에 자동 반영됩니다)',
        )
        reload()
      })
      .catch((err) => setError(err instanceof Error ? err.message : '입금 기록에 실패했습니다.'))
      .finally(() => setDepositBusy(false))
  }

  const periodStart = () => {
    if (period === 'all') return null
    const now = new Date()
    if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return new Date(now.getTime() - (period === 'd7' ? 7 : 30) * 86400000)
  }
  const start = periodStart()
  const visible = entries.filter((entry) =>
    (filter === 'all' || entry.service === filter) &&
    (!start || new Date(entry.createdAt) >= start) &&
    (!queryDate || entry.createdAt.slice(0, 10) === queryDate),
  )
  const maxPage = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const pageSafe = Math.min(page, maxPage)
  const paged = visible.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE)

  const exportCsv = () => {
    if (!visible.length) {
      setError('내려받을 정산 내역이 없습니다.')
      return
    }
    const csv = buildSettlementCsv(visible, audit, deposits)
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
    anchor.href = url
    anchor.download = `taxitago-settlements-${period}-${stamp}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    tell(`정산 내역 ${visible.length}건을 CSV로 내려받았습니다.`)
  }
  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-white p-1 shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
        {([['summary', '요약'], ['detail', '상세 내역'], ['wallet', '지갑·입출금']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={`rounded-xl py-2.5 text-xs font-black transition ${view === id ? 'bg-[#4C1FB8] text-white shadow-[0_8px_16px_rgba(76,31,184,0.28)]' : 'text-[#64748B]'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'summary' && summary ? (
        <section className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-3">
            <p className="text-[11px] font-black text-[#64748B]">총 결제액</p>
            <p className="mt-1 text-lg font-black">{pi(summary.gross)}</p>
            <p className="text-[10px] font-bold text-[#94A3B8]">{summary.count}건</p>
          </div>
          <div className="rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] p-3">
            <p className="text-[11px] font-black text-[#4C1FB8]">총 수수료 수익 (출금 후 잔액)</p>
            <p className="mt-1 text-lg font-black text-[#4C1FB8]">
              {pi(Math.max(0, summary.commission - feeOut(historyTotals).total - (feeOut(historyTotals).fee ?? 0)))}
            </p>
            <p className="text-[10px] font-bold text-[#94A3B8]">
              누적 {pi(summary.commission)}
              {feeOut(historyTotals).count ? ` · 수수료 인출 ${pi(feeOut(historyTotals).total + (feeOut(historyTotals).fee ?? 0))}` : ''}
            </p>
          </div>
          <div className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-3">
            <p className="text-[11px] font-black text-[#64748B]">기사 정산액(순지급)</p>
            <p className="mt-1 text-lg font-black">{pi(summary.net)}</p>
          </div>
          <div className="rounded-2xl border-2 border-[#E9D5FF] bg-[#FAF5FF] p-3">
            <p className="text-[11px] font-black text-[#7E22CE]">리뷰 보상 지출</p>
            <p className="mt-1 text-lg font-black text-[#7E22CE]">{pi(historyTotals?.reward?.total ?? 0)}</p>
            <p className="text-[10px] font-bold text-[#94A3B8]">감사 포인트 {historyTotals?.reward?.count ?? 0}건</p>
          </div>
          <div className="rounded-2xl border-2 border-[#FDE68A] bg-[#FFFBEB] p-3">
            <p className="text-[11px] font-black text-[#B45309]">정산 대기</p>
            <p className="mt-1 text-lg font-black text-[#B45309]">{summary.pendingCount}건</p>
            <p className="text-[10px] font-bold text-[#B45309]">{pi(summary.pendingNet)}</p>
          </div>
          <div className="rounded-2xl border-2 border-[#A7F3D0] bg-[#ECFDF5] p-3">
            <p className="text-[11px] font-black text-[#047857]">최종 순수익 (Net Revenue)</p>
            <p className="mt-1 text-lg font-black text-[#047857]">
              {pi(Math.max(0, summary.commission - feeOut(historyTotals).total - (feeOut(historyTotals).fee ?? 0) - (historyTotals?.reward?.total ?? 0)))}
            </p>
            <p className="text-[10px] font-bold text-[#94A3B8]">
              수수료 {pi(summary.commission)} − 수수료 인출 {pi(feeOut(historyTotals).total + (feeOut(historyTotals).fee ?? 0))} − 리뷰 보상 {pi(historyTotals?.reward?.total ?? 0)}
            </p>
          </div>
        </section>
      ) : null}

      {view === 'summary' && depositTotal && depositTotal.count > 0 ? (
        <section className="rounded-2xl border-2 border-[#BFDBFE] bg-[#EFF6FF] p-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-black text-[#1D4ED8]">플랫폼 지갑 입금 (테스트넷)</p>
            <p className="text-[10px] font-bold text-[#1D4ED8]">{depositTotal.count}건</p>
          </div>
          <p className="mt-1 text-lg font-black text-[#1D4ED8]">{pi(depositTotal.total)}</p>
          <div className="mt-2 space-y-1">
            {deposits.slice(0, 5).map((deposit) => (
              <p key={deposit.id} className="truncate text-[10px] font-bold text-[#3B82F6]">
                {new Date(deposit.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {deposit.amount.toFixed(7)} Pi · {deposit.fromWallet.slice(0, 12)}… → {deposit.toWallet.slice(0, 12)}…
                {deposit.servicePayment ? (
                  <span className="ml-1 rounded-full bg-[#E0E7FF] px-1.5 py-px text-[9px] font-black text-[#4338CA]">서비스 결제</span>
                ) : (
                  <span className={`ml-1 rounded-full px-1.5 py-px text-[9px] font-black ${deposit.userCredited ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#FEE2E2] text-[#B91C1C]'}`}>
                    {deposit.userCredited ? '잔액 반영' : '미반영'}
                  </span>
                )}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      {view === 'summary' ? <AdminWithdrawMonitor /> : null}

      {view === 'wallet' ? (
      <section className="rounded-2xl border-2 border-[#A7F3D0] bg-[#F0FDF9] p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-black text-[#047857]">테스트넷 입금 수동 동기화</p>
          <span className="rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[10px] font-black text-[#15803D]">입금 IN</span>
        </div>
        <p className="mt-1 text-[10px] font-bold text-[#94A3B8]">
          테스트넷 전송 건을 입금 장부에 수동으로 기록합니다. 동일한 txid는 중복 등록되지 않으며, 기록 즉시 해당 지갑 이용자의 잔액에 자동 반영됩니다.
          {isPiWalletAddress(adminWallet) ? ` 입금 지갑: ${adminWallet.slice(0, 12)}…` : ' 지갑 주소 설정 탭에서 관리자 지갑을 먼저 등록해 주세요.'}
        </p>

        <form onSubmit={submitDeposit} className="mt-3 space-y-2">
          <label className="block">
            <span className="text-[10px] font-black text-[#64748B]">트랜잭션 ID (txid)</span>
            <input
              type="text"
              required
              value={depositForm.txid}
              onChange={(event) => setDepositForm((form) => ({ ...form, txid: event.target.value }))}
              placeholder="트랜잭션 ID 입력"
              className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
            />
          </label>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-black text-[#64748B]">보낸 지갑 주소</span>
              <button
                type="button"
                disabled={!isPiWalletAddress(adminWallet)}
                onClick={() => setDepositForm((form) => ({ ...form, fromWallet: adminWallet }))}
                className="rounded-full bg-[#4C1FB8] px-3 py-1 text-[10px] font-black text-white disabled:opacity-40"
              >
                내 관리자 주소 자동 입력
              </button>
            </div>
            <input
              type="text"
              required
              value={depositForm.fromWallet}
              onChange={(event) => setDepositForm((form) => ({ ...form, fromWallet: event.target.value }))}
              placeholder="G로 시작하는 56자리 주소"
              className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-black text-[#64748B]">금액 (Pi)</span>
              <input
                type="number"
                required
                min={0}
                step={0.0000001}
                value={depositForm.amount}
                onChange={(event) => setDepositForm((form) => ({ ...form, amount: event.target.value }))}
                placeholder="12.5"
                className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black text-[#64748B]">메모 (선택)</span>
              <input
                type="text"
                value={depositForm.memo}
                onChange={(event) => setDepositForm((form) => ({ ...form, memo: event.target.value }))}
                placeholder="메모 입력"
                className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={depositBusy}
            className="w-full rounded-xl bg-[#047857] py-2 text-xs font-black text-white disabled:opacity-50"
          >
            {depositBusy ? '기록 중…' : '입금 기록 추가'}
          </button>
        </form>
      </section>
      ) : null}

      {view === 'wallet' ? (
        <>
          <AdminWithdraw adminWallet={adminWallet} onChanged={reload} />
          <AdminWalletHistory
            entries={history}
            totals={historyTotals ? { ...historyTotals, withdraw: { count: historyTotals.withdraw.count, total: historyTotals.withdraw.total, fee: historyTotals.withdraw.fee ?? 0 } } : null}
          />
        </>
      ) : null}

      {view === 'summary' && summary ? (
        <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-black">서비스별 집계</p>
            <button
              type="button"
              disabled={busy || !summary.pendingCount}
              onClick={settleAll}
              className="rounded-full bg-[#0F172A] px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-50"
            >
              대기 {summary.pendingCount}건 일괄 정산
            </button>
          </div>
          <div className="mt-2 space-y-1.5">
            {SERVICES.map((service) => {
              const row = summary.byService[service]
              return (
                <div key={service} className="flex items-center justify-between rounded-xl bg-[#F8FAFC] px-3 py-2 text-xs font-bold">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${SERVICE_TONE[service]}`}>{SERVICE_LABEL[service]}</span>
                  <span className="text-[#64748B]">{row.count}건 · 결제 {pi(row.gross)} · 수수료 <strong className="text-[#4C1FB8]">{pi(row.commission)}</strong></span>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {view === 'detail' ? (
      <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black">정산 내역</p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={syncing}
              onClick={reconcile}
              className="rounded-full border-2 border-[#4C1FB8] bg-white px-3 py-1.5 text-[11px] font-black text-[#4C1FB8] disabled:opacity-50"
            >
              {syncing ? '동기화 중…' : '내역 동기화·보정'}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              className="rounded-full bg-[#047857] px-3 py-1.5 text-[11px] font-black text-white"
            >
              엑셀(CSV) 다운로드
            </button>
          </div>
        </div>
        <p className="mt-1 text-[10px] font-bold text-[#94A3B8]">장부 기준으로 기사 모드 수익 내역을 강제로 일치시킵니다.</p>
        <input
          type="text"
          value={actionReason}
          onChange={(event) => setActionReason(event.target.value)}
          placeholder="처리 사유·메모 (선택 — 정산·보정·동기화 업무 기록에 함께 저장됩니다)"
          className="mt-2 w-full rounded-lg border-2 border-[#D8CCF5] bg-[#F8F5FF] px-2.5 py-1.5 text-[11px] font-bold outline-none focus:border-[#4C1FB8]"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
          <div className="flex gap-1">
            {([['today', '오늘'], ['d7', '7일'], ['d30', '30일'], ['all', '전체 기간']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setPeriod(key); setPage(1) }}
                className={`rounded-full px-2.5 py-1 text-[11px] font-black ${period === key ? 'bg-[#0F172A] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {(['all', ...SERVICES] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => { setFilter(key); setPage(1) }}
                className={`rounded-full px-2.5 py-1 text-[11px] font-black ${filter === key ? 'bg-[#4C1FB8] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
              >
                {key === 'all' ? '전체' : SERVICE_LABEL[key]}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <input
            type="date"
            value={queryDate}
            onChange={(event) => { setQueryDate(event.target.value); setPage(1) }}
            aria-label="날짜로 검색"
            className="w-full rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-[11px] font-bold outline-none focus:border-[#4C1FB8]"
          />
          {queryDate ? (
            <button
              type="button"
              onClick={() => { setQueryDate(''); setPage(1) }}
              className="shrink-0 rounded-full bg-[#F1F5F9] px-2.5 py-1 text-[10px] font-black text-[#475569]"
            >
              날짜 해제
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-2 text-xs font-black text-[#DC2626]">{error}</p> : null}
        <div className="mt-3 space-y-2">
          {paged.map((entry) => (
            <div key={entry.id} className="rounded-xl border-2 border-[#E2E8F0] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${SERVICE_TONE[entry.service]}`}>{SERVICE_LABEL[entry.service]}</span>
                <span className="text-[10px] font-bold text-[#94A3B8]">{new Date(entry.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <p className="mt-1.5 text-xs font-black">{entry.driverName || entry.driverId} <span className="font-bold text-[#64748B]">· {entry.memo}</span></p>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] font-bold text-[#64748B]">
                <span>결제 {pi(entry.gross)} · 수수료 {entry.rate}% = <strong className="text-[#4C1FB8]">{pi(entry.commission)}</strong> · 기사 {pi(entry.net)}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  {entry.status === 'pending' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => settleEntry(entry.id)}
                      className="rounded-full bg-[#FEF3C7] px-2.5 py-1 text-[10px] font-black text-[#B45309] disabled:opacity-50"
                    >
                      정산 처리
                    </button>
                  ) : (
                    <span className="rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-black text-[#15803D]">정산 완료</span>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => (editing === entry.id ? setEditing(null) : openEditor(entry))}
                    className="rounded-full bg-[#EDE9FE] px-2.5 py-1 text-[10px] font-black text-[#4C1FB8] disabled:opacity-50"
                  >
                    {editing === entry.id ? '닫기' : '보정'}
                  </button>
                </div>
              </div>
              {(entry.driverWallet || entry.adminWallet) ? (
                <p className="mt-1 text-[10px] font-bold text-[#94A3B8]">
                  기사 지갑 → {entry.driverWallet || '미지정'} · 관리자 지갑 → {entry.adminWallet || '미지정'}
                </p>
              ) : null}
              {editing === entry.id && draft ? (
                <div className="mt-2 space-y-2 rounded-xl bg-[#F8FAFC] p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-[10px] font-black text-[#64748B]">정산 금액(Pi)</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={draft.gross}
                        onChange={(event) => setDraft({ ...draft, gross: event.target.value })}
                        className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-black text-[#64748B]">정산 상태</span>
                      <select
                        value={draft.status}
                        onChange={(event) => setDraft({ ...draft, status: event.target.value as 'pending' | 'settled' })}
                        className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] bg-white px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
                      >
                        <option value="pending">정산 대기</option>
                        <option value="settled">정산 완료</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-black text-[#64748B]">기사 ID</span>
                      <input
                        type="text"
                        value={draft.driverId}
                        onChange={(event) => setDraft({ ...draft, driverId: event.target.value })}
                        className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-black text-[#64748B]">기사명</span>
                      <input
                        type="text"
                        value={draft.driverName}
                        onChange={(event) => setDraft({ ...draft, driverName: event.target.value })}
                        className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-[10px] font-black text-[#64748B]">메모</span>
                    <input
                      type="text"
                      value={draft.memo}
                      onChange={(event) => setDraft({ ...draft, memo: event.target.value })}
                      className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-black text-[#64748B]">조정 사유 (감사 로그에 기록)</span>
                    <input
                      type="text"
                      value={draft.reason}
                      onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                      placeholder="예: 금액 오기재 정정, 기사 ID 불일치 보정"
                      className="mt-0.5 w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-xs font-black outline-none focus:border-[#4C1FB8]"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={saveAdjust}
                      className="flex-1 rounded-xl bg-[#4C1FB8] py-2 text-xs font-black text-white disabled:opacity-50"
                    >
                      보정 적용
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditing(null); setDraft(null) }}
                      className="rounded-xl bg-[#E2E8F0] px-4 py-2 text-xs font-black text-[#475569]"
                    >
                      취소
                    </button>
                  </div>
                  <p className="text-[10px] font-bold text-[#94A3B8]">금액·기사 정보를 바꾸면 기사 모드 수익 내역에도 즉시 반영됩니다.</p>
                </div>
              ) : null}
            </div>
          ))}
          {visible.length === 0 ? <p className="py-6 text-center text-xs font-bold text-[#94A3B8]">정산 내역이 없습니다.</p> : null}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            disabled={pageSafe <= 1}
            onClick={() => setPage(pageSafe - 1)}
            className="rounded-full bg-[#F1F5F9] px-3 py-1.5 text-[11px] font-black text-[#475569] disabled:opacity-40"
          >
            ‹ 이전
          </button>
          <span className="text-[11px] font-black text-[#64748B]">
            {visible.length}건 · {pageSafe}/{maxPage} 페이지
          </span>
          <button
            type="button"
            disabled={pageSafe >= maxPage}
            onClick={() => setPage(pageSafe + 1)}
            className="rounded-full bg-[#F1F5F9] px-3 py-1.5 text-[11px] font-black text-[#475569] disabled:opacity-40"
          >
            다음 ›
          </button>
        </div>
      </section>
      ) : null}

      {view === 'detail' ? (
      <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
        <button type="button" onClick={() => setShowAudit((prev) => !prev)} className="flex w-full items-center justify-between">
          <p className="text-sm font-black">조정·동기화 이력 <span className="text-[#94A3B8]">({audit.length})</span></p>
          <span className="text-xs font-black text-[#4C1FB8]">{showAudit ? '접기' : '펼치기'}</span>
        </button>
        {showAudit ? (
          <div className="mt-3 space-y-2">
            {audit.map((log) => (
              <div key={log.id} className="rounded-xl bg-[#F8FAFC] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-[#EDE9FE] px-2 py-0.5 text-[10px] font-black text-[#4C1FB8]">{AUDIT_LABEL[log.kind] || log.kind}</span>
                  <span className="text-[10px] font-bold text-[#94A3B8]">{new Date(log.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {log.detail ? <p className="mt-1 text-[11px] font-bold text-[#475569]">{log.detail}</p> : null}
                {log.kind === 'adjust' && log.before && log.after ? (
                  <p className="mt-1 text-[10px] font-bold text-[#64748B]">
                    {pi(Number((log.before as { gross?: number }).gross ?? 0))} → <strong className="text-[#4C1FB8]">{pi(Number((log.after as { gross?: number }).gross ?? 0))}</strong>
                    {' · '}상태 {String((log.before as { status?: string }).status ?? '')} → {String((log.after as { status?: string }).status ?? '')}
                  </p>
                ) : null}
                {log.reason ? <p className="mt-1 text-[10px] font-bold text-[#B45309]">사유: {log.reason}</p> : null}
              </div>
            ))}
            {audit.length === 0 ? <p className="py-4 text-center text-xs font-bold text-[#94A3B8]">기록된 조정 이력이 없습니다.</p> : null}
          </div>
        ) : null}
      </section>
      ) : null}
      {notice ? <p className="text-center text-xs font-black text-[#047857]">{notice}</p> : null}
    </div>
  )
}
