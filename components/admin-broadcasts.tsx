'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import type { BroadcastEntry, BroadcastTarget } from '@/lib/broadcast-store'
import { BROADCAST_REGIONS, broadcastRegionLabel, type BroadcastRegion } from '@/lib/broadcast-regions'

const TARGET_META: Record<BroadcastTarget, { label: string; cls: string }> = {
  all: { label: '전체', cls: 'bg-[#E8F1FA] text-[#4A82B8]' },
  passenger: { label: '승객 전용', cls: 'bg-[#DCFCE7] text-[#15803D]' },
  driver: { label: '기사 전용', cls: 'bg-[#E6F7F4] text-[#0D9488]' },
  partner: { label: '파트너 전용', cls: 'bg-[#FEF3E2] text-[#D97706]' },
  staff: { label: '기사·파트너 전용', cls: 'bg-[#FEF3E2] text-[#D97706]' },
}

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

type FormState = { title: string; body: string; target: BroadcastTarget; region: BroadcastRegion; banner: boolean }
const emptyForm: FormState = { title: '', body: '', target: 'all', region: 'nation', banner: true }

/** 관리자 공지 방송 — 대상 그룹별 공지 등록·수정·삭제 + 앱 배너 노출 제어. */
export default function AdminBroadcasts() {
  const [entries, setEntries] = useState<BroadcastEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editing, setEditing] = useState<BroadcastEntry | null>(null)
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/broadcasts', { headers: adminHeaders(), cache: 'no-store' }).catch(() => null)
    const data = (await res?.json().catch(() => null)) as { broadcasts?: BroadcastEntry[] } | null
    if (data?.broadcasts) setEntries(data.broadcasts)
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

  const submit = async () => {
    if (!form.title.trim() || !form.body.trim()) {
      say('제목과 내용을 입력해 주세요.', true)
      return
    }
    setSending(true)
    try {
      const isEdit = Boolean(editing)
      const res = await fetch('/api/admin/broadcasts', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEdit
            ? { id: editing!.id, baseUpdatedAt: editing!.updatedAt, ...form }
            : form,
        ),
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => null)) as { broadcast?: BroadcastEntry; message?: string; error?: string } | null
      if (res.status === 409 && data?.broadcast) {
        const latest = data.broadcast
        setEntries((prev) => prev.map((entry) => (entry.id === latest.id ? latest : entry)))
        setEditing(null)
        setForm(emptyForm)
        say(data.message || '다른 사용자에 의해 내용이 변경되었습니다. 최신 정보를 불러온 후 다시 시도해 주세요.', true)
        return
      }
      if (!res.ok || !data?.broadcast) throw new Error(data?.error || '저장에 실패했습니다.')
      const saved = data.broadcast
      if (isEdit) {
        setEntries((prev) => prev.map((entry) => (entry.id === saved.id ? saved : entry)))
        say('공지를 수정했습니다.')
      } else {
        setEntries((prev) => [saved, ...prev])
        say('공지 방송을 등록했습니다. 대상 앱에 곧 반영됩니다.')
      }
      setEditing(null)
      setForm(emptyForm)
    } catch (err) {
      say(err instanceof Error ? err.message : '저장에 실패했습니다.', true)
    } finally {
      setSending(false)
    }
  }

  const remove = async (entry: BroadcastEntry) => {
    if (!window.confirm(`'${entry.title}' 공지를 삭제할까요?`)) return
    setBusyId(entry.id)
    try {
      const res = await fetch(`/api/admin/broadcasts?id=${encodeURIComponent(entry.id)}`, {
        method: 'DELETE',
        headers: adminHeaders(),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('삭제에 실패했습니다.')
      setEntries((prev) => prev.filter((item) => item.id !== entry.id))
      if (editing?.id === entry.id) {
        setEditing(null)
        setForm(emptyForm)
      }
      say('공지를 삭제했습니다.')
    } catch (err) {
      say(err instanceof Error ? err.message : '삭제에 실패했습니다.', true)
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-[#0F172A]">공지사항 · 방송 관리</h2>
          <p className="mt-0.5 text-[11px] font-bold text-[#94A3B8]">
            대상 그룹을 골라 공지를 등록하면 앱 배너·공지 목록에 실시간으로 반영됩니다.
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-full bg-[#4A82B8] px-3 py-2 text-xs font-black text-white shadow-[0_6px_14px_rgba(74,130,184,0.28)]">
          새로고침
        </button>
      </div>

      {error ? <p className="rounded-2xl border-2 border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-xs font-bold text-[#B91C1C]">{error}</p> : null}
      {notice ? <p className="rounded-2xl border-2 border-[#86EFAC] bg-[#F0FDF4] px-4 py-3 text-xs font-bold text-[#15803D]">{notice}</p> : null}

      <section className="rounded-2xl border-2 border-[#E2E8F0] bg-white p-4">
        <p className="text-xs font-black text-[#334155]">{editing ? `공지 수정 · ${editing.title}` : '새 공지 방송 등록'}</p>
        <div className="mt-3 space-y-2.5">
          <input
            type="text"
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            maxLength={80}
            placeholder="제목 (최대 80자)"
            className="w-full rounded-xl border-2 border-[#E2E8F0] px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4A82B8]"
          />
          <textarea
            value={form.body}
            onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
            maxLength={2000}
            rows={3}
            placeholder="공지 내용"
            className="w-full rounded-xl border-2 border-[#E2E8F0] px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4A82B8]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={form.target}
              onChange={(event) => setForm((prev) => ({ ...prev, target: event.target.value as BroadcastTarget }))}
              className="rounded-xl border-2 border-[#E2E8F0] bg-white px-3 py-2.5 text-xs font-black outline-none focus:border-[#4A82B8]"
            >
              <option value="all">전체 사용자</option>
              <option value="passenger">승객 전용</option>
              <option value="driver">기사 전용</option>
              <option value="partner">파트너 전용</option>
            </select>
            <select
              value={form.region}
              onChange={(event) => setForm((prev) => ({ ...prev, region: event.target.value as BroadcastRegion }))}
              className="rounded-xl border-2 border-[#E2E8F0] bg-white px-3 py-2.5 text-xs font-black outline-none focus:border-[#4A82B8]"
              aria-label="지역 선택"
            >
              {BROADCAST_REGIONS.map((region) => (
                <option key={region.key} value={region.key}>
                  {region.key === 'nation' ? `지역 · ${region.label}` : region.label}
                </option>
              ))}
            </select>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#F1F5F9] px-3 py-2.5 text-xs font-black text-[#475569]">
              <input
                type="checkbox"
                checked={form.banner}
                onChange={(event) => setForm((prev) => ({ ...prev, banner: event.target.checked }))}
                className="h-3.5 w-3.5"
              />
              앱 상단 배너 노출
            </label>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={sending}
              className="ml-auto rounded-xl bg-[#4A82B8] px-5 py-2.5 text-xs font-black text-white shadow-[0_6px_14px_rgba(74,130,184,0.28)] disabled:opacity-60"
            >
              {sending ? '저장 중…' : editing ? '수정 저장' : '방송 등록'}
            </button>
            {editing ? (
              <button
                type="button"
                onClick={() => {
                  setEditing(null)
                  setForm(emptyForm)
                }}
                className="rounded-xl bg-[#F1F5F9] px-4 py-2.5 text-xs font-black text-[#475569]"
              >
                취소
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <ul className="space-y-2">
        {loading ? (
          <li className="rounded-2xl bg-[#F1F5F9] px-4 py-6 text-center text-xs font-bold text-[#64748B]">공지 목록을 불러오는 중…</li>
        ) : !entries.length ? (
          <li className="rounded-2xl border-2 border-dashed border-[#CBD5E1] bg-white px-4 py-8 text-center text-xs font-bold text-[#94A3B8]">
            등록된 방송 공지가 없습니다. 위에서 첫 공지를 등록해 보세요.
          </li>
        ) : (
          entries.map((entry) => {
            const meta = TARGET_META[entry.target]
            return (
              <li key={entry.id} className="rounded-2xl border-2 border-[#E2E8F0] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${meta.cls}`}>{meta.label}</span>
                    {(entry.region ?? 'nation') !== 'nation' ? (
                      <span className="rounded-full bg-[#EDE9FE] px-2 py-0.5 text-[10px] font-black text-[#6D28D9]">{broadcastRegionLabel(entry.region)}</span>
                    ) : null}
                    {entry.banner ? <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[10px] font-black text-[#92400E]">배너 노출</span> : null}
                  </div>
                  <span className="text-[10px] font-bold text-[#94A3B8]">
                    {fmtDate(entry.createdAt)}{entry.updatedAt !== entry.createdAt ? ` (수정 ${fmtDate(entry.updatedAt)})` : ''} · {entry.createdByName || entry.createdBy}
                  </span>
                </div>
                <p className="mt-2 text-sm font-black text-[#0F172A]">{entry.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-xs font-bold leading-5 text-[#475569]">{entry.body}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(entry)
                      setForm({ title: entry.title, body: entry.body, target: entry.target, region: entry.region ?? 'nation', banner: entry.banner })
                    }}
                    className="rounded-xl border-2 border-[#BFDBFE] bg-white px-4 py-2 text-xs font-black text-[#4A82B8]"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    disabled={busyId === entry.id}
                    onClick={() => void remove(entry)}
                    className="rounded-xl bg-[#FEF2F2] px-4 py-2 text-xs font-black text-[#B91C1C] disabled:opacity-50"
                  >
                    {busyId === entry.id ? '삭제 중…' : '삭제'}
                  </button>
                </div>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
