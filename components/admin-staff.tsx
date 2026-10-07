'use client'

import { useEffect, useState } from 'react'
import { Pencil, Trash2, UserPlus, X } from 'lucide-react'
import { adminHeaders } from '@/lib/admin-key'
import type { PublicStaff, StaffRole } from '@/lib/staff-store'

const ROLE_LABEL: Record<string, string> = { master: '최고 관리자', manager: '매니저', staff: '직원' }

const ERROR_MESSAGES: Record<string, string> = {
  invalid_login_id: '직원 ID는 영문·숫자·_.- 조합 3~32자여야 합니다.',
  invalid_name: '이름을 입력해 주세요.',
  password_too_short: '비밀번호는 8자 이상이어야 합니다.',
  duplicate_login_id: '이미 사용 중인 직원 ID입니다.',
  master_only: '직원 관리는 최고 관리자만 가능합니다.',
  not_found: '해당 직원을 찾을 수 없습니다.',
}

type EditState = { id: string; name: string; password: string; role: StaffRole }

export default function AdminStaff() {
  const [staff, setStaff] = useState<PublicStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<EditState | null>(null)
  const [form, setForm] = useState({ loginId: '', name: '', password: '', role: 'staff' as StaffRole })

  const tell = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  const fail = (code: string, fallback = '처리에 실패했습니다.') => {
    setError(ERROR_MESSAGES[code] || code || fallback)
    window.setTimeout(() => setError(''), 3000)
  }

  const load = () => {
    setLoading(true)
    void fetch('/api/admin/staff', { headers: adminHeaders(), cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { staff?: PublicStaff[]; error?: string } | null
        if (res.status === 403) {
          setDenied(true)
          setStaff([])
          return
        }
        if (!res.ok) throw new Error(data?.error || 'load_failed')
        setDenied(false)
        setStaff(data?.staff ?? [])
      })
      .catch(() => fail('load_failed', '직원 목록을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const create = () => {
    if (busy) return
    if (!form.loginId.trim() || !form.name.trim() || !form.password.trim()) return
    setBusy(true)
    void fetch('/api/admin/staff', {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { staff?: PublicStaff; error?: string } | null
        if (!res.ok) throw new Error(data?.error || 'create_failed')
        setStaff((rows) => [...rows, data!.staff!])
        setForm({ loginId: '', name: '', password: '', role: 'staff' })
        tell(`직원 계정 ${data!.staff!.loginId}을(를) 등록했습니다.`)
      })
      .catch((err) => fail(err instanceof Error ? err.message : 'create_failed'))
      .finally(() => setBusy(false))
  }

  const saveEdit = () => {
    if (!editing || busy) return
    setBusy(true)
    void fetch('/api/admin/staff', {
      method: 'PATCH',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editing.id,
        name: editing.name,
        role: editing.role,
        ...(editing.password.trim() ? { password: editing.password } : {}),
      }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { staff?: PublicStaff; error?: string } | null
        if (!res.ok) throw new Error(data?.error || 'update_failed')
        setStaff((rows) => rows.map((row) => (row.id === data!.staff!.id ? data!.staff! : row)))
        setEditing(null)
        tell('직원 정보를 수정했습니다. 해당 직원 세션은 갱신됩니다.')
      })
      .catch((err) => fail(err instanceof Error ? err.message : 'update_failed'))
      .finally(() => setBusy(false))
  }

  const remove = (row: PublicStaff) => {
    if (busy) return
    if (!window.confirm(`직원 계정 ${row.loginId}(${row.name})을 삭제할까요? 해당 직원은 즉시 로그아웃되며 다시 로그인할 수 없습니다.`)) return
    setBusy(true)
    void fetch('/api/admin/staff', {
      method: 'DELETE',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
        if (!res.ok) throw new Error(data?.error || 'delete_failed')
        setStaff((rows) => rows.filter((item) => item.id !== row.id))
        tell(`직원 계정 ${row.loginId}을(를) 삭제했습니다.`)
      })
      .catch((err) => fail(err instanceof Error ? err.message : 'delete_failed'))
      .finally(() => setBusy(false))
  }

  if (denied) {
    return (
      <section className="mt-4 rounded-[24px] border-2 border-[#CBD5E1] bg-white p-5 text-center">
        <p className="text-sm font-black text-[#0F172A]">직원 관리는 최고 관리자만 사용할 수 있습니다.</p>
        <p className="mt-1 text-xs font-bold text-[#64748B]">마스터 계정으로 로그인하면 직원 계정을 등록·수정·삭제할 수 있습니다.</p>
      </section>
    )
  }

  return (
    <section className="mt-4 space-y-3">
      {notice ? <p className="rounded-full bg-[#0F172A] px-3 py-2 text-center text-xs font-black text-white">{notice}</p> : null}
      {error ? <p className="rounded-2xl border-2 border-[#FCA5A5] bg-[#FEF2F2] px-4 py-2.5 text-xs font-black text-[#DC2626]">{error}</p> : null}

      <div className="rounded-[24px] border-2 border-[#CBD5E1] bg-white p-4">
        <p className="flex items-center gap-1.5 text-xs font-black text-[#4C1FB8]">
          <UserPlus size={14} /> 새 직원 계정
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <input
            value={form.loginId}
            onChange={(event) => setForm((prev) => ({ ...prev, loginId: event.target.value }))}
            placeholder="직원 ID (로그인용)"
            autoCapitalize="none"
            autoCorrect="off"
            className="rounded-xl border-2 border-[#CBD5E1] px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4C1FB8]"
          />
          <input
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="이름"
            className="rounded-xl border-2 border-[#CBD5E1] px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4C1FB8]"
          />
          <input
            type="password"
            value={form.password}
            onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            placeholder="비밀번호 (8자 이상)"
            className="rounded-xl border-2 border-[#CBD5E1] px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4C1FB8]"
          />
          <select
            value={form.role}
            onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as StaffRole }))}
            className="rounded-xl border-2 border-[#CBD5E1] px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4C1FB8]"
          >
            <option value="staff">직원</option>
            <option value="manager">매니저</option>
          </select>
        </div>
        <button
          type="button"
          disabled={busy || !form.loginId.trim() || !form.name.trim() || form.password.trim().length < 8}
          onClick={create}
          className="mt-3 w-full rounded-2xl bg-[#4C1FB8] py-2.5 text-sm font-black text-white disabled:opacity-50"
        >
          {busy ? '처리 중…' : '직원 등록'}
        </button>
        <p className="mt-2 text-[11px] font-bold leading-4 text-[#94A3B8]">
          등록된 직원은 관리자 로그인 화면의 '직원 로그인' 탭에서 ID+비밀번호로 로그인하며, 수행한 작업은 업무 처리 기록에 직원 ID로 남습니다.
        </p>
      </div>

      <div className="rounded-[24px] border-2 border-[#CBD5E1] bg-white p-4">
        <p className="text-xs font-black text-[#4C1FB8]">등록된 직원 · {staff.length}명</p>
        {loading ? <p className="mt-3 text-sm font-bold text-[#64748B]">불러오는 중…</p> : null}
        {!loading && !staff.length ? (
          <p className="mt-3 rounded-2xl border-2 border-dashed border-[#CBD5E1] p-5 text-center text-sm font-bold text-[#64748B]">
            등록된 직원이 없습니다.
          </p>
        ) : null}
        <div className="mt-3 space-y-2">
          {staff.map((row) =>
            editing?.id === row.id ? (
              <div key={row.id} className="rounded-2xl border-2 border-[#4C1FB8] bg-[#F8F5FF] p-3">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={editing.name}
                    onChange={(event) => setEditing((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                    placeholder="이름"
                    className="rounded-xl border-2 border-[#CBD5E1] bg-white px-3 py-2 text-sm font-bold outline-none focus:border-[#4C1FB8]"
                  />
                  <select
                    value={editing.role}
                    onChange={(event) => setEditing((prev) => (prev ? { ...prev, role: event.target.value as StaffRole } : prev))}
                    className="rounded-xl border-2 border-[#CBD5E1] bg-white px-3 py-2 text-sm font-bold outline-none focus:border-[#4C1FB8]"
                  >
                    <option value="staff">직원</option>
                    <option value="manager">매니저</option>
                  </select>
                  <input
                    type="password"
                    value={editing.password}
                    onChange={(event) => setEditing((prev) => (prev ? { ...prev, password: event.target.value } : prev))}
                    placeholder="새 비밀번호 (변경 시만 입력)"
                    className="col-span-2 rounded-xl border-2 border-[#CBD5E1] bg-white px-3 py-2 text-sm font-bold outline-none focus:border-[#4C1FB8]"
                  />
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={saveEdit}
                    className="flex-1 rounded-xl bg-[#4C1FB8] py-2 text-xs font-black text-white disabled:opacity-50"
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="flex items-center gap-1 rounded-xl border-2 border-[#CBD5E1] bg-white px-3 py-2 text-xs font-black text-[#64748B]"
                  >
                    <X size={13} /> 취소
                  </button>
                </div>
              </div>
            ) : (
              <div key={row.id} className="flex items-center justify-between gap-2 rounded-2xl border-2 border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-black">
                    {row.name}
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${row.role === 'manager' ? 'bg-[#DBEAFE] text-[#1D4ED8]' : 'bg-[#F1F5F9] text-[#475569]'}`}>
                      {ROLE_LABEL[row.role] || row.role}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-[#64748B]">
                    {row.loginId} · 등록 {new Date(row.createdAt).toLocaleDateString('ko-KR')}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditing({ id: row.id, name: row.name, password: '', role: row.role })}
                    className="flex items-center gap-1 rounded-full border-2 border-[#D8CCF5] bg-white px-2.5 py-1.5 text-[10px] font-black text-[#4C1FB8]"
                  >
                    <Pencil size={11} /> 수정
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(row)}
                    className="flex items-center gap-1 rounded-full border-2 border-[#FCA5A5] bg-white px-2.5 py-1.5 text-[10px] font-black text-[#DC2626]"
                  >
                    <Trash2 size={11} /> 삭제
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      </div>
    </section>
  )
}
