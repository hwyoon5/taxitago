'use client'

import { useEffect, useState } from 'react'
import { Copy, Eye, EyeOff, KeyRound, Pencil, Trash2, UserPlus, X } from 'lucide-react'
import { adminHeaders } from '@/lib/admin-key'
import type { PublicStaff } from '@/lib/staff-store'
import { positionDisplayLabel, STAFF_POSITIONS } from '@/lib/staff-positions'
import { PaginationBar, PageSizeSelect } from '@/components/admin-pagination'
import { AdminDetailModal } from '@/components/admin-detail-modal'
import { AdminExportButton } from '@/components/admin-export-button'

const CUSTOM_POSITION = '__custom__'

/** position이 없는 기존 직원의 레거시 표시 — 권한 등급으로 폴백한다. */
const LEGACY_ROLE_LABEL: Record<string, string> = { master: '최고 관리자', manager: '매니저', staff: '직원' }
const positionLabel = (row: Pick<PublicStaff, 'role' | 'position'>) => positionDisplayLabel(row.position || LEGACY_ROLE_LABEL[row.role] || row.role)

const ERROR_MESSAGES: Record<string, string> = {
  invalid_login_id: '직원 ID는 영문·숫자·_.- 조합 3~32자여야 합니다.',
  invalid_name: '이름을 입력해 주세요.',
  password_too_short: '비밀번호는 8자 이상이어야 합니다.',
  duplicate_login_id: '이미 사용 중인 직원 ID입니다.',
  master_only: '직원 관리는 최고 관리자만 가능합니다.',
  privileged_only: '직원 등록 및 관리 권한이 없습니다 (최고책임자 및 팀장만 가능합니다).',
  not_found: '해당 직원을 찾을 수 없습니다.',
}

type EditState = { id: string; name: string; password: string; position: string; customPosition: string }

