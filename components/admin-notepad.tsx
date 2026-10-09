'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'

type MemoDoc = { content: string; updatedAt: string; updatedBy?: string }
type Scope = 'shared' | 'mine'

const AUTOSAVE_MS = 30_000

export default function AdminNotepad() {
  const [scope, setScope] = useState<Scope>('shared')
  const [doc, setDoc] = useState<MemoDoc>({ content: '', updatedAt: '' })
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const dirtyRef = useRef(false)

  const tell = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2000)
  }

  const load = useCallback((nextScope: Scope) => {
    setLoading(true)
    void fetch(`/api/admin/memo?scope=${nextScope}`, { headers: adminHeaders(), cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error || 'load_failed')
        return data as { memo: MemoDoc }
      })
      .then((data) => {
        setDoc(data.memo)
        setDraft(data.memo.content)
        dirtyRef.current = false
        setError('')
      })
      .catch(() => setError('메모를 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [])

  const save = useCallback(
    (silent = false) => {
      if (saving) return Promise.resolve(false)
      setSaving(true)
      return fetch('/api/admin/memo', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({ scope, content: draft }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => null)
          if (!res.ok) throw new Error(data?.error || 'failed')
          setDoc((data as { memo: MemoDoc }).memo)
          dirtyRef.current = false
          if (!silent) tell('메모를 저장했습니다.')
          return true
        })
        .catch(() => {
          setError('메모 저장에 실패했습니다.')
          return false
        })
        .finally(() => setSaving(false))
    },
    [draft, saving, scope],
  )

  const switchScope = (next: Scope) => {
    if (next === scope) return
    // 저장되지 않은 초안이 있으면 먼저 저장한 뒤 전환한다.
    const go = dirtyRef.current ? save(true) : Promise.resolve(true)
    void go.then(() => {
      setScope(next)
      load(next)
    })
  }

  useEffect(() => {
    load('shared')
  }, [load])

  // 자동 저장 — 30초마다 변경분이 있으면 서버에 반영한다.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (dirtyRef.current) void save(true)
    }, AUTOSAVE_MS)
    return () => window.clearInterval(timer)
  }, [save])

  // 탭을 닫기 전 미저장 내용이 있으면 저장을 한 번 더 시도한다.
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current) void save(true)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [save])

  const dirty = draft !== doc.content

  return (
    <div className="mt-4 space-y-3">
      {error ? <p className="text-xs font-black text-[#DC2626]">{error}</p> : null}
      <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5 rounded-xl bg-[#F1F5F9] p-1">
            {(['shared', 'mine'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => switchScope(s)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-black ${scope === s ? 'bg-white text-[#4C1FB8] shadow-sm' : 'text-[#64748B]'}`}
              >
                {s === 'shared' ? '공용 메모판' : '내 메모'}
              </button>
            ))}
          </div>
          {doc.updatedAt ? (
            <p className="text-right text-[10px] font-bold leading-4 text-[#94A3B8]">
              마지막 저장 {new Date(doc.updatedAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {doc.updatedBy ? <><br />{doc.updatedBy}</> : null}
            </p>
          ) : null}
        </div>
        <p className="mt-2 text-[11px] font-bold text-[#64748B]">
          {scope === 'shared'
            ? '모든 관리자가 함께 보고 수정하는 공용 메모입니다. 인수인계·공지·정산 메모 등을 남겨 주세요.'
            : '로그인한 내 계정에만 보이는 개인 메모입니다.'}
        </p>
        <textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            dirtyRef.current = true
          }}
          placeholder={loading ? '불러오는 중…' : '여기에 메모를 입력하세요…'}
          spellCheck={false}
          disabled={loading}
          className="mt-3 h-72 w-full resize-y rounded-xl border-2 border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5 font-mono text-xs font-bold leading-5 text-[#0F172A] outline-none focus:border-[#4C1FB8] disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[10px] font-bold text-[#94A3B8]">
            {dirty ? '저장되지 않은 변경이 있습니다 · 30초마다 자동 저장' : '모든 변경이 저장되었습니다'}
          </p>
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={() => void save()}
            className="rounded-xl bg-[#4C1FB8] px-5 py-2 text-xs font-black text-white disabled:opacity-50"
          >
            {saving ? '저장 중…' : '메모 저장'}
          </button>
        </div>
      </section>
      {notice ? <p className="text-center text-xs font-black text-[#047857]">{notice}</p> : null}
    </div>
  )
}
