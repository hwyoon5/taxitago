'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import type { FdsAlert, FdsBlock, FdsSignal } from '@/lib/fds-store'

type FdsBlockRow = FdsBlock & { actorId: string }

type FdsState = {
  alerts: FdsAlert[]
  blocks: FdsBlockRow[]
  signals: FdsSignal[]
  stats: { signals24h: number; openAlerts: number; activeBlocks: number }
}

const KIND_LABEL: Record<string, string> = {
  'payment-fail': '반복 결제 실패',
  'escrow-small': '소액 다건 에스크로',
  'ride-flood': '반복 호출',
  'cancel-streak': '연속 취소',
  'match-churn': '허위 매칭·취소',
}

const fmtDate = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

const shortId = (id: string) => (id.length > 18 ? `${id.slice(0, 14)}…` : id)

/** FDS 부정 거래·이상 탐지 모니터링 — 경보·차단 내역 + 수동 해제/차단. */
export default function AdminFds() {
  const [state, setState] = useState<FdsState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  const [tab, setTab] = useState<'alerts' | 'blocks' | 'signals'>('alerts')
  const [manualId, setManualId] = useState('')
  const [manualReason, setManualReason] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/fds', { headers: adminHeaders(), cache: 'no-store' }).catch(() => null)
    const data = (await res?.json().catch(() => null)) as FdsState | null
    if (data?.alerts) setState(data)
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
      const res = await fetch('/api/admin/fds', {
        method: 'PATCH',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('처리에 실패했습니다.')
      say(done)
      await load()
    } catch (err) {
      say(err instanceof Error ? err.message : '처리에 실패했습니다.', true)
    } finally {
      setBusyId('')
    }
  }

  const alerts = state?.alerts ?? []
  const blocks = state?.blocks ?? []
  const signals = state?.signals ?? []
  const openAlerts = alerts.filter((alert) => !alert.resolvedAt)

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-[#0F172A]">부정 거래 · 이상 탐지 (FDS)</h2>
          <p className="mt-0.5 text-[11px] font-bold text-[#94A3B8]">
            반복 결제 실패 · 소액 다건 에스크로 · 허위 매칭/취소 패턴을 감지하고 자동 차단합니다.
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-full bg-[#4A82B8] px-3 py-2 text-xs font-black text-white shadow-[0_6px_14px_rgba(74,130,184,0.28)]">
          새로고침
        </button>
      </div>

      {error ? <p className="rounded-2xl border-2 border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-xs font-bold text-[#B91C1C]">{error}</p> : null}
      {notice ? <p className="rounded-2xl border-2 border-[#86EFAC] bg-[#F0FDF4] px-4 py-3 text-xs font-bold text-[#15803D]">{notice}</p> : null}

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: '미처리 경보', value: state?.stats.openAlerts ?? 0, cls: openAlerts.length ? 'text-[#B91C1C]' : 'text-[#0F172A]' },
          { label: '활성 차단', value: state?.stats.activeBlocks ?? 0, cls: blocks.length ? 'text-[#D97706]' : 'text-[#0F172A]' },
          { label: '24h 시그널', value: state?.stats.signals24h ?? 0, cls: 'text-[#4A82B8]' },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border-2 border-[#E2E8F0] bg-white px-3 py-3 text-center">
            <p className={`text-xl font-black ${card.cls}`}>{card.value}</p>
            <p className="mt-0.5 text-[10px] font-black text-[#64748B]">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1.5">
        {(
          [
            ['alerts', `경보 ${openAlerts.length ? `(${openAlerts.length})` : ''}`],
            ['blocks', `차단 ${blocks.length ? `(${blocks.length})` : ''}`],
            ['signals', '시그널'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-full px-3.5 py-2 text-xs font-black ${tab === key ? 'bg-[#4A82B8] text-white' : 'bg-[#F1F5F9] text-[#64748B]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'alerts' ? (
        <ul className="space-y-2">
          {loading ? (
            <li className="rounded-2xl bg-[#F1F5F9] px-4 py-6 text-center text-xs font-bold text-[#64748B]">불러오는 중…</li>
          ) : !alerts.length ? (
            <li className="rounded-2xl border-2 border-dashed border-[#CBD5E1] bg-white px-4 py-8 text-center text-xs font-bold text-[#94A3B8]">
              감지된 이상 징후가 없습니다.
            </li>
          ) : (
            alerts.map((alert) => (
              <li key={alert.id} className={`rounded-2xl border-2 bg-white p-3.5 ${alert.resolvedAt ? 'border-[#E2E8F0] opacity-60' : alert.severity === 'suspend' ? 'border-[#FCA5A5]' : 'border-[#FCD34D]'}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${alert.severity === 'suspend' ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#FEF3C7] text-[#92400E]'}`}>
                    {alert.severity === 'suspend' ? '자동 정지' : '감시'}
                  </span>
                  <span className="rounded-full bg-[#E8F1FA] px-2 py-0.5 text-[10px] font-black text-[#4A82B8]">{KIND_LABEL[alert.rule] ?? alert.rule}</span>
                  {alert.resolvedAt ? <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-black text-[#64748B]">처리 완료</span> : null}
                  <span className="ml-auto text-[10px] font-bold text-[#94A3B8]">{fmtDate(alert.at)}</span>
                </div>
                <p className="mt-1.5 text-xs font-black text-[#0F172A]">{alert.detail}</p>
                <p className="mt-0.5 text-[10px] font-bold text-[#64748B]">
                  대상 {alert.actorIds.map(shortId).join(', ')}
                  {alert.until ? ` · 정지 ${fmtDate(alert.until)}까지` : ''}
                  {alert.resolvedAt ? ` · 처리 ${alert.resolvedBy} ${fmtDate(alert.resolvedAt)}` : ''}
                </p>
                {!alert.resolvedAt ? (
                  <div className="mt-2 flex gap-1.5">
                    <button
                      type="button"
                      disabled={busyId === alert.id}
                      onClick={() => void act(alert.id, { action: 'resolve', alertId: alert.id }, '경보를 처리 완료했습니다.')}
                      className="rounded-xl bg-[#F1F5F9] px-3 py-1.5 text-[10px] font-black text-[#475569] disabled:opacity-50"
                    >
                      처리 완료
                    </button>
                    {alert.actorIds.map((id) =>
                      blocks.some((block) => block.actorId === id) ? (
                        <button
                          key={id}
                          type="button"
                          disabled={busyId === id}
                          onClick={() => void act(id, { action: 'release', actorId: id }, '차단을 해제했습니다.')}
                          className="rounded-xl bg-[#DCFCE7] px-3 py-1.5 text-[10px] font-black text-[#15803D] disabled:opacity-50"
                        >
                          차단 해제 · {shortId(id)}
                        </button>
                      ) : null,
                    )}
                  </div>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}

      {tab === 'blocks' ? (
        <ul className="space-y-2">
          {!blocks.length ? (
            <li className="rounded-2xl border-2 border-dashed border-[#CBD5E1] bg-white px-4 py-8 text-center text-xs font-bold text-[#94A3B8]">
              활성 차단이 없습니다.
            </li>
          ) : (
            blocks.map((block) => (
              <li key={block.actorId} className="rounded-2xl border-2 border-[#FCA5A5] bg-white p-3.5">
                <div className="flex items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${block.by === 'fds' ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#FEF3E2] text-[#D97706]'}`}>
                    {block.by === 'fds' ? 'FDS 자동' : '관리자 수동'}
                  </span>
                  <span className="text-[11px] font-black text-[#0F172A]">{block.actorId}</span>
                  <span className="ml-auto text-[10px] font-bold text-[#94A3B8]">{fmtDate(block.at)}</span>
                </div>
                <p className="mt-1 text-[11px] font-bold text-[#64748B]">
                  {block.reason} · {block.until ? `${fmtDate(block.until)}까지` : '영구'}
                </p>
                <button
                  type="button"
                  disabled={busyId === block.actorId}
                  onClick={() => void act(block.actorId, { action: 'release', actorId: block.actorId }, '차단을 해제했습니다.')}
                  className="mt-2 rounded-xl bg-[#DCFCE7] px-3 py-1.5 text-[10px] font-black text-[#15803D] disabled:opacity-50"
                >
                  차단 해제
                </button>
              </li>
            ))
          )}
          <li className="rounded-2xl border-2 border-[#E2E8F0] bg-white p-3.5">
            <p className="text-xs font-black text-[#334155]">수동 차단</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <input
                type="text"
                value={manualId}
                onChange={(event) => setManualId(event.target.value)}
                placeholder="계정 ID (uid·driverId)"
                className="min-w-0 flex-1 rounded-xl border-2 border-[#E2E8F0] px-3 py-2 text-xs font-bold outline-none focus:border-[#4A82B8]"
              />
              <input
                type="text"
                value={manualReason}
                onChange={(event) => setManualReason(event.target.value)}
                placeholder="차단 사유"
                className="min-w-0 flex-[2] rounded-xl border-2 border-[#E2E8F0] px-3 py-2 text-xs font-bold outline-none focus:border-[#4A82B8]"
              />
              <button
                type="button"
                disabled={!manualId.trim() || !manualReason.trim() || busyId === 'manual'}
                onClick={() =>
                  void act('manual', { action: 'block', actorId: manualId.trim(), reason: manualReason.trim() }, '계정을 차단했습니다.').then(() => {
                    setManualId('')
                    setManualReason('')
                  })
                }
                className="rounded-xl bg-[#DC2626] px-4 py-2 text-xs font-black text-white disabled:opacity-50"
              >
                차단
              </button>
            </div>
          </li>
        </ul>
      ) : null}

      {tab === 'signals' ? (
        <ul className="space-y-1.5">
          {!signals.length ? (
            <li className="rounded-2xl border-2 border-dashed border-[#CBD5E1] bg-white px-4 py-8 text-center text-xs font-bold text-[#94A3B8]">
              적재된 시그널이 없습니다.
            </li>
          ) : (
            signals.map((signal, index) => (
              <li key={`${signal.at}-${index}`} className="flex items-start gap-2 rounded-xl bg-[#F8FAFC] px-3 py-2">
                <span className="mt-0.5 shrink-0 rounded-full bg-[#E8F1FA] px-2 py-0.5 text-[9px] font-black text-[#4A82B8]">
                  {KIND_LABEL[signal.kind] ?? signal.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-black text-[#0F172A]">
                    {shortId(signal.actorId)}
                    {typeof signal.amount === 'number' ? ` · ${signal.amount.toFixed(2)} Pi` : ''}
                    {signal.detail ? ` · ${signal.detail}` : ''}
                  </p>
                  <p className="text-[9px] font-bold text-[#94A3B8]">
                    {fmtDate(signal.at)}
                    {signal.refId ? ` · ${shortId(signal.refId)}` : ''}
                    {signal.groupId ? ` · ${shortId(signal.groupId)}` : ''}
                  </p>
                </div>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
