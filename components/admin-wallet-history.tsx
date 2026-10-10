'use client'

import { useEffect, useMemo, useState } from 'react'
import type { WalletTxEntry, WalletTxKind } from '@/lib/wallet-history'

type Props = {
  entries: WalletTxEntry[]
  totals?: { deposit: { count: number; total: number }; withdraw: { count: number; total: number; fee: number }; reward?: { count: number; total: number } } | null
}

const KIND_LABEL: Record<WalletTxKind, string> = { deposit: '입금', withdraw: '출금', reward: '보상' }
const STATUS_LABEL: Record<WalletTxEntry['status'], string> = { confirmed: '완료', pending: '대기', failed: '실패' }
const STATUS_TONE: Record<WalletTxEntry['status'], string> = {
  confirmed: 'bg-[#DCFCE7] text-[#15803D]',
  pending: 'bg-[#FEF3C7] text-[#B45309]',
  failed: 'bg-[#FEE2E2] text-[#DC2626]',
}
const KIND_TONE: Record<WalletTxKind, string> = {
  deposit: 'bg-[#DBEAFE] text-[#1D4ED8]',
  withdraw: 'bg-[#FFEDD5] text-[#C2410C]',
  reward: 'bg-[#F3E8FF] text-[#7E22CE]',
}

const explorerTxUrl = (entry: WalletTxEntry) => {
  if (!entry.txid || entry.txid.startsWith('review:')) return ''
  const base = entry.network === 'mainnet' ? 'https://api.mainnet.minepi.com' : 'https://api.testnet.minepi.com'
  return `${base}/transactions/${entry.txid}`
}

const short = (value: string) => (value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value || '-')
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const pi = (value: number) => `${value.toFixed(7)} Pi`

const PAGE_SIZES = [10, 20, 30, 50]