export default function AdminStaff() {
  const [staff, setStaff] = useState<PublicStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<EditState | null>(null)
  const [form, setForm] = useState({ loginId: '', name: '', password: '', position: '사원', customPosition: '' })
  const [showPw, setShowPw] = useState(false)
  const [showEditPw, setShowEditPw] = useState(false)
  const [tempPw, setTempPw] = useState<{ loginId: string; name: string; password: string } | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const [detail, setDetail] = useState<PublicStaff | null>(null)

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
      body: JSON.stringify({
        loginId: form.loginId,
        name: form.name,
        password: form.password,
        position: form.position === CUSTOM_POSITION ? form.customPosition : form.position,
      }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { staff?: PublicStaff; error?: string } | null
        if (!res.ok) throw new Error(data?.error || 'create_failed')
        setStaff((rows) => [...rows, data!.staff!])
        setForm({ loginId: '', name: '', password: '', position: '사원', customPosition: '' })
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
        position: editing.position === CUSTOM_POSITION ? editing.customPosition : editing.position,
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

  const resetPassword = (row: PublicStaff) => {
    if (busy) return
    const temp = `Tt${Array.from(crypto.getRandomValues(new Uint8Array(6))).map((byte) => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[byte % 55]).join('')}1!`
    setBusy(true)
    void fetch('/api/admin/staff', {
      method: 'PATCH',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, password: temp }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { staff?: PublicStaff; error?: string } | null
        if (!res.ok) throw new Error(data?.error || 'reset_failed')
        setTempPw({ loginId: row.loginId, name: row.name, password: temp })
      })
      .catch((err) => fail(err instanceof Error ? err.message : 'reset_failed', '비밀번호 초기화에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const remove = (row: PublicStaff) => {
    if (busy) return
    if (!window.confirm(`직원 계정 ${row.loginId}(${row.name})을 삭제할까요?\n\n해당 직원은 즉시 로그아웃되며 다시 로그인할 수 없습니다. 이 직원이 처리한 업무 로그(직원 ID 기록)는 삭제되지 않고 그대로 보존됩니다.`)) return
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
        <p className="text-sm font-black text-[#0F172A]">직원 등록 및 관리 권한이 없습니다.</p>
        <p className="mt-1 text-xs font-bold text-[#64748B]">최고책임자 및 팀장만 가능합니다.</p>
        <p className="mt-1 text-xs font-bold text-[#64748B]">마스터 계정으로 로그인하면 직원 계정을 등록·수정·삭제할 수 있습니다.</p>
      </section>
    )
  }

  const totalPages = Math.max(1, Math.ceil(staff.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const paged = staff.slice(safePage * pageSize, safePage * pageSize + pageSize)
  const pageButtons = (() => {
    const span = 2
    const start = Math.max(0, Math.min(safePage - span, totalPages - span * 2 - 1))
    const end = Math.min(totalPages, start + span * 2 + 1)
    return Array.from({ length: end - start }, (_, i) => start + i + 1)
  })()

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
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              placeholder="비밀번호 (8자 이상)"
              className="w-full rounded-xl border-2 border-[#CBD5E1] px-3 py-2.5 pr-10 text-sm font-bold outline-none focus:border-[#4C1FB8]"
            />
            <button
              type="button"
              onClick={() => setShowPw((prev) => !prev)}
              aria-label={showPw ? '비밀번호 숨기기' : '비밀번호 보기'}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#4C1FB8]"
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <select
            value={form.position}
            onChange={(event) => setForm((prev) => ({ ...prev, position: event.target.value }))}
            className="rounded-xl border-2 border-[#CBD5E1] px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4C1FB8]"
          >
            {STAFF_POSITIONS.map((position) => (
              <option key={position} value={position}>{positionDisplayLabel(position)}</option>
            ))}
            <option value={CUSTOM_POSITION}>직접 입력</option>
          </select>
          {form.position === CUSTOM_POSITION ? (
            <input
              value={form.customPosition}
              onChange={(event) => setForm((prev) => ({ ...prev, customPosition: event.target.value }))}
              placeholder="직급 직접 입력 (예: 주임연구원)"
              maxLength={20}
              className="col-span-2 rounded-xl border-2 border-[#CBD5E1] px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4C1FB8]"
            />
          ) : null}
        </div>
        <button
          type="button"
          disabled={busy || !form.loginId.trim() || !form.name.trim() || form.password.trim().length < 8 || (form.position === CUSTOM_POSITION && !form.customPosition.trim())}
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
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-black text-[#4C1FB8]">등록된 직원 · {staff.length}명</p>
          <span className="flex items-center gap-2">
            <AdminExportButton
              filename="taxitago-staff"
              headers={['이름', '직원 ID', '직급', '권한', '등록일', '수정일', 'ID']}
              rows={staff.map((row) => [
                row.name,
                row.loginId,
                positionLabel(row),
                row.role === 'manager' ? '매니저' : '직원',
                row.createdAt,
                row.updatedAt,
                row.id,
              ])}
            />
            <PageSizeSelect pageSize={pageSize} onChange={(size) => { setPageSize(size); setPage(0) }} />
          </span>
        </div>
        {loading ? <p className="mt-3 text-sm font-bold text-[#64748B]">불러오는 중…</p> : null}
        {!loading && !staff.length ? (
          <p className="mt-3 rounded-2xl border-2 border-dashed border-[#CBD5E1] p-5 text-center text-sm font-bold text-[#64748B]">
            등록된 직원이 없습니다.
          </p>
        ) : null}
        <div className="mt-3 space-y-2">
          {paged.map((row) =>
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
                    value={editing.position}
                    onChange={(event) => setEditing((prev) => (prev ? { ...prev, position: event.target.value } : prev))}
                    className="rounded-xl border-2 border-[#CBD5E1] bg-white px-3 py-2 text-sm font-bold outline-none focus:border-[#4C1FB8]"
                  >
                    {STAFF_POSITIONS.map((position) => (
                      <option key={position} value={position}>{positionDisplayLabel(position)}</option>
                    ))}
                    <option value={CUSTOM_POSITION}>직접 입력</option>
                  </select>
                  {editing.position === CUSTOM_POSITION ? (
                    <input
                      value={editing.customPosition}
                      onChange={(event) => setEditing((prev) => (prev ? { ...prev, customPosition: event.target.value } : prev))}
                      placeholder="직급 직접 입력"
                      maxLength={20}
                      className="col-span-2 rounded-xl border-2 border-[#CBD5E1] bg-white px-3 py-2 text-sm font-bold outline-none focus:border-[#4C1FB8]"
                    />
                  ) : null}
                  <div className="relative col-span-2">
                    <input
                      type={showEditPw ? 'text' : 'password'}
                      value={editing.password}
                      onChange={(event) => setEditing((prev) => (prev ? { ...prev, password: event.target.value } : prev))}
                      placeholder="새 비밀번호 (변경 시만 입력)"
                      className="w-full rounded-xl border-2 border-[#CBD5E1] bg-white px-3 py-2 pr-10 text-sm font-bold outline-none focus:border-[#4C1FB8]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEditPw((prev) => !prev)}
                      aria-label={showEditPw ? '비밀번호 숨기기' : '비밀번호 보기'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#4C1FB8]"
                    >
                      {showEditPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
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
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => setDetail(row)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setDetail(row) }}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-2xl border-2 border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5 transition hover:border-[#4A82B8]"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-black">
                    {row.name}
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${row.role === 'manager' ? 'bg-[#DBEAFE] text-[#1D4ED8]' : 'bg-[#F1F5F9] text-[#475569]'}`}>
                      {positionLabel(row)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-[#64748B]">
                    {row.loginId} · 등록 {new Date(row.createdAt).toLocaleDateString('ko-KR')}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      const known = row.position && (STAFF_POSITIONS as readonly string[]).includes(row.position)
                      setEditing({
                        id: row.id,
                        name: row.name,
                        password: '',
                        position: known ? row.position! : CUSTOM_POSITION,
                        customPosition: known ? '' : row.position || '',
                      })
                    }}
                    className="flex items-center gap-1 rounded-full border-2 border-[#D8CCF5] bg-white px-2.5 py-1.5 text-[10px] font-black text-[#4C1FB8]"
                  >
                    <Pencil size={11} /> 수정
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(event) => { event.stopPropagation(); resetPassword(row) }}
                    className="flex items-center gap-1 rounded-full border-2 border-[#FDE68A] bg-white px-2.5 py-1.5 text-[10px] font-black text-[#B45309] disabled:opacity-50"
                  >
                    <KeyRound size={11} /> 초기화
                  </button>
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); remove(row) }}
                    className="flex items-center gap-1 rounded-full border-2 border-[#FCA5A5] bg-white px-2.5 py-1.5 text-[10px] font-black text-[#DC2626]"
                  >
                    <Trash2 size={11} /> 삭제
                  </button>
                </div>
              </div>
            ),
          )}
          {staff.length > 0 ? (
            <PaginationBar
              total={staff.length}
              rangeStart={safePage * pageSize + 1}
              rangeEnd={Math.min(staff.length, (safePage + 1) * pageSize)}
              page={safePage + 1}
              totalPages={totalPages}
              pageButtons={pageButtons}
              onPage={(p) => setPage(p - 1)}
            />
          ) : null}
        </div>
      </div>

      {detail ? (
        <AdminDetailModal
          title="직원 계정 상세"
          eyebrow="STAFF DETAIL"
          hero={detail.name}
          heroNote={`${positionLabel(detail)} · ${detail.role === 'manager' ? '매니저' : '직원'}`}
          onClose={() => setDetail(null)}
          rows={[
            { label: '이름', value: detail.name },
            { label: '직원 ID (로그인용)', value: detail.loginId, copy: true },
            { label: '직급', value: positionLabel(detail) },
            { label: '권한', value: detail.role === 'manager' ? '매니저' : '직원' },
            { label: '등록일', value: new Date(detail.createdAt).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) },
            { label: '수정일', value: new Date(detail.updatedAt).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) },
            { label: '계정 ID', value: detail.id, copy: true },
          ]}
        />
      ) : null}

      {tempPw ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6">
          <div className="w-full max-w-sm rounded-[24px] bg-white p-5 shadow-2xl">
            <p className="flex items-center gap-1.5 text-sm font-black text-[#4C1FB8]">
              <KeyRound size={16} /> 임시 비밀번호 발급
            </p>
            <p className="mt-1 text-xs font-bold text-[#64748B]">
              {tempPw.name}({tempPw.loginId}) 직원의 비밀번호가 초기화되었습니다. 아래 임시 비밀번호를 직원에게 안전하게 전달해 주세요. 이 창을 닫으면 다시 확인할 수 없습니다.
            </p>
            <div className="mt-3 flex items-center gap-2 rounded-2xl bg-[#F8F5FF] px-3 py-2.5">
              <code className="flex-1 break-all text-sm font-black text-[#4C1FB8]">{tempPw.password}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(tempPw.password).then(() => tell('임시 비밀번호를 복사했습니다.'))
                }}
                className="flex shrink-0 items-center gap-1 rounded-lg border-2 border-[#D8CCF5] bg-white px-2 py-1.5 text-[10px] font-black text-[#4C1FB8]"
              >
                <Copy size={12} /> 복사
              </button>
            </div>
            <button
              type="button"
              onClick={() => setTempPw(null)}
              className="mt-3 w-full rounded-xl bg-[#4C1FB8] py-2.5 text-xs font-black text-white"
            >
              확인했습니다
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
