'use client'

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/app-origin'
import { adminHeaders } from '@/lib/admin-key'
import { PaginationBar, PageSizeSelect } from '@/components/admin-pagination'
import { AdminDetailModal } from '@/components/admin-detail-modal'
import { AdminExportButton } from '@/components/admin-export-button'
import type { PartnerLinkRecord } from '@/lib/partner-ledger-server'
import {
  ALL_PARTNER_SERVICE_TYPES,
  DRIVER_SERVICE_TYPES,
  PARTNER_FACILITY_TYPES,
  facilityUnitLabel,
  facilityUnitPlaceholder,
  vehicleRequiredFor,
} from '@/lib/partner-services'

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
  insuranceCompany: string
  insurancePolicyNo: string
  insuranceExpiresAt: string
  insuranceDocName: string
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
  insuranceCompany: '',
  insurancePolicyNo: '',
  insuranceExpiresAt: '',
  insuranceDocName: '',
}

const DOC_MAX_BYTES = 2.5 * 1024 * 1024

const SERVICE_TYPES: readonly string[] = ALL_PARTNER_SERVICE_TYPES

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' })
}

function insuranceExpired(value?: string) {
  if (!value) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
}

export default function AdminPartners() {
  const [partners, setPartners] = useState<PartnerLinkRecord[]>([])
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | '기사' | '파트너'>('all')
  const [serviceFilter, setServiceFilter] = useState<'all' | string>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [docFile, setDocFile] = useState<{ name: string; mime: string; dataUrl: string } | null>(null)
  const [detail, setDetail] = useState<PartnerLinkRecord | null>(null)
  const docInput = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    setPage(1)
  }, [query, roleFilter, serviceFilter, pageSize])

  const needle = query.replace(/[\s-]/g, '').toLowerCase()
  const filtered = partners.filter((row) => {
    if (roleFilter !== 'all' && (row.role === '파트너' ? '파트너' : '기사') !== roleFilter) return false
    if (serviceFilter !== 'all' && (row.serviceType || '택시') !== serviceFilter) return false
    if (!needle) return true
    const haystack = [row.name, row.phone, row.plate].map((v) => (v || '').replace(/[\s-]/g, '').toLowerCase())
    return haystack.some((v) => v.includes(needle))
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const pageButtons = (() => {
    const span = 2
    const start = Math.max(1, Math.min(currentPage - span, totalPages - span * 2))
    const end = Math.min(totalPages, start + span * 2)
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  })()

  const tell = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2200)
  }

  const onDocFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!(file.type.startsWith('image/') || file.type === 'application/pdf')) {
      setError('보험증권은 이미지 또는 PDF 파일만 첨부할 수 있습니다.')
      return
    }
    if (file.size > DOC_MAX_BYTES) {
      setError('파일이 너무 큽니다. 2.5MB 이하 파일을 올려 주세요.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setDocFile({ name: file.name, mime: file.type, dataUrl: reader.result })
        setError('')
      }
    }
    reader.readAsDataURL(file)
  }

  // 역할·서비스에 따른 필수 입력 — 사용자 가입 폼(home-screen.tsx)과 동일 규칙.
  const needsVehicle = form.role === '기사' && vehicleRequiredFor(form.serviceType)
  const canSubmit = Boolean(
    form.name.trim() &&
      form.phone.trim() &&
      (form.role === '파트너' ? form.vehicle.trim() : !needsVehicle || (form.vehicle.trim() && form.plate.trim())),
  )

  const submit = () => {
    if (busy || !canSubmit) return
    const insuranceTouched = Boolean(form.insuranceCompany.trim() || form.insurancePolicyNo.trim() || form.insuranceExpiresAt.trim())
    if (insuranceTouched && !(form.insuranceCompany.trim() && form.insurancePolicyNo.trim() && form.insuranceExpiresAt.trim())) {
      setError('보험 정보를 입력하려면 보험사·증권번호·유효기간을 모두 채워 주세요.')
      return
    }
    setBusy(true)
    setError('')
    // 대리운전 기사는 차량 정보를 저장하지 않는다 — 사용자 가입 레코드와 동일 형태.
    const payload = {
      ...form,
      vehicle: form.role === '파트너' || needsVehicle ? form.vehicle : '',
      plate: form.role === '파트너' ? form.plate : needsVehicle ? form.plate : '',
    }
    void apiFetch('/api/admin/partners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { partner?: PartnerLinkRecord; error?: string } | null
        if (!res.ok || !data?.partner) throw new Error(data?.error || '등록 실패')
        return data.partner
      })
      .then(async (partner) => {
        if (docFile) {
          const res = await apiFetch('/api/partner/insurance-doc/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...adminHeaders() },
            body: JSON.stringify({ uid: partner.uid, name: docFile.name, mime: docFile.mime, dataUrl: docFile.dataUrl }),
          })
          const data = (await res.json().catch(() => null)) as { error?: string } | null
          if (!res.ok) throw new Error(data?.error || '보험증권 업로드 실패')
        }
      })
      .then(() => {
        setForm(EMPTY_FORM)
        setDocFile(null)
        if (docInput.current) docInput.current.value = ''
        tell(form.uid ? '정보를 수정했습니다.' : '기사/파트너를 등록했습니다.')
        reload()
      })
      .catch((reason) => {
        const message = reason instanceof Error ? reason.message : ''
        setError(message === 'unauthorized' ? '관리자 인증이 필요합니다.' : message && message !== '등록 실패' ? message : '등록에 실패했습니다.')
      })
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
      insuranceCompany: row.insuranceCompany || '',
      insurancePolicyNo: row.insurancePolicyNo || '',
      insuranceExpiresAt: row.insuranceExpiresAt || '',
      insuranceDocName: row.insuranceDocName || '',
    })
    setDocFile(null)
    if (docInput.current) docInput.current.value = ''
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
            <select
              value={form.role}
              onChange={(e) =>
                setForm((f) => {
                  const role = e.target.value === '파트너' ? ('파트너' as const) : ('기사' as const)
                  const options: readonly string[] = role === '파트너' ? PARTNER_FACILITY_TYPES : DRIVER_SERVICE_TYPES
                  return { ...f, role, serviceType: options.includes(f.serviceType) ? f.serviceType : options[0] }
                })
              }
              className={input}
            >
              <option value="기사">기사</option>
              <option value="파트너">파트너</option>
            </select>
          </div>
          <div>
            <label className={label}>{form.role === '파트너' ? '등록 서비스(시설)' : '서비스'}</label>
            <select value={form.serviceType} onChange={(e) => setForm((f) => ({ ...f, serviceType: e.target.value }))} className={input}>
              {(form.role === '파트너' ? PARTNER_FACILITY_TYPES : DRIVER_SERVICE_TYPES).map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>{form.role === '파트너' ? '대표자 성함 *' : '이름 *'}</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="홍길동" className={input} />
          </div>
          <div>
            <label className={label}>전화번호 *</label>
            <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="010-0000-0000" className={input} />
          </div>
          <div>
            <label className={label}>{form.role === '파트너' ? '업체/가맹점명 *' : needsVehicle ? '차량명 *' : '차량명'}</label>
            <input
              value={form.role === '기사' && !needsVehicle ? '' : form.vehicle}
              onChange={(e) => setForm((f) => ({ ...f, vehicle: e.target.value }))}
              disabled={form.role === '기사' && !needsVehicle}
              placeholder={form.role === '파트너' ? '파이 모빌리티 강남점' : form.role === '기사' && !needsVehicle ? '대리운전은 차량 정보 입력 제외' : '현대 그랜저'}
              className={input}
            />
          </div>
          <div>
            <label className={label}>{form.role === '파트너' ? facilityUnitLabel(form.serviceType) : needsVehicle ? '차량번호 *' : '차량번호'}</label>
            <input
              value={form.role === '기사' && !needsVehicle ? '' : form.plate}
              onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value }))}
              disabled={form.role === '기사' && !needsVehicle}
              placeholder={form.role === '파트너' ? facilityUnitPlaceholder(form.serviceType) : form.role === '기사' && !needsVehicle ? '대리운전은 차량 정보 입력 제외' : '12가 3456'}
              className={input}
            />
          </div>
          {form.role === '기사' && !needsVehicle ? <p className="col-span-2 text-[10px] font-bold text-[#94A3B8]">* 대리운전은 차량 정보 입력 제외</p> : null}
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
          <div className="col-span-2 rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-black text-[#4C1FB8]">운행 안전·법적 책임 보험 (선택)</p>
              {form.uid && (form.insuranceCompany || form.insurancePolicyNo || form.insuranceExpiresAt) ? (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, insuranceCompany: '', insurancePolicyNo: '', insuranceExpiresAt: '' }))}
                  className="text-[10px] font-black text-[#94A3B8]"
                >
                  보험 정보 삭제
                </button>
              ) : null}
            </div>
            <p className="mt-0.5 text-[10px] font-bold text-[#94A3B8]">대리운전 기사·파트너의 보험 가입 상태를 기록합니다. 입력 시 세 항목을 모두 채워야 합니다.</p>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className={label}>보험사</label>
                <input value={form.insuranceCompany} onChange={(e) => setForm((f) => ({ ...f, insuranceCompany: e.target.value }))} placeholder="KB손해보험" className={input} />
              </div>
              <div>
                <label className={label}>보험 증권번호</label>
                <input value={form.insurancePolicyNo} onChange={(e) => setForm((f) => ({ ...f, insurancePolicyNo: e.target.value }))} placeholder="증권번호 입력" className={input} />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className={label}>보험 유효기간(만료일)</label>
                <input type="date" value={form.insuranceExpiresAt} onChange={(e) => setForm((f) => ({ ...f, insuranceExpiresAt: e.target.value }))} className={input} />
              </div>
            </div>
            <div className="mt-3">
              <label className={label}>보험증권 사본 (이미지·PDF, 최대 2.5MB)</label>
              <input ref={docInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={onDocFile} />
              <button
                type="button"
                onClick={() => docInput.current?.click()}
                className="w-full rounded-xl border-2 border-dashed border-[#D8CCF5] bg-white px-3 py-2.5 text-left text-xs font-bold text-[#64748B]"
              >
                {docFile ? (
                  <span className="text-[#4C1FB8]">첨부됨 · {docFile.name}</span>
                ) : form.uid && form.insuranceDocName ? (
                  <span>등록된 서류: {form.insuranceDocName} · 탭하여 교체</span>
                ) : (
                  '보험증권 파일 선택'
                )}
              </button>
            </div>
          </div>
        </div>
        <button
          type="button"
          disabled={busy || !canSubmit}
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
          <h2 className="text-sm font-black">등록된 기사/파트너 ({filtered.length}명{filtered.length !== partners.length ? ` / 전체 ${partners.length}` : ''})</h2>
          <span className="flex items-center gap-2">
            <AdminExportButton
              filename="taxitago-partners"
              headers={['구분', '서비스', '이름', '전화번호', '차량/업체', '번호', '지역', 'Pi 지갑', 'UID', 'Pi 계정', '보험사', '증권번호', '보험 만료일', '보험 서류', '비고', '등록일', '수정일']}
              rows={filtered.map((row) => [
                row.role === '파트너' ? '파트너' : '기사',
                row.serviceType || '택시',
                row.name || '',
                row.phone || '',
                row.vehicle || '',
                row.plate || '',
                row.region || '',
                row.wallet || '',
                row.uid,
                row.username,
                row.insuranceCompany || '',
                row.insurancePolicyNo || '',
                row.insuranceExpiresAt || '',
                row.insuranceDocName || '',
                row.detail || '',
                row.linkedAt,
                row.updatedAt,
              ])}
            />
            <button type="button" onClick={reload} className="text-xs font-black text-[#4C1FB8]">새로고침</button>
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_7rem_8rem]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 · 전화번호 · 차량번호 검색"
            className="col-span-2 w-full rounded-xl border-2 border-[#CBD5E1] px-3 py-2.5 text-sm font-bold outline-none focus:border-[#4C1FB8] sm:col-span-1"
          />
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)} className="w-full rounded-xl border-2 border-[#CBD5E1] px-2 py-2.5 text-xs font-black text-[#475569] outline-none focus:border-[#4C1FB8]">
            <option value="all">구분: 전체</option>
            <option value="기사">기사</option>
            <option value="파트너">파트너</option>
          </select>
          <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} className="w-full rounded-xl border-2 border-[#CBD5E1] px-2 py-2.5 text-xs font-black text-[#475569] outline-none focus:border-[#4C1FB8]">
            <option value="all">서비스: 전체</option>
            {SERVICE_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <PageSizeSelect
            pageSize={pageSize}
            onChange={setPageSize}
            className="w-full rounded-xl border-2 border-[#CBD5E1] px-2 py-2.5 text-xs font-black text-[#475569] outline-none focus:border-[#4C1FB8] sm:col-start-3"
          />
        </div>
        {loading ? (
          <p className="mt-4 text-center text-xs font-bold text-[#64748B]">불러오는 중…</p>
        ) : filtered.length === 0 ? (
          <p className="mt-4 rounded-xl border-2 border-dashed border-[#CBD5E1] p-4 text-center text-xs font-bold text-[#64748B]">
            {partners.length === 0 ? '등록된 기사/파트너가 없습니다.' : '검색 조건에 맞는 결과가 없습니다.'}
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
                  <th className="px-2 py-2">보험</th>
                  <th className="px-2 py-2">등록일</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => (
                  <tr key={row.uid} onClick={() => setDetail(row)} className="cursor-pointer border-b border-[#F1F5F9] transition hover:bg-[#F8FAFF]">
                    <td className="px-2 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${row.role === '파트너' ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-[#DBEAFE] text-[#1D4ED8]'}`}>
                        {row.role === '파트너' ? `${row.serviceType || ''} 파트너` : `${row.serviceType || '택시'} 기사`}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 font-black">{row.name || '-'}</td>
                    <td className="px-2 py-2.5 font-bold">{row.phone || '-'}</td>
                    <td className="px-2 py-2.5 font-bold">
                      {row.vehicle || '-'}
                      {row.plate ? <span className="block text-[10px] text-[#64748B]">{row.plate}</span> : null}
                    </td>
                    <td className="px-2 py-2.5 font-bold">{row.region || '-'}</td>
                    <td className="px-2 py-2.5 font-bold">
                      {row.insuranceCompany ? (
                        <>
                          {row.insuranceCompany}
                          <span className={`block text-[10px] ${insuranceExpired(row.insuranceExpiresAt) ? 'font-black text-[#DC2626]' : 'text-[#64748B]'}`}>
                            {row.insuranceExpiresAt
                              ? `${insuranceExpired(row.insuranceExpiresAt) ? '만료 ' : ''}~${formatDate(row.insuranceExpiresAt)}`
                              : '만료일 미입력'}
                          </span>
                          {row.insuranceDocName ? (
                            <a
                              href={`/api/partner/insurance-doc/?uid=${encodeURIComponent(row.uid)}`}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              className="block text-[10px] font-black text-[#4C1FB8] underline"
                            >
                              증권 보기
                            </a>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-[#94A3B8]">미등록</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 font-bold text-[#64748B]">{formatDate(row.linkedAt)}</td>
                    <td className="px-2 py-2.5">
                      <button type="button" onClick={(event) => { event.stopPropagation(); editRow(row) }} className="rounded-lg border border-[#D8CCF5] px-2 py-1 text-[10px] font-black text-[#4C1FB8]">
                        수정
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > 0 ? (
          <PaginationBar
            total={filtered.length}
            rangeStart={(currentPage - 1) * pageSize + 1}
            rangeEnd={Math.min(currentPage * pageSize, filtered.length)}
            page={currentPage}
            totalPages={totalPages}
            pageButtons={pageButtons}
            onPage={setPage}
          />
        ) : null}
      </section>

      {detail ? (
        <AdminDetailModal
          title={detail.role === '파트너' ? '파트너 상세 정보' : '기사 상세 정보'}
          eyebrow="PARTNER DETAIL"
          hero={detail.name || detail.username || detail.uid}
          heroNote={`${detail.role === '파트너' ? '파트너' : '기사'} · ${detail.serviceType || '택시'} · 등록 ${formatDate(detail.linkedAt)}`}
          onClose={() => setDetail(null)}
          rows={[
            { label: '구분', value: detail.role === '파트너' ? '파트너' : '기사' },
            { label: '등록 서비스', value: detail.serviceType || '택시' },
            { label: '이름', value: detail.name || '(없음)' },
            { label: '전화번호', value: detail.phone || '(없음)', copy: Boolean(detail.phone) },
            { label: 'Pi UID', value: detail.uid, copy: true },
            { label: 'Pi 계정', value: detail.username || '(없음)', copy: Boolean(detail.username) },
            { label: 'Pi 지갑 주소', value: detail.wallet || '(미연동)', copy: Boolean(detail.wallet) },
            { label: detail.role === '파트너' ? '업체/가맹점명' : '차량명', value: detail.vehicle || '(없음)' },
            { label: detail.role === '파트너' ? facilityUnitLabel(detail.serviceType || '주차') : '차량번호', value: detail.plate || '(없음)', copy: Boolean(detail.plate) },
            { label: '활동 지역', value: detail.region || '(없음)' },
            { label: '보험사', value: detail.insuranceCompany || '(미등록)' },
            { label: '보험 증권번호', value: detail.insurancePolicyNo || '(없음)', copy: Boolean(detail.insurancePolicyNo) },
            { label: '보험 유효기간', value: detail.insuranceExpiresAt ? `${insuranceExpired(detail.insuranceExpiresAt) ? '만료됨 · ' : ''}${formatDate(detail.insuranceExpiresAt)}` : '(없음)' },
            { label: '보험 서류', value: detail.insuranceDocName || '(없음)' },
            { label: '비고', value: detail.detail || '(없음)' },
            { label: '등록일', value: new Date(detail.linkedAt).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) },
            { label: '수정일', value: new Date(detail.updatedAt).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) },
          ]}
        />
      ) : null}
    </div>
  )
}
