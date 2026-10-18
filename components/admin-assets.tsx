'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'

type Scope = 'testnet' | 'mainnet'

type ChainBalance = {
  ok: boolean
  wallet: string
  network: Scope
  balancePi: number | null
  accountExists: boolean
  horizon: string
  fetchedAt: string
  error?: string
}

type AssetRow = {
  id: string
  kind: 'escrow' | 'ev' | 'delivery' | 'fee'
  service: 'taxi' | 'daeri' | 'delivery' | 'ev'
  status: string
  statusKey: 'locked' | 'settled' | 'refunded' | 'pending' | 'cancelled' | 'active'
  refId: string
  label: string
  driverId: string | null
  driverName: string | null
  userId: string | null
  gross: number | null
  commission: number | null
  net: number | null
  refundPi: number | null
  depositPi: number | null
  lockTxid: string | null
  payoutTxid: string | null
  refundTxid: string | null
  adminWallet: string | null
  driverWallet: string | null
  at: string
}

type Snapshot = {
  ok: boolean
  servingNetwork: Scope
  scope: Scope
  scopeReadable: boolean
  crossScopeBlind: boolean
  wallet: { address: string; balance: ChainBalance | null }
  summary: {
    escrowLocked: { count: number; amount: number }
    feeDistributed: { count: number; commission: number; gross: number }
    driverNet: { count: number; net: number }
    pendingSettle: { count: number; net: number }
    refunded: { count: number; amount: number }
  }
  rows: AssetRow[]
  generatedAt: string
}

const KIND_META: Record<AssetRow['kind'], { label: string; cls: string }> = {
  escrow: { label: '에스크로', cls: 'bg-[#E8F1FA] text-[#4A82B8]' },
  ev: { label: 'EV충전', cls: 'bg-[#DCFCE7] text-[#15803D]' },
  delivery: { label: '택배', cls: 'bg-[#FEF3E2] text-[#D97706]' },
  fee: { label: '수수료 분배', cls: 'bg-[#F1F5F9] text-[#475569]' },
}
const SERVICE_LABEL: Record<AssetRow['service'], string> = { taxi: '택시', daeri: '대리운전', delivery: '택배', ev: 'EV충전' }
const STATUS_META: Record<AssetRow['statusKey'], { label: string; cls: string }> = {
  locked: { label: '예치 잠금', cls: 'bg-[#DBEAFE] text-[#1D4ED8]' },
  settled: { label: '정산 완료', cls: 'bg-[#DCFCE7] text-[#15803D]' },
  refunded: { label: '환불 완료', cls: 'bg-[#FEF3C7] text-[#92400E]' },
  pending: { label: '처리 대기', cls: 'bg-[#FEF3C7] text-[#92400E]' },
  cancelled: { label: '취소/만료', cls: 'bg-[#F1F5F9] text-[#64748B]' },
  active: { label: '진행 중', cls: 'bg-[#DBEAFE] text-[#1D4ED8]' },
}

const fmtPi = (value: number | null | undefined) => (value == null || !Number.isFinite(value) ? '—' : `${piFmt(value)} Pi`)
const piFmt = (value: number) => Math.round(value * 1_000_000) / 1_000_000
const short = (value: string | null | undefined) => (value ? `${value.slice(0, 10)}…${value.slice(-4)}` : '—')
const fmtAt = (iso: string) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : iso
}

