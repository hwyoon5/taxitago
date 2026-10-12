'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAdminAuth } from '@/components/admin-guard'
import { adminHeaders } from '@/lib/admin-key'
import { SHIFT_TAGS, type ShiftEntry, type ShiftTag } from '@/lib/shift-board-store'

const POLL_MS = 20_000

const TAG_STYLE: Record<ShiftTag, string> = {
  특이사항: 'bg-[#FEF3C7] text-[#B45309]',
  처리대기: 'bg-[#DBEAFE] text-[#1D4ED8]',
  공지: 'bg-[#DCFCE7] text-[#15803D]',
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * 근무 교대 인수인계 보드 — 다음 근무자에게 전달할 특이사항·처리 대기 건·
 * 공지를 남기는 공용 게시판. append-only라 버전 충돌이 없고 본인 글만 삭제된다.
 */
export default function AdminShiftBoard() {
  const { actor } = useAdminAuth()
  const [entries, setEntries] = useState<ShiftEntry[]>([])
  const [tag, setTag] = useState<ShiftTag>('특이사항')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const tell = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  const load = useCallback(() => {
    void fetch('/api/admin/shift-board', { headers: adminHeaders(), cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { entries?: ShiftEntry[] } | null) => {
        if (data) setEntries(data.entries ?? [])
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, POLL_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const submit = () => {
    const value = text.trim()
    if (busy || !value) return
    setBusy(true)
    setError('')
    void fetch('/api/admin/shift-board', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ tag, text: value }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { entry?: ShiftEntry; error?: string } | null
        if (!res.ok || !data?.entry) throw new Error(data?.error || 'failed')
        setEntries((rows) => [data.entry!, ...rows.filter((row) => row.id !== data.entry!.id)])
        setText('')
        tell('인수인계 메모를 등록했습니다.')
      })
      .catch((err) => setError(err instanceof Error && err.message !== 'failed' ? err.message : '등록에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const remove = (entry: ShiftEntry) => {
    if (busy) return
    setBusy(true)
    void fetch('/api/admin/shift-board', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ id: entry.id }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(data?.error || 'failed')
        }
        setEntries((rows) => rows.filter((row) => row.id !== entry.id))
      })
      .catch((err) => setError(err instanceof Error && err.message !== 'failed' ? err.message : '삭제에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const pendingCount = entries.filter((entry) => entry.tag === '처리대기').length

  return (
    <div className="mt-4 space-y-3">
      {error ? <p className="text-xs font-black text-[#DC2626]">{error}</p> : null}
      <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-black">근무 교대 인수인계</p>
          {pendingCount ? (
            <span className="rounded-full bg-[#DBEAFE] px-2 py-0.5 text-[10px] font-black text-[#1D4ED8]">
              처리 대기 {pendingCount}건
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs font-bold text-[#64748B]">
          다음 근무자에게 전달할 특이사항·처리 대기 중인 문의·공지를 남겨 주세요. 모든 관리자가 함께 봅니다.
        </p>
        <div className="mt-3 flex gap-1.5">
          {SHIFT_TAGS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTag(value)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-black ${
                tag === value ? 'bg-[#4C1FB8] text-white' : 'bg-[#F1F5F9] text-[#64748B]'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="예: 오후 3시 정산 지연 문의 2건 확인 중 — 김철수 기사님께 회신 필요"
          className="mt-2 w-full rounded-2xl border-2 border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4C1FB8]"
        />
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={submit}
          className="mt-2 w-full rounded-xl bg-[#4C1FB8] py-2.5 text-xs font-black text-white disabled:opacity-50"
        >
          {busy ? '등록 중…' : '인수인계 메모 등록'}
        </button>
      </section>

      <section className="space-y-2">
        {!entries.length ? (
          <p className="rounded-2xl border-2 border-dashed border-[#CBD5E1] bg-white px-4 py-8 text-center text-xs font-bold text-[#94A3B8]">
            아직 남겨진 인수인계 메모가 없습니다.
          </p>
        ) : null}
        {entries.map((entry) => (
          <div key={entry.id} className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${TAG_STYLE[entry.tag]}`}>{entry.tag}</span>
              <span className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-[#94A3B8]">{fmtTime(entry.createdAt)}</span>
                {entry.staffId === actor?.staffId ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(entry)}
                    className="text-[10px] font-black text-[#DC2626] disabled:opacity-50"
                  >
                    삭제
                  </button>
                ) : null}
              </span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-sm font-bold leading-5 text-[#0F172A]">{entry.text}</p>
            <p className="mt-1.5 text-[10px] font-black text-[#64748B]">
              {entry.staffName}
              {entry.position ? ` · ${entry.position}` : ''}
              {entry.staffId === actor?.staffId ? ' (나)' : ''}
            </p>
          </div>
        ))}
      </section>
      {notice ? <p className="text-center text-xs font-black text-[#047857]">{notice}</p> : null}
    </div>
  )
}
