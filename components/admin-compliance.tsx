'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/app-origin'
import { adminHeaders } from '@/lib/admin-key'
import { COMPLIANCE_DOC_LABEL, type ComplianceDocType } from '@/lib/partner-services'

type DocMeta = {
  name?: string
  uploadedAt?: string
  status: 'missing' | 'pending' | 'approved' | 'rejected'
  reviewedBy?: string
  reviewedAt?: string
  reviewNote?: string
}

type ComplianceRow = {
  uid: string
  username: string
  name: string
  phone: string
  serviceType: string
  serviceRoles: string[]
  locked: boolean
  required: ComplianceDocType[]
  docs: Partial<Record<ComplianceDocType, DocMeta>>
  overall: 'compliant' | 'pending' | 'rejected' | 'none'
  linkedAt: string
}

const OVERALL_LABEL: Record<ComplianceRow['overall'], { label: string; cls: string }> = {
  compliant: { label: '인증 완료', cls: 'bg-[#15803D] text-white' },
  pending: { label: '심사 대기', cls: 'bg-[#D97706] text-white' },
  rejected: { label: '반려됨', cls: 'bg-[#DC2626] text-white' },
  none: { label: '대상 아님', cls: 'bg-[#64748B] text-white' },
}

const DOC_STATUS_LABEL: Record<DocMeta['status'], string> = {
  missing: '미제출',
  pending: '심사 중',
  approved: '승인',
  rejected: '반려',
}

const DOC_STATUS_CLS: Record<DocMeta['status'], string> = {
  missing: 'bg-[#F1F5F9] text-[#64748B]',
  pending: 'bg-[#FEF3C7] text-[#B45309]',
  approved: 'bg-[#DCFCE7] text-[#15803D]',
  rejected: 'bg-[#FEE2E2] text-[#B91C1C]',
}

const FILTERS = [
  { id: 'pending', label: '심사 대기' },
  { id: 'rejected', label: '반려' },
  { id: 'compliant', label: '인증 완료' },
  { id: 'all', label: '전체' },
] as const

