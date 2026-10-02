'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import { DEFAULT_RATES, type CommissionRates, type SettlementEntry, type SettlementService } from '@/lib/settlement-types'
import type { AuditEntry } from '@/lib/audit-store'

type ServiceSummary = { label: string; count: number; gross: number; commission: number; net: number }
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
  settle: '정산 처리',
  'settle-all': '일괄 정산',
  adjust: '수동 보정',
  reconcile: '내역 동기화',
}

const pi = (value: number) => `${value.toFixed(2)} Pi`

export default function AdminSettlements() {
  const [rates, setRates] = useState<CommissionRates>({ ...DEFAULT_RATES })
  const [rateDraft, setRateDraft] = useState<CommissionRates>({ ...DEFAULT_RATES })
  const [entries, setEntries] = useState<SettlementEntry[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [filter, setFilter] = useState<'all' | SettlementService>('all')
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [reconcileReason, setReconcileReason] = useState('')
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [showAudit, setShowAudit] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ gross: string; memo: string; driverId: string; driverName: string; status: 'pending' | 'settled'; reason: string } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const tell = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  const reload = useCallback(() => {
    void fetch('/api/admin/settlements', { headers: adminHeaders(), cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error || 'load_failed')
        return data as { rates: CommissionRates; entries: SettlementEntry[]; summary: Summary; audit?: AuditEntry[] }
      })
      .then((data) => {
        setRates(data.rates)
        setRateDraft(data.rates)
        setEntries(data.entries)
        setSummary(data.summary)
        setAudit(data.audit ?? [])
        setError('')
      })
      .catch(() => setError('정산 내역을 불러오지 못했습니다.'))
  }, [])

  useEffect(() => {
    reload()
    const timer = window.setInterval(reload, 10000)
    return () => window.clearInterval(timer)
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

  const saveRates = () => {
    if (busy) return
    setBusy(true)
    void patch({ action: 'rates', rates: rateDraft })
      .then(() => {
        setRates(rateDraft)
        tell('수수료율을 저장했습니다. 이후 정산부터 적용됩니다.')
        reload()
      })
      .catch(() => setError('수수료율 저장에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const settleEntry = (id: string) => {
    if (busy) return
    setBusy(true)
    void patch({ action: 'settle', id })
      .then(() => reload())
      .catch(() => setError('정산 처리에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const settleAll = () => {
    if (busy || !summary?.pendingCount) return
    setBusy(true)
    void patch({ action: 'settle-all' })
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
    void patch({ action: 'reconcile', reason: reconcileReason })
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

  const visible = filter === 'all' ? entries : entries.filter((entry) => entry.service === filter)
  const ratesDirty = SERVICES.some((service) => rateDraft[service] !== rates[service])

  return (
    <div className="mt-4 space-y-4">
      <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
        <p className="text-sm font-black">서비스별 플랫폼 수수료율</p>
        <p className="mt-0.5 text-xs font-bold text-[#64748B]">운행 완료(택배는 배정 수락) 시 결제액에서 자동 계산됩니다.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SERVICES.map((service) => (
            <label key={service} className="rounded-xl border-2 border-[#E2E8F0] p-2.5">
              <span className="text-[11px] font-black text-[#475569]">{SERVICE_LABEL[service]}</span>
              <div className="mt-1 flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={0.5}
                  value={rateDraft[service]}
                  onChange={(event) => setRateDraft((prev) => ({ ...prev, [service]: Number(event.target.value) }))}
                  className="w-full rounded-lg border border-[#CBD5E1] px-2 py-1.5 text-sm font-black outline-none focus:border-[#4C1FB8]"
                />
                <span className="text-sm font-black text-[#64748B]">%</span>
              </div>
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || !ratesDirty}
          onClick={saveRates}
          className="mt-3 w-full rounded-xl bg-[#4C1FB8] py-2.5 text-xs font-black text-white disabled:opacity-50"
        >
          수수료율 저장
        </button>
      </section>

      {summary ? (
        <section className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-3">
            <p className="text-[11px] font-black text-[#64748B]">총 결제액</p>
            <p className="mt-1 text-lg font-black">{pi(summary.gross)}</p>
            <p className="text-[10px] font-bold text-[#94A3B8]">{summary.count}건</p>
          </div>
          <div className="rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] p-3">
            <p className="text-[11px] font-black text-[#4C1FB8]">총 수수료 수익</p>
            <p className="mt-1 text-lg font-black text-[#4C1FB8]">{pi(summary.commission)}</p>
          </div>
          <div className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-3">
            <p className="text-[11px] font-black text-[#64748B]">기사 정산액(순지급)</p>
            <p className="mt-1 text-lg font-black">{pi(summary.net)}</p>
          </div>
          <div className="rounded-2xl border-2 border-[#FDE68A] bg-[#FFFBEB] p-3">
            <p className="text-[11px] font-black text-[#B45309]">정산 대기</p>
            <p className="mt-1 text-lg font-black text-[#B45309]">{summary.pendingCount}건</p>
            <p className="text-[10px] font-bold text-[#B45309]">{pi(summary.pendingNet)}</p>
          </div>
        </section>
      ) : null}

      {summary ? (
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

      <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black">정산 내역</p>
          <button
            type="button"
            disabled={syncing}
            onClick={reconcile}
            className="rounded-full border-2 border-[#4C1FB8] bg-white px-3 py-1.5 text-[11px] font-black text-[#4C1FB8] disabled:opacity-50"
          >
            {syncing ? '동기화 중…' : '내역 동기화·보정'}
          </button>
        </div>
        <p className="mt-1 text-[10px] font-bold text-[#94A3B8]">장부 기준으로 기사 모드 수익 내역을 강제로 일치시킵니다.</p>
        <input
          type="text"
          value={reconcileReason}
          onChange={(event) => setReconcileReason(event.target.value)}
          placeholder="동기화 사유 (선택)"
          className="mt-2 w-full rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-[11px] font-bold outline-none focus:border-[#4C1FB8]"
        />
        <div className="mt-2 flex flex-wrap justify-end gap-1">
            {(['all', ...SERVICES] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-black ${filter === key ? 'bg-[#4C1FB8] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
              >
                {key === 'all' ? '전체' : SERVICE_LABEL[key]}
              </button>
            ))}
          </div>
        {error ? <p className="mt-2 text-xs font-black text-[#DC2626]">{error}</p> : null}
        <div className="mt-3 space-y-2">
          {visible.map((entry) => (
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
      </section>

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
      {notice ? <p className="text-center text-xs font-black text-[#047857]">{notice}</p> : null}
    </div>
  )
}