export default function AdminWalletHistory({ entries, totals }: Props) {
  const [kind, setKind] = useState<'all' | WalletTxKind>('all')
  const [status, setStatus] = useState<'all' | WalletTxEntry['status']>('all')
  const [sort, setSort] = useState<'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'>('date-desc')
  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)

  // 필터·정렬·페이지 크기가 바뀌면 첫 페이지로 되돌린다.
  useEffect(() => {
    setPage(1)
  }, [kind, status, sort, query, pageSize])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = entries.filter((entry) =>
      (kind === 'all' || entry.kind === kind) &&
      (status === 'all' || entry.status === status) &&
      (!q || entry.txid.toLowerCase().includes(q) || entry.fromWallet.toLowerCase().includes(q) || entry.toWallet.toLowerCase().includes(q) || entry.memo.toLowerCase().includes(q)),
    )
    return filtered.sort((a, b) => {
      if (sort === 'amount-desc') return b.amount - a.amount
      if (sort === 'amount-asc') return a.amount - b.amount
      return sort === 'date-asc' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)
    })
  }, [entries, kind, status, sort, query])

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const paged = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const rangeStart = visible.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const rangeEnd = Math.min(visible.length, currentPage * pageSize)
  // 현재 페이지 중심으로 최대 5개 번호 버튼을 노출한다.
  const pageButtons = useMemo(() => {
    const span = 2
    const start = Math.max(1, Math.min(currentPage - span, totalPages - span * 2))
    const end = Math.min(totalPages, start + span * 2)
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  }, [currentPage, totalPages])

  return (
    <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-black">입·출금 내역 히스토리</p>
        <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[10px] font-black text-[#475569]">{visible.length}건</span>
      </div>
      {totals ? (
        <p className="mt-1 text-[10px] font-bold text-[#94A3B8]">
          누적 입금 <strong className="text-[#1D4ED8]">{pi(totals.deposit.total)}</strong> ({totals.deposit.count}건) ·
          누적 출금 <strong className="text-[#C2410C]">{pi(totals.withdraw.total + totals.withdraw.fee)}</strong> ({totals.withdraw.count}건 · 수수료 {pi(totals.withdraw.fee)} 포함)
          {totals.reward ? <> · 리뷰 보상 <strong className="text-[#7E22CE]">{pi(totals.reward.total)}</strong> ({totals.reward.count}건)</> : null}
        </p>
      ) : (
        <p className="mt-1 text-[10px] font-bold text-[#94A3B8]">수동 입금 기록과 관리자 지갑 출금 트랜잭션이 함께 기록됩니다.</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <div className="flex gap-1">
          {([['all', '전체'], ['deposit', '입금'], ['withdraw', '출금'], ['reward', '보상']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setKind(key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-black ${kind === key ? 'bg-[#0F172A] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {([['all', '전체 상태'], ['confirmed', '완료'], ['failed', '실패'], ['pending', '대기']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatus(key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-black ${status === key ? 'bg-[#4C1FB8] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={pageSize}
          onChange={(event) => setPageSize(Number(event.target.value))}
          className="ml-auto rounded-lg border border-[#CBD5E1] bg-white px-2 py-1 text-[11px] font-black text-[#334155] outline-none"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>{size}개씩 보기</option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
          className="rounded-lg border border-[#CBD5E1] bg-white px-2 py-1 text-[11px] font-black text-[#334155] outline-none"
        >
          <option value="date-desc">최신순</option>
          <option value="date-asc">오래된순</option>
          <option value="amount-desc">금액 큰순</option>
          <option value="amount-asc">금액 작은순</option>
        </select>
      </div>
      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="txid · 지갑 주소 · 메모 검색"
        className="mt-2 w-full rounded-lg border border-[#E2E8F0] px-2.5 py-1.5 text-[11px] font-bold outline-none focus:border-[#4C1FB8]"
      />

      <div className="mt-3 space-y-2">
        {paged.length === 0 ? (
          <p className="rounded-xl bg-[#F8FAFC] px-3 py-4 text-center text-[11px] font-bold text-[#94A3B8]">표시할 내역이 없습니다.</p>
        ) : (
          paged.map((entry) => {
            const url = explorerTxUrl(entry)
            return (
              <div key={entry.id} className="rounded-xl border-2 border-[#E2E8F0] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${KIND_TONE[entry.kind]}`}>{KIND_LABEL[entry.kind]}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${STATUS_TONE[entry.status]}`}>{STATUS_LABEL[entry.status]}</span>
                  </div>
                  <span className="text-[10px] font-bold text-[#94A3B8]">{fmtDate(entry.createdAt)}</span>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className={`text-sm font-black ${entry.kind === 'deposit' ? 'text-[#1D4ED8]' : 'text-[#C2410C]'}`}>
                    {entry.kind === 'deposit' ? '+' : '-'}{pi(entry.amount)}
                    {entry.fee > 0 ? <span className="ml-1 text-[10px] font-bold text-[#94A3B8]">+ 수수료 {pi(entry.fee)}</span> : null}
                  </p>
                  <span className="rounded-full bg-[#F1F5F9] px-2 py-0.5 text-[9px] font-black text-[#64748B]">
                    {entry.network === 'mainnet' ? '메인넷' : '테스트넷'}
                  </span>
                </div>
                <p className="mt-1 break-all text-[10px] font-bold leading-4 text-[#64748B]">
                  {short(entry.fromWallet)} → {short(entry.toWallet)}
                  {entry.memo ? <span className="text-[#94A3B8]"> · {entry.memo}</span> : null}
                </p>
                {entry.error ? <p className="mt-1 text-[10px] font-black text-[#DC2626]">실패 사유: {entry.error}</p> : null}
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-black text-[#4C1FB8] underline underline-offset-2"
                  >
                    txid {short(entry.txid)} · 블록 탐색기에서 보기
                  </a>
                ) : (
                  <p className="mt-1.5 text-[10px] font-bold text-[#94A3B8]">전송 전 실패 — txid 없음</p>
                )}
              </div>
            )
          })
        )}
      </div>

      {visible.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#E2E8F0] pt-3">
          <p className="text-[10px] font-bold text-[#94A3B8]">
            전체 {visible.length}건 중 {rangeStart}-{rangeEnd}번
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              className="rounded-lg border border-[#CBD5E1] px-2.5 py-1 text-[11px] font-black text-[#475569] disabled:opacity-40"
            >
              이전
            </button>
            {pageButtons.map((number) => (
              <button
                key={number}
                type="button"
                onClick={() => setPage(number)}
                className={`min-w-7 rounded-lg px-2 py-1 text-[11px] font-black ${number === currentPage ? 'bg-[#0F172A] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
              >
                {number}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              className="rounded-lg border border-[#CBD5E1] px-2.5 py-1 text-[11px] font-black text-[#475569] disabled:opacity-40"
            >
              다음
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
