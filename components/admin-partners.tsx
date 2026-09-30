'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/app-origin'
import { adminHeaders } from '@/lib/admin-key'
import type { PartnerLinkRecord } from '@/lib/partner-ledger-server'

type FormState = {
  uid: string
  role: '기사' | '파트너'
  serviceType: string
  name: string
  phone: string
  vehicle: string
  plate: string
  region: string
  wallet: string
  detail: string
}

const EMPTY_FORM: FormState = {
  uid: '',
  role: '기사',
  serviceType: '택시',
  name: '',
  phone: '',
  vehicle: '',
  plate: '',
  region: '',
  wallet: '',
  detail: '',
}

const SERVICE_TYPES = ['택시', '대리운전', '택배']

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function AdminPartners() {
  const [partners, setPartners] = useState<PartnerLinkRecord[]>([])
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const reload = () => {
    void apiFetch('/api/admin/partners', { cache: 'no-store', headers: adminHeaders() })
      .then(async (res) => {
        if (res.status === 401) throw new Error('unauthorized')
        const data = (await res.json()) as { partners?: PartnerLinkRecord[] }
        setPartners(data.partners ?? [])
      })
      .catch(() => setError('목록을 불러오지 못했어요.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    reload()
  }, [])

  const tell = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  const submit = () => {
    if (busy || !form.name.trim() || !form.phone.trim()) return
    setBusy(true)
    setError('')
    void apiFetch('/api/admin/partners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(form),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { partner?: PartnerLinkRecord; error?: string } | null
        if (!res.ok || !data?.partner) throw new Error(data?.error || '등록 실패')
        return data.partner
      })
      .then(() => {
        setForm(EMPTY_FORM)
        tell(form.uid ? '정보를 수정했습니다.' : '기사/파트너를 등록했습니다.')
        reload()
      })
      .catch((reason) => setError(reason instanceof Error && reason.message === 'unauthorized' ? '관리자 인증이 필요합니다.' : '등록에 실패했습니다.'))
      .finally(() => setBusy(false))
  }

  const editRow = (row: PartnerLinkRecord) => {
    setForm({
      uid: row.uid,
      role: row.role === '파트너' ? '파트너' : '기사',
      serviceType: row.serviceType || '택시',
      name: row.name || '',
      phone: row.phone || '',
      vehicle: row.vehicle || '',
      plate: row.plate || '',
      region: row.region || '',
      wallet: row.wallet || '',
      detail: row.detail || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const input = 'w-full rounded-xl border-2 border-[#CBD5E1] px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4C1FB8]'
  const label = 'mb-1 block text-[11px] font-black text-[#64748B]'

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border-2 border-[#E0D4FF] bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black">{form.uid ? '기사/파트너 정보 수정' : '기사/파트너 등록'}</h2>
          {form.uid ? (
            <button type="button" onClick={() => setForm(EMPTY_FORM)} className="text-xs font-black text-[#64748B]">
              새로 등록
            </button>
          ) : null}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className={label}>구분</label>
            <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value === '파트너' ? '파트너' : '기사' }))} className={input}>
              <option value="기사">기사</option>
              <option value="파트너">파트너</option>
            </select>
          </div>
          <div>
            <label className={label}>서비스</label>
            <select value={form.serviceType} onChange={(e) => setForm((f) => ({ ...f, serviceType: e.target.value }))} className={input}>
              {SERVICE_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>이름 *</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="홍길동" className={input} />
          </div>
          <div>
            <label className={label}>전화번호 *</label>
            <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="010-0000-0000" className={input} />
          </div>
          <div>
            <label className={label}>차량명</label>
            <input value={form.vehicle} onChange={(e) => setForm((f) => ({ ...f, vehicle: e.target.value }))} placeholder="현대 그랜저" className={input} />
          </div>
          <div>
            <label className={label}>차량번호</label>
            <input value={form.plate} onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value }))} placeholder="12가 3456" className={input} />
          </div>
          <div>
            <label className={label}>활동 지역</label>
            <input value={form.region} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))} placeholder="부산 해운대구" className={input} />
          </div>
          <div>
            <label className={label}>Pi 지갑 주소 (선택)</label>
            <input value={form.wallet} onChange={(e) => setForm((f) => ({ ...f, wallet: e.target.value }))} placeholder="나중에 기사가 연동 가능" className={input} />
          </div>
          <div className="col-span-2">
            <label className={label}>비고</label>
            <input value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} placeholder="자격증, 계약 정보 등" className={input} />
          </div>
        </div>
        <button
          type="button"
          disabled={busy || !form.name.trim() || !form.phone.trim()}
          onClick={submit}
          className="mt-3 w-full rounded-2xl bg-[#4C1FB8] py-3 text-sm font-black text-white disabled:opacity-50"
        >
          {busy ? '저장 중…' : form.uid ? '수정 저장' : '등록하기'}
        </button>
        {error ? <p className="mt-2 text-center text-xs font-black text-[#DC2626]">{error}</p> : null}
        {notice ? <p className="mt-2 text-center text-xs font-black text-[#047857]">{notice}</p> : null}
      </section>

      <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black">등록된 기사/파트너 ({partners.length}명)</h2>
          <button type="button" onClick={reload} className="text-xs font-black text-[#4C1FB8]">새로고침</button>
        </div>
        {loading ? (
          <p className="mt-4 text-center text-xs font-bold text-[#64748B]">불러오는 중…</p>
        ) : partners.length === 0 ? (
          <p className="mt-4 rounded-xl border-2 border-dashed border-[#CBD5E1] p-4 text-center text-xs font-bold text-[#64748B]">
            등록된 기사/파트너가 없습니다.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="border-b-2 border-[#E2E8F0] text-[10px] font-black text-[#64748B]">
                  <th className="px-2 py-2">구분</th>
                  <th className="px-2 py-2">이름</th>
                  <th className="px-2 py-2">전화번호</th>
                  <th className="px-2 py-2">차량</th>
                  <th className="px-2 py-2">지역</th>
                  <th className="px-2 py-2">등록일</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {partners.map((row) => (
                  <tr key={row.uid} className="border-b border-[#F1F5F9]">
                    <td className="px-2 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${row.role === '파트너' ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#DBEAFE] text-[#1D4ED8]'}`}>
                        {row.role === '파트너' ? '파트너' : `${row.serviceType || '택시'} 기사`}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 font-black">{row.name || '-'}</td>
                    <td className="px-2 py-2.5 font-bold">{row.phone || '-'}</td>
                    <td className="px-2 py-2.5 font-bold">
                      {row.vehicle || '-'}
                      {row.plate ? <span className="block text-[10px] text-[#64748B]">{row.plate}</span> : null}
                    </td>
                    <td className="px-2 py-2.5 font-bold">{row.region || '-'}</td>
                    <td className="px-2 py-2.5 font-bold text-[#64748B]">{formatDate(row.linkedAt)}</td>
                    <td className="px-2 py-2.5">
                      <button type="button" onClick={() => editRow(row)} className="rounded-lg border border-[#D8CCF5] px-2 py-1 text-[10px] font-black text-[#4C1FB8]">
                        수정
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