/** 자격 인증 관리 — 기사·파트너의 필수 증빙(운전면허증·화물운송종사자 자격증·차량 등록증)을 검토하고 승인·반려한다. */
export default function AdminCompliance() {
  const [rows, setRows] = useState<ComplianceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('pending')
  const [viewDoc, setViewDoc] = useState<{ uid: string; type: ComplianceDocType; name: string; mime: string; dataUrl: string } | null>(null)
  const [viewLoading, setViewLoading] = useState('')
  const [rejecting, setRejecting] = useState<{ uid: string; type: ComplianceDocType } | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [acting, setActing] = useState('')
  const [notice, setNotice] = useState('')

  const load = () => {
    setLoading(true)
    void apiFetch('/api/admin/compliance', { headers: adminHeaders(), cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { partners?: ComplianceRow[]; error?: string } | null
        if (!res.ok) throw new Error(data?.error || 'load failed')
        setRows(data?.partners ?? [])
        setError('')
      })
      .catch(() => setError('목록을 불러오지 못했어요. 관리자 로그인을 확인해 주세요.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const openDoc = (uid: string, type: ComplianceDocType) => {
    const key = `${uid}:${type}`
    setViewLoading(key)
    void apiFetch(`/api/partner/compliance-doc/?uid=${encodeURIComponent(uid)}&type=${type}`, {
      headers: adminHeaders(),
      cache: 'no-store',
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { doc?: { name: string; mime: string; dataUrl: string } | null } | null
        if (data?.doc) setViewDoc({ uid, type, ...data.doc })
        else setNotice('제출된 파일을 불러오지 못했어요.')
      })
      .finally(() => setViewLoading(''))
  }

  const decide = (uid: string, type: ComplianceDocType, action: 'approve' | 'reject') => {
    const note = action === 'reject' ? rejectNote.trim() : ''
    const key = `${uid}:${type}:${action}`
    setActing(key)
    void apiFetch('/api/admin/compliance', {
      method: 'POST',
      headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, type, action, note }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
        if (!res.ok || !data?.ok) throw new Error(data?.error || 'failed')
        setNotice(action === 'approve' ? `${COMPLIANCE_DOC_LABEL[type]} 승인 처리됐어요.` : `${COMPLIANCE_DOC_LABEL[type]} 반려 처리됐어요.`)
        setRejecting(null)
        setRejectNote('')
        load()
      })
      .catch((err) => setNotice(err instanceof Error ? err.message : '처리에 실패했어요.'))
      .finally(() => setActing(''))
  }

  const visible = rows.filter((row) => (filter === 'all' ? true : row.overall === filter))
  const pendingCount = rows.filter((row) => row.overall === 'pending').length

  return (
    <section className="mt-4 rounded-2xl border-2 border-[#BFDBFE] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-black text-[#0F172A]">자격 인증 관리</h2>
          <p className="mt-0.5 text-[11px] font-bold text-[#64748B]">
            운전면허증·화물운송종사자 자격증·차량 등록증을 검토합니다. 필수 서류가 모두 승인돼야 콜 매칭이 허용됩니다.
          </p>
        </div>
        <button type="button" onClick={load} className="rounded-full border-2 border-[#BFDBFE] bg-[#E8F1FA] px-3 py-1.5 text-[11px] font-black text-[#1D4ED8]">
          새로고침
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-black ${
              filter === item.id ? 'bg-[#4A82B8] text-white' : 'bg-[#F1F5F9] text-[#475569]'
            }`}
          >
            {item.label}
            {item.id === 'pending' && pendingCount ? ` ${pendingCount}` : ''}
          </button>
        ))}
      </div>
      {notice ? <p className="mt-3 rounded-xl bg-[#0F172A] px-3 py-2 text-center text-xs font-black text-white">{notice}</p> : null}
      {error ? <p className="mt-3 text-xs font-bold text-[#B91C1C]">{error}</p> : null}
      {loading ? (
        <p className="mt-4 text-xs font-bold text-[#64748B]">불러오는 중…</p>
      ) : visible.length === 0 ? (
        <p className="mt-4 text-xs font-bold text-[#64748B]">표시할 파트너가 없습니다.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {visible.map((row) => {
            const overall = OVERALL_LABEL[row.overall]
            return (
              <div key={row.uid} className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-[#0F172A]">
                      {row.name || row.username || row.uid}
                      <span className="ml-1.5 text-[11px] font-bold text-[#64748B]">
                        {row.serviceType}
                        {row.serviceRoles.length > 1 ? ` · 겸직 ${row.serviceRoles.filter((r) => r !== row.serviceType).join('+')}` : ''}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-[10px] font-bold text-[#64748B]">
                      {row.phone || '연락처 없음'} · uid {row.uid.slice(0, 12)}… · 등록 {row.linkedAt.slice(0, 10)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {row.locked ? <span className="rounded-full bg-[#0F172A] px-2 py-0.5 text-[10px] font-black text-white">정지</span> : null}
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${overall.cls}`}>{overall.label}</span>
                  </div>
                </div>
                <div className="mt-2.5 space-y-2">
                  {row.required.map((type) => {
                    const doc = row.docs[type] ?? { status: 'missing' as const }
                    const pendingReject = rejecting?.uid === row.uid && rejecting?.type === type
                    return (
                      <div key={type} className="rounded-xl bg-white px-3 py-2 ring-1 ring-[#E2E8F0]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[11px] font-black text-[#334155]">
                              {COMPLIANCE_DOC_LABEL[type]}
                              <span className={`ml-1.5 rounded-full px-2 py-0.5 text-[10px] font-black ${DOC_STATUS_CLS[doc.status]}`}>
                                {DOC_STATUS_LABEL[doc.status]}
                              </span>
                            </p>
                            <p className="mt-0.5 truncate text-[10px] font-bold text-[#64748B]">
                              {doc.name ? `${doc.name} · ${(doc.uploadedAt ?? '').slice(0, 10)}` : '제출된 파일 없음'}
                              {doc.reviewedBy ? ` · 심사 ${doc.reviewedBy} ${(doc.reviewedAt ?? '').slice(0, 10)}` : ''}
                            </p>
                            {doc.status === 'rejected' && doc.reviewNote ? (
                              <p className="mt-0.5 text-[10px] font-bold text-[#B91C1C]">반려 사유: {doc.reviewNote}</p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-1">
                            {doc.status !== 'missing' ? (
                              <button
                                type="button"
                                onClick={() => openDoc(row.uid, type)}
                                className="rounded-full bg-[#E8F1FA] px-2.5 py-1 text-[10px] font-black text-[#1D4ED8]"
                              >
                                {viewLoading === `${row.uid}:${type}` ? '불러오는 중…' : '서류 보기'}
                              </button>
                            ) : null}
                            {doc.status === 'pending' || doc.status === 'rejected' ? (
                              <>
                                <button
                                  type="button"
                                  disabled={Boolean(acting)}
                                  onClick={() => decide(row.uid, type, 'approve')}
                                  className="rounded-full bg-[#15803D] px-2.5 py-1 text-[10px] font-black text-white disabled:opacity-50"
                                >
                                  {acting === `${row.uid}:${type}:approve` ? '처리 중…' : '승인'}
                                </button>
                                {doc.status === 'pending' ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRejecting(pendingReject ? null : { uid: row.uid, type })
                                      setRejectNote('')
                                    }}
                                    className="rounded-full bg-[#DC2626] px-2.5 py-1 text-[10px] font-black text-white"
                                  >
                                    반려
                                  </button>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </div>
                        {pendingReject ? (
                          <div className="mt-2 flex items-center gap-1.5">
                            <input
                              value={rejectNote}
                              onChange={(event) => setRejectNote(event.target.value)}
                              placeholder="반려 사유 (이용자에게 표시됨)"
                              className="w-full rounded-xl border-2 border-[#FCA5A5] bg-[#FEF2F2] px-3 py-1.5 text-[11px] font-bold outline-none focus:border-[#DC2626]"
                            />
                            <button
                              type="button"
                              disabled={!rejectNote.trim() || Boolean(acting)}
                              onClick={() => decide(row.uid, type, 'reject')}
                              className="shrink-0 rounded-full bg-[#DC2626] px-3 py-1.5 text-[10px] font-black text-white disabled:opacity-50"
                            >
                              {acting === `${row.uid}:${type}:reject` ? '처리 중…' : '반려 확정'}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {viewDoc ? (
        <div className="fixed inset-0 z-[96] flex items-center justify-center bg-[#0F172A]/70 p-4" onClick={() => setViewDoc(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-black text-[#0F172A]">
                {COMPLIANCE_DOC_LABEL[viewDoc.type]} · {viewDoc.name}
              </p>
              <button type="button" onClick={() => setViewDoc(null)} className="rounded-full bg-[#F1F5F9] px-3 py-1 text-[11px] font-black text-[#334155]">
                닫기
              </button>
            </div>
            {viewDoc.mime === 'application/pdf' ? (
              <iframe src={viewDoc.dataUrl} title={viewDoc.name} className="mt-3 h-[70vh] w-full rounded-xl border border-[#E2E8F0]" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewDoc.dataUrl} alt={viewDoc.name} className="mt-3 w-full rounded-xl border border-[#E2E8F0] object-contain" />
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