export default function AdminAssets() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [scope, setScope] = useState<Scope | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | AssetRow['kind']>('all')
  const [serviceFilter, setServiceFilter] = useState<'all' | AssetRow['service']>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | AssetRow['statusKey']>('all')
  const [query, setQuery] = useState('')

  const load = useCallback(async (targetScope: Scope | null, silent: boolean) => {
    if (!silent) setRefreshing(true)
    try {
      const qs = targetScope ? `?scope=${targetScope}` : ''
      const res = await fetch(`/api/admin/assets${qs}`, { headers: adminHeaders(), cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as Snapshot | null
      if (!res.ok || !data?.ok) throw new Error('failed')
      setSnap(data)
      if (scope === null) setScope(data.scope)
      setError('')
    } catch {
      setError('자산 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])

  useEffect(() => {
    void load(scope, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchScope = (next: Scope) => {
    setScope(next)
    void load(next, false)
  }

  const act = useCallback(
    async (payload: Record<string, unknown>, confirmText: string) => {
      if (confirmText && !window.confirm(confirmText)) return
      const id = String(payload.id ?? payload.action ?? '')
      setBusyId(`${payload.action}:${id}`)
      setNotice('')
      try {
        const res = await fetch('/api/admin/assets', {
          method: 'PATCH',
          headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, scope }),
        })
        const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
        if (!res.ok || !data?.ok) throw new Error(data?.error || 'failed')
        setNotice('처리됐습니다. 장부에 보정 내역이 기록됩니다.')
        await load(scope, true)
      } catch {
        setNotice('처리에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      } finally {
        setBusyId('')
      }
    },
    [load, scope],
  )

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (snap?.rows ?? []).filter((row) => {
      if (kindFilter !== 'all' && row.kind !== kindFilter) return false
      if (serviceFilter !== 'all' && row.service !== serviceFilter) return false
      if (statusFilter !== 'all' && row.statusKey !== statusFilter) return false
      if (q) {
        const hay = [row.refId, row.label, row.driverName, row.driverId, row.userId, row.lockTxid, row.payoutTxid, row.refundTxid]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [snap, kindFilter, serviceFilter, statusFilter, query])

  const serving = snap?.servingNetwork
  const editingScope = scope && serving ? scope === serving : true
  const walletAddress = snap?.wallet?.address || ''
  const balance = snap?.wallet?.balance

  const copyWallet = async () => {
    if (!walletAddress) return
    try {
      await navigator.clipboard.writeText(walletAddress)
      setNotice('지갑 주소를 복사했습니다.')
    } catch {
      setNotice(walletAddress)
    }
  }

  const pendingFees = (snap?.rows ?? []).filter((row) => row.kind === 'fee' && row.statusKey === 'pending')

  return (
    <div className="mt-4 space-y-4">
      {/* 네트워크 환경 + 스코프 토글 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-black text-[#0F172A]">
            에스크로 · 자산 관리
            <span
              className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${
                serving === 'mainnet' ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#FEF3C7] text-[#92400E]'
              }`}
            >
              {serving === 'mainnet' ? '메인넷' : serving === 'testnet' ? '테스트넷' : '확인 중…'}
            </span>
          </h2>
          <p className="mt-0.5 text-[11px] font-bold text-[#94A3B8]">
            실제 서비스 네트워크는 배포 env로 고정됩니다. 토글은 모니터링 대상 장부 스코프만 전환합니다(반대 네트워크는 읽기 전용).
            {snap ? ` · 마지막 갱신 ${fmtAt(snap.generatedAt)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-full bg-[#F1F5F9] p-1">
            {(['testnet', 'mainnet'] as const).map((net) => (
              <button
                key={net}
                type="button"
                onClick={() => switchScope(net)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-black transition-colors ${
                  scope === net ? 'bg-[#4A82B8] text-white shadow-sm' : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                {net === 'mainnet' ? '메인넷' : '테스트넷'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load(scope, false)}
            disabled={refreshing}
            className="rounded-full bg-[#4A82B8] px-3 py-2 text-xs font-black text-white shadow-[0_6px_14px_rgba(74,130,184,0.28)] disabled:opacity-60"
          >
            {refreshing ? '갱신 중…' : '새로고침'}
          </button>
        </div>
      </div>

      {error ? <p className="rounded-2xl border-2 border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-xs font-bold text-[#B91C1C]">{error}</p> : null}
      {notice ? <p className="rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-xs font-bold text-[#1D4ED8]">{notice}</p> : null}
      {snap && !snap.scopeReadable ? (
        <p className="rounded-2xl border-2 border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-xs font-bold text-[#92400E]">
          {snap.crossScopeBlind
            ? '이 네트워크는 전용 KV로 물리 분리돼 있어 현재 배포에서 장부를 읽을 수 없습니다. 해당 네트워크 배포의 관리자 화면에서 확인하세요.'
            : 'KV 저장소가 연결되지 않아 이 스코프의 장부를 읽을 수 없습니다.'}
        </p>
      ) : null}

      {/* 에스크로 마스터 지갑 + 실시간 잔액 */}
      <section className="rounded-2xl border-2 border-[#0F172A] bg-[#0F172A] p-4 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black text-[#93C5FD]">에스크로 마스터 지갑 ({scope === 'mainnet' ? '메인넷' : '테스트넷'} 수수료 수신지)</p>
            <p className="mt-1 break-all font-mono text-xs font-bold text-white/90">{walletAddress || '등록된 지갑 주소가 없습니다'}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-black text-[#93C5FD]">온체인 잔액</p>
            <p className="mt-1 text-2xl font-black text-white">
              {balance?.ok ? `${piFmt(balance.balancePi ?? 0)} Pi` : balance ? '조회 실패' : '—'}
            </p>
            <p className="text-[10px] font-bold text-white/50">
              {balance?.ok ? (balance.accountExists ? '계정 활성' : '체인 계정 미생성(0 Pi)') : balance?.error === 'invalid-wallet' ? '주소 형식 오류' : 'Horizon 응답 없음'}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={copyWallet} className="rounded-lg bg-white/10 px-3 py-1.5 text-[11px] font-black text-white hover:bg-white/20">
            주소 복사
          </button>
          <button
            type="button"
            onClick={() => void load(scope, false)}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-[11px] font-black text-white hover:bg-white/20"
          >
            잔액 다시 조회
          </button>
        </div>
      </section>

      {/* 요약 카드 */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] p-3">
          <p className="text-[10px] font-black text-[#1D4ED8]">예치 잠금(에스크로·EV)</p>
          <p className="mt-1 text-lg font-black text-[#0F172A]">{fmtPi(snap?.summary.escrowLocked.amount)}</p>
          <p className="text-[10px] font-bold text-[#64748B]">{snap?.summary.escrowLocked.count ?? 0}건 진행 중</p>
        </div>
        <div className="rounded-2xl border-2 border-[#BBF7D0] bg-[#F0FDF4] p-3">
          <p className="text-[10px] font-black text-[#15803D]">수수료 자동 분배</p>
          <p className="mt-1 text-lg font-black text-[#0F172A]">{fmtPi(snap?.summary.feeDistributed.commission)}</p>
          <p className="text-[10px] font-bold text-[#64748B]">분배 완료 {snap?.summary.feeDistributed.count ?? 0}건</p>
        </div>
        <div className="rounded-2xl border-2 border-[#BBF7D0] bg-[#F0FDF4] p-3">
          <p className="text-[10px] font-black text-[#15803D]">기사 정산(net)</p>
          <p className="mt-1 text-lg font-black text-[#0F172A]">{fmtPi(snap?.summary.driverNet.net)}</p>
          <p className="text-[10px] font-bold text-[#64748B]">정산 완료 {snap?.summary.driverNet.count ?? 0}건</p>
        </div>
        <div className="rounded-2xl border-2 border-[#FDE68A] bg-[#FFFBEB] p-3">
          <p className="text-[10px] font-black text-[#92400E]">차액 환불</p>
          <p className="mt-1 text-lg font-black text-[#0F172A]">{fmtPi(snap?.summary.refunded.amount)}</p>
          <p className="text-[10px] font-bold text-[#64748B]">{snap?.summary.refunded.count ?? 0}건</p>
        </div>
        <div className="rounded-2xl border-2 border-[#FCA5A5] bg-[#FEF2F2] p-3">
          <p className="text-[10px] font-black text-[#B91C1C]">분배 대기</p>
          <p className="mt-1 text-lg font-black text-[#0F172A]">{fmtPi(snap?.summary.pendingSettle.net)}</p>
          <p className="text-[10px] font-bold text-[#64748B]">{snap?.summary.pendingSettle.count ?? 0}건 미처리</p>
        </div>
      </section>

      {/* 필터 + 일괄 액션 */}
      <section className="rounded-2xl border-2 border-[#E2E8F0] bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)} className="rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-xs font-bold">
            <option value="all">전체 종류</option>
            <option value="escrow">에스크로</option>
            <option value="ev">EV충전</option>
            <option value="delivery">택배</option>
            <option value="fee">수수료 분배</option>
          </select>
          <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value as typeof serviceFilter)} className="rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-xs font-bold">
            <option value="all">전체 서비스</option>
            <option value="taxi">택시</option>
            <option value="daeri">대리운전</option>
            <option value="delivery">택배</option>
            <option value="ev">EV충전</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-xs font-bold">
            <option value="all">전체 상태</option>
            <option value="locked">예치 잠금</option>
            <option value="settled">정산 완료</option>
            <option value="refunded">환불 완료</option>
            <option value="pending">처리 대기</option>
            <option value="active">진행 중</option>
            <option value="cancelled">취소/만료</option>
          </select>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="refId·기사·txid 검색"
            className="min-w-[180px] flex-1 rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-xs font-bold"
          />
          {pendingFees.length > 0 && editingScope ? (
            <button
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => void act({ action: 'settle-all', reason: '자산 관리 일괄 정산' }, `분배 대기 ${pendingFees.length}건을 모두 정산 완료로 처리할까요?`)}
              className="rounded-lg bg-[#15803D] px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-60"
            >
              분배 대기 {pendingFees.length}건 일괄 정산
            </button>
          ) : null}
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[11px]">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-[10px] font-black text-[#94A3B8]">
                <th className="px-2 py-2">시각</th>
                <th className="px-2 py-2">종류</th>
                <th className="px-2 py-2">서비스</th>
                <th className="px-2 py-2">내역</th>
                <th className="px-2 py-2">상태</th>
                <th className="px-2 py-2 text-right">금액</th>
                <th className="px-2 py-2 text-right">수수료</th>
                <th className="px-2 py-2 text-right">환불</th>
                <th className="px-2 py-2">txid</th>
                <th className="px-2 py-2">액션</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-2 py-8 text-center font-bold text-[#94A3B8]">
                    자산 내역을 불러오는 중…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-2 py-8 text-center font-bold text-[#94A3B8]">
                    표시할 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const txid = row.payoutTxid || row.refundTxid || row.lockTxid
                  const busy = busyId !== ''
                  return (
                    <tr key={`${row.kind}-${row.id}`} className="border-b border-[#F1F5F9] align-top">
                      <td className="whitespace-nowrap px-2 py-2 font-bold text-[#64748B]">{fmtAt(row.at)}</td>
                      <td className="px-2 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${KIND_META[row.kind].cls}`}>{KIND_META[row.kind].label}</span>
                      </td>
                      <td className="px-2 py-2 font-bold text-[#475569]">{SERVICE_LABEL[row.service]}</td>
                      <td className="max-w-[220px] px-2 py-2">
                        <p className="truncate font-bold text-[#0F172A]" title={row.label}>
                          {row.label || row.refId}
                        </p>
                        <p className="truncate text-[10px] font-bold text-[#94A3B8]">
                          {row.driverName || row.driverId ? `기사 ${row.driverName || row.driverId}` : ''}
                          {row.userId ? ` · 이용자 ${String(row.userId).slice(0, 10)}` : ''}
                        </p>
                      </td>
                      <td className="px-2 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${STATUS_META[row.statusKey].cls}`} title={row.status}>
                          {STATUS_META[row.statusKey].label}
                        </span>
                        <p className="mt-0.5 text-[9px] font-bold text-[#94A3B8]">{row.status}</p>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-black text-[#0F172A]">{fmtPi(row.gross ?? row.depositPi)}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-bold text-[#15803D]">{row.commission != null ? fmtPi(row.commission) : '—'}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-bold text-[#92400E]">{row.refundPi != null ? fmtPi(row.refundPi) : '—'}</td>
                      <td className="px-2 py-2 font-mono text-[10px] font-bold text-[#64748B]" title={txid || ''}>
                        {short(txid)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">
                        {!editingScope ? (
                          <span className="text-[10px] font-bold text-[#94A3B8]">읽기 전용</span>
                        ) : row.kind === 'fee' && row.statusKey === 'pending' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void act({ action: 'settle', id: row.id, reason: '자산 관리 수동 정산' }, `이 분배 건(${fmtPi(row.gross)})을 정산 완료로 처리할까요?`)}
                            className="rounded-lg bg-[#15803D] px-2 py-1 text-[10px] font-black text-white disabled:opacity-60"
                          >
                            정산 처리
                          </button>
                        ) : row.kind === 'escrow' && (row.statusKey === 'locked' || row.statusKey === 'pending') ? (
                          <div className="flex gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void act({ action: 'escrow-mark', id: row.id, status: 'released', reason: '에스크로 수동 정산 보정' }, `에스크로 ${fmtPi(row.depositPi)}를 '정산 완료'로 보정할까요? (장부 기록만 변경 — 실제 송금은 별도 확인)`)}
                              className="rounded-lg bg-[#15803D] px-2 py-1 text-[10px] font-black text-white disabled:opacity-60"
                            >
                              정산 보정
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void act({ action: 'escrow-mark', id: row.id, status: 'refunded', reason: '에스크로 수동 환불 보정' }, `에스크로 ${fmtPi(row.depositPi)}를 '환불 완료'로 보정할까요? (장부 기록만 변경 — 실제 환불 송금은 별도 확인)`)}
                              className="rounded-lg border border-[#F59E0B] bg-white px-2 py-1 text-[10px] font-black text-[#92400E] disabled:opacity-60"
                            >
                              환불 보정
                            </button>
                          </div>
                        ) : row.kind === 'ev' && row.statusKey === 'locked' ? (
                          <div className="flex gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void act({ action: 'ev-mark', id: row.id, status: 'settled', reason: 'EV 세션 수동 정산 보정' }, `EV 세션을 '정산 완료'로 보정할까요?`)}
                              className="rounded-lg bg-[#15803D] px-2 py-1 text-[10px] font-black text-white disabled:opacity-60"
                            >
                              정산 보정
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void act({ action: 'ev-mark', id: row.id, status: 'refunded', reason: 'EV 세션 수동 환불 보정' }, `EV 세션 예치금 ${fmtPi(row.depositPi)} 전액 환불로 보정할까요?`)}
                              className="rounded-lg border border-[#F59E0B] bg-white px-2 py-1 text-[10px] font-black text-[#92400E] disabled:opacity-60"
                            >
                              환불 보정
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] font-bold text-[#CBD5E1]">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] font-bold text-[#94A3B8]">
          최근 {rows.length}건 · 보정 액션은 장부 기록만 변경하며 실제 온체인 송금은 별도 검증이 필요합니다. 모든 보정은 업무 기록(감사 로그)에 남습니다.
        </p>
      </section>
    </div>
  )
}
