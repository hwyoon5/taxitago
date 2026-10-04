'use client'

import { useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { formatKoreanPhone, isValidKoreanPhone } from '@/lib/phone'
import { partnerVehicle, updatePartnerProfile, uploadInsuranceDoc, type PartnerProfile } from '@/lib/partner-account'

const DOC_MAX_BYTES = 2.5 * 1024 * 1024

/**
 * 최초 기사/파트너 등록 후 프로필·차량 정보를 수정하는 바텀시트.
 * 저장 시 로컬 프로필 → 파트너 연동 DB → 배차용 기사 레코드 순으로 반영된다.
 */
export default function PartnerProfileEditModal({
  profile,
  onClose,
  onSaved,
  onDone,
}: {
  profile: PartnerProfile
  onClose: () => void
  onSaved?: (profile: PartnerProfile) => void
  onDone: (message: string) => void
}) {
  const isDriver = profile.role === '기사'
  const needsVehicle = isDriver && profile.serviceType !== '대리운전'
  const initialFleet = partnerVehicle(profile)
  const [name, setName] = useState(profile.name)
  const [phone, setPhone] = useState(profile.phone)
  const [vehicleName, setVehicleName] = useState(isDriver ? initialFleet.vehicle : profile.detail)
  const [plateNumber, setPlateNumber] = useState(initialFleet.plate)
  const [region, setRegion] = useState(profile.region)
  const [insuranceCompany, setInsuranceCompany] = useState(profile.insuranceCompany ?? '')
  const [insurancePolicyNo, setInsurancePolicyNo] = useState(profile.insurancePolicyNo ?? '')
  const [insuranceExpiresAt, setInsuranceExpiresAt] = useState(profile.insuranceExpiresAt ?? '')
  const [docFile, setDocFile] = useState<{ name: string; mime: string; dataUrl: string } | null>(null)
  const docInput = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const phoneOk = isValidKoreanPhone(phone)
  const canSubmit =
    Boolean(name.trim()) &&
    phoneOk &&
    (isDriver ? !needsVehicle || Boolean(vehicleName.trim() && plateNumber.trim()) : Boolean(vehicleName.trim()))

  const onDocFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!(file.type.startsWith('image/') || file.type === 'application/pdf')) {
      setError('보험증권은 이미지 또는 PDF 파일만 첨부할 수 있어요.')
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

  const submit = async () => {
    if (!canSubmit || saving) return
    const insuranceTouched = Boolean(insuranceCompany.trim() || insurancePolicyNo.trim() || insuranceExpiresAt.trim())
    if (insuranceTouched && !(insuranceCompany.trim() && insurancePolicyNo.trim() && insuranceExpiresAt.trim())) {
      setError('보험 정보를 입력하려면 보험사·증권번호·유효기간을 모두 채워 주세요.')
      return
    }
    setSaving(true)
    setError('')
    let docNotice = ''
    let docMeta: { insuranceDocName?: string; insuranceDocAt?: string } = {}
    try {
      if (docFile) {
        try {
          const saved = await uploadInsuranceDoc(profile.uid, docFile)
          docMeta = { insuranceDocName: saved.name, insuranceDocAt: saved.uploadedAt }
        } catch {
          docNotice = ' (보험증권 업로드는 실패했어요. 다시 시도해 주세요.)'
        }
      }
      const detail = isDriver
        ? needsVehicle
          ? `${vehicleName.trim()} · ${plateNumber.trim()}`
          : profile.detail
        : vehicleName.trim()
      const next = await updatePartnerProfile({
        name: name.trim(),
        phone: phone.trim(),
        region: region.trim() || profile.region,
        detail,
        vehicle: needsVehicle ? vehicleName.trim() : '',
        plate: needsVehicle ? plateNumber.trim() : '',
        insuranceCompany: insuranceCompany.trim(),
        insurancePolicyNo: insurancePolicyNo.trim(),
        insuranceExpiresAt: insuranceExpiresAt.trim(),
        ...docMeta,
      })
      if (!next) {
        setError('저장할 프로필을 찾지 못했어요. 다시 로그인한 뒤 시도해 주세요.')
        return
      }
      onSaved?.(next)
      setSubmitted(true)
      window.setTimeout(() => {
        onDone(`정보가 수정되었어요.${docNotice || ' 배차·매칭 화면에도 새 차량 정보가 반영됩니다.'}`)
        onClose()
      }, 1200)
    } catch {
      setError('저장에 실패했어요. 네트워크를 확인한 뒤 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[94] flex items-end bg-[#1e1033]/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-white p-5 shadow-2xl sm:rounded-[32px]" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
        {submitted ? (
          <div className="py-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#4A82B8] text-white">
              <Check className="h-8 w-8" strokeWidth={3} />
            </div>
            <h2 className="mt-4 text-2xl font-black text-[#0F172A]">수정 완료</h2>
            <p className="mt-2 text-sm font-bold text-[#475569]">변경된 정보가 대시보드와 이용자 매칭 화면에 반영됩니다.</p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-black text-[#4A82B8]">PROFILE EDIT</p>
                <h2 className="mt-1 text-2xl font-black text-[#0F172A]">파트너 정보 수정</h2>
                <p className="mt-1 text-sm font-bold text-[#64748B]">차량명·차량번호·연락처를 수정하면 배차 화면에 바로 반영됩니다.</p>
              </div>
              <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="닫기">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] p-4">
              <p className="text-[11px] font-black text-[#4A82B8]">{profile.role}{profile.serviceType ? ` · ${profile.serviceType}` : ''} 계정</p>
              <p className="mt-1 text-sm font-black text-[#0F172A]">@{profile.username}</p>
              <p className="mt-1 break-all text-[11px] font-bold leading-5 text-[#334155]">UID {profile.uid}</p>
            </div>
            <label className="mt-4 block">
              <span className="text-xs font-black text-[#334155]">{isDriver ? '기사 성함' : '대표자 성함'}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="홍길동" className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8]" />
            </label>
            <label className="mt-3 block">
              <span className="text-xs font-black text-[#334155]">연락처</span>
              <input
                value={phone}
                onChange={(event) => setPhone(formatKoreanPhone(event.target.value))}
                inputMode="tel"
                placeholder="010-0000-0000"
                className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8]"
              />
            </label>
            {phone.trim() && !phoneOk ? <p className="mt-1.5 text-[11px] font-bold text-[#B91C1C]">연락처 형식을 확인해 주세요.</p> : null}
            {isDriver ? (
              needsVehicle ? (
                <div className="mt-3 grid grid-cols-1 gap-3">
                  <label className="block">
                    <span className="text-xs font-black text-[#334155]">차량명</span>
                    <input value={vehicleName} onChange={(event) => setVehicleName(event.target.value)} placeholder="현대 아슬란" className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8]" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-black text-[#334155]">차량번호</span>
                    <input value={plateNumber} onChange={(event) => setPlateNumber(event.target.value)} placeholder="서울 31바 1842" className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8]" />
                  </label>
                </div>
              ) : (
                <p className="mt-3 text-[11px] font-bold text-[#8b8495]">* 대리운전 기사는 차량 정보 없이 활동합니다.</p>
              )
            ) : (
              <label className="mt-3 block">
                <span className="text-xs font-black text-[#334155]">업체/가맹점명</span>
                <input value={vehicleName} onChange={(event) => setVehicleName(event.target.value)} placeholder="파이 모빌리티 강남점" className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8]" />
              </label>
            )}
            <label className="mt-3 block">
              <span className="text-xs font-black text-[#334155]">활동 지역</span>
              <input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="서울" className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8]" />
            </label>
            <div className="mt-4 rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4">
              <p className="text-xs font-black text-[#334155]">운행 안전·법적 책임 보험 (선택)</p>
              <p className="mt-1 text-[11px] font-bold text-[#8b8495]">입력 시 보험사·증권번호·유효기간을 모두 채워 주세요.</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-black text-[#334155]">보험사</span>
                  <input value={insuranceCompany} onChange={(event) => setInsuranceCompany(event.target.value)} placeholder="KB손해보험" className="mt-1.5 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-2.5 text-sm font-bold outline-none focus:border-[#4A82B8]" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-black text-[#334155]">보험 증권번호</span>
                  <input value={insurancePolicyNo} onChange={(event) => setInsurancePolicyNo(event.target.value)} placeholder="증권번호 입력" className="mt-1.5 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-2.5 text-sm font-bold outline-none focus:border-[#4A82B8]" />
                </label>
              </div>
              <label className="mt-3 block">
                <span className="text-[11px] font-black text-[#334155]">보험 유효기간(만료일)</span>
                <input type="date" value={insuranceExpiresAt} onChange={(event) => setInsuranceExpiresAt(event.target.value)} className="mt-1.5 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-2.5 text-sm font-bold outline-none focus:border-[#4A82B8]" />
              </label>
              <div className="mt-3">
                <span className="text-[11px] font-black text-[#334155]">보험증권 사본 (이미지·PDF, 최대 2.5MB)</span>
                <input ref={docInput} type="file" accept="image/*,application/pdf" className="hidden" onChange={onDocFile} />
                <button
                  type="button"
                  onClick={() => docInput.current?.click()}
                  className="mt-1.5 w-full rounded-2xl border-2 border-dashed border-[#4A82B8] bg-[#E8F1FA] px-4 py-3 text-left text-xs font-bold text-[#64748B]"
                >
                  {docFile ? (
                    <span className="text-[#4A82B8]">첨부됨 · {docFile.name}</span>
                  ) : profile.insuranceDocName ? (
                    <span>등록된 서류: {profile.insuranceDocName} · 탭하여 교체</span>
                  ) : (
                    '보험증권 파일 선택'
                  )}
                </button>
              </div>
            </div>
            {error ? <p className="mt-3 text-sm font-bold text-[#B91C1C]">{error}</p> : null}
            <button type="button" onClick={() => void submit()} disabled={!canSubmit || saving} className="mt-5 w-full rounded-2xl bg-[#4A82B8] py-3.5 font-black text-white shadow-[0_12px_24px_rgba(74,130,184,0.35)] disabled:cursor-not-allowed disabled:opacity-40">
              {saving ? '저장 중…' : '변경 사항 저장'}
            </button>
            <button type="button" onClick={onClose} className="mt-2 w-full py-2.5 text-sm font-black text-[#64748B]">
              취소
            </button>
          </>
        )}
      </section>
    </div>
  )
}
