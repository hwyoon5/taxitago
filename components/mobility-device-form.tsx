'use client'

import { Component, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Check, Link2, RefreshCw, Trash2, X } from 'lucide-react'
import { searchPlacesFromApi } from '@/lib/geocode-client'
import { PartnerFeedsPanel } from '@/components/partner-feeds-panel'
import {
  deleteMobilityDevice,
  fetchMyMobilityDevices,
  MOBILITY_STATUS_LABEL,
  normalizeMobilityKind,
  parseCoordInput,
  registerMobilityDevice,
  updateMyMobilityDevice,
  type MobilityDevice,
  type MobilityDeviceKind,
} from '@/lib/mobility-devices'

function statusClass(status: MobilityDevice['status']) {
  if (status === 'available') return 'text-[#0F766E]'
  if (status === 'low_battery') return 'text-[#B45309]'
  if (status === 'rented') return 'text-[#1D4ED8]'
  return 'text-[#9F1239]'
}

/**
 * 폼 내부 렌더 예외를 페이지 크래시(app/error.tsx)로 번지지 않게 막는 바운더리 —
 * 비정상 기기 데이터가 있어도 폼이 깔끔한 오류 패널로 대체된다.
 */
class DeviceFormErrorBoundary extends Component<{ onClose: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <section className="mx-auto w-full max-w-md rounded-t-[32px] bg-white p-6 text-center shadow-2xl sm:rounded-[32px]" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-black text-[#0F172A]">기기 정보를 불러오는 중 문제가 발생했어요.</p>
        <p className="mt-1 text-xs font-bold leading-5 text-[#64748B]">일시적인 오류일 수 있습니다. 다시 시도하거나 창을 닫아 주세요.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={this.props.onClose} className="rounded-2xl border-2 border-[#CBD5E1] py-2.5 text-xs font-black text-[#475569]">
            닫기
          </button>
          <button type="button" onClick={() => this.setState({ failed: false })} className="rounded-2xl bg-[#4A82B8] py-2.5 text-xs font-black text-white">
            다시 시도
          </button>
        </div>
      </section>
    )
  }
}

/**
 * 파트너 기기 등록·관리 모달 — 서버 기기 스토어(/api/devices)에 저장되어
 * 등록 즉시 모든 이용자의 지도에 노출된다. ownerUid가 있어야 수정·삭제가
 * 허용된다(소유자 검증은 서버가 한다).
 */
export function MobilityDeviceFormModal({
  initialKind = '자전거',
  ownerUid = '',
  ownerName = '',
  onClose,
  onRegistered,
}: {
  initialKind?: MobilityDeviceKind | string
  ownerUid?: string
  ownerName?: string
  onClose: () => void
  onRegistered?: (device: MobilityDevice) => void
}) {
  const uid = ownerUid.trim()
  const defaultKind = normalizeMobilityKind(initialKind)
  const [serial, setSerial] = useState('')
  const [kind, setKind] = useState<MobilityDeviceKind>(defaultKind)
  const [model, setModel] = useState('')
  const [location, setLocation] = useState('')
  const [battery, setBattery] = useState(80)
  const [rentable, setRentable] = useState(true)
  const [editingSerial, setEditingSerial] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<MobilityDevice | null>(null)
  const [devices, setDevices] = useState<MobilityDevice[]>([])
  const [loadingList, setLoadingList] = useState(false)

  const reload = useCallback(() => {
    if (!uid) return
    setLoadingList(true)
    void fetchMyMobilityDevices(uid)
      .then(setDevices)
      .finally(() => setLoadingList(false))
  }, [uid])
  useEffect(() => {
    reload()
  }, [reload])

  // 수정 모드 진입 — 기기 데이터가 비정상이어도 예외 없이 안전하게 바인딩한다.
  const beginEdit = (device: MobilityDevice) => {
    try {
      const serialNo = typeof device?.serial === 'string' ? device.serial : ''
      if (!serialNo) {
        setError('기기 정보가 올바르지 않아 수정할 수 없어요. 목록을 새로고침해 주세요.')
        return
      }
      const level = Number(device.battery)
      setEditingSerial(serialNo)
      setSerial(serialNo)
      setKind(normalizeMobilityKind(device.kind))
      setModel(typeof device.model === 'string' ? device.model : '')
      setLocation(typeof device.address === 'string' ? device.address : '')
      setBattery(Number.isFinite(level) ? Math.max(0, Math.min(100, Math.round(level))) : 80)
      setRentable(device.rentable === true)
      setSaved(null)
      setError('')
    } catch {
      setError('기기 정보를 불러오지 못했어요. 목록을 새로고침한 뒤 다시 시도해 주세요.')
    }
  }

  const resetForm = () => {
    setEditingSerial('')
    setSerial('')
    setModel('')
    setLocation('')
    setBattery(80)
    setRentable(true)
    setKind(defaultKind)
  }

  const submit = async () => {
    const serialNo = serial.trim()
    const place = location.trim()
    if (!serialNo) {
      setError('기기 고유 ID(Serial No.)를 입력해 주세요.')
      return
    }
    if (!place) {
      setError('위치(주소 또는 위도, 경도)를 입력해 주세요.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const coords = parseCoordInput(place)
      let lat = coords?.lat
      let lng = coords?.lng
      let address = place
      const previous = editingSerial ? devices.find((item) => item.serial === editingSerial) : undefined
      const samePlace = previous && previous.address === place
      if (samePlace) {
        lat = previous.lat
        lng = previous.lng
        address = previous.address
      } else if (lat == null || lng == null) {
        const found = await searchPlacesFromApi(place)
        const hit = found[0]
        if (!hit) {
          setError('주소를 찾지 못했어요. 위도, 경도 형식으로 다시 입력해 주세요.')
          return
        }
        lat = hit.lat
        lng = hit.lng
        address = hit.address || hit.name || place
      }
      const result = await registerMobilityDevice({
        serial: serialNo,
        kind,
        model,
        address,
        lat,
        lng,
        battery,
        rentable,
        ownerUid: uid || undefined,
        ownerName: ownerName || undefined,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSaved(result.device)
      resetForm()
      reload()
      onRegistered?.(result.device)
    } finally {
      setSaving(false)
    }
  }

  const toggleRentable = async (device: MobilityDevice, next: boolean) => {
    const updated = await updateMyMobilityDevice(device.serial, uid, { rentable: next })
    if (updated) setDevices((list) => list.map((item) => (item.serial === device.serial ? updated : item)))
  }

  const remove = async (device: MobilityDevice) => {
    if (await deleteMobilityDevice(device.serial, uid)) {
      setDevices((list) => list.filter((item) => item.serial !== device.serial))
      if (editingSerial === device.serial) resetForm()
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end bg-[#1e1033]/50 sm:items-center sm:p-4" onClick={onClose}>
      <DeviceFormErrorBoundary onClose={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobility-device-title"
        className="mx-auto max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[32px] bg-white p-5 shadow-2xl sm:rounded-[32px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black text-[#4A82B8]">PARTNER DEVICE</p>
            <h2 id="mobility-device-title" className="mt-1 text-2xl font-black text-[#0F172A]">{editingSerial ? '기기 정보 수정' : '자전거 · 킥보드 기기 등록'}</h2>
            <p className="mt-1 text-sm font-bold leading-6 text-[#64748B]">등록 즉시 이용자 지도에 위치가 공유됩니다. 대여 가능으로 둔 기기만 대여됩니다.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="닫기">
            <X className="h-5 w-5" />
          </button>
        </div>
        {!uid ? (
          <p className="mt-3 rounded-2xl bg-[#FEF3C7] px-3 py-2.5 text-xs font-bold leading-5 text-[#92400E]">
            Pi 로그인 없이 등록하면 기기 관리(수정·삭제·대여 허용 변경)를 할 수 없습니다. 로그인 후 등록을 권장합니다.
          </p>
        ) : null}
        <label className="mt-4 block">
          <span className="text-xs font-black text-[#334155]">기기 고유 ID (Serial No.)</span>
          <input
            value={serial}
            onChange={(event) => setSerial(event.target.value)}
            placeholder="예: BK-2048"
            disabled={Boolean(editingSerial)}
            className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8] disabled:cursor-not-allowed disabled:opacity-60"
          />
          {editingSerial ? (
            <span className="mt-1 block text-[10px] font-bold text-[#94A3B8]">
              수정 중에는 기기 ID를 바꿀 수 없습니다.
              {editingSerial.startsWith('ext:') ? ' 외부 연동 기기는 다음 자동 동기화에 피드 값이 다시 적용될 수 있어요.' : ''}
            </span>
          ) : null}
        </label>
        <div className="mt-4">
          <p className="text-xs font-black text-[#334155]">기기 종류</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(['자전거', '킥보드'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setKind(item)}
                className={`rounded-2xl border-2 py-3 text-sm font-black ${kind === item ? 'border-[#4A82B8] bg-[#4A82B8] text-white' : 'border-[#BFDBFE] bg-[#E8F1FA] text-[#4A82B8]'}`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <label className="mt-4 block">
          <span className="text-xs font-black text-[#334155]">모델명 (선택)</span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="예: 전동 킥보드 모델 A"
            className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8]"
          />
        </label>
        <label className="mt-4 block">
          <span className="text-xs font-black text-[#334155]">대여 위치 (주소 또는 위도, 경도)</span>
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="부산역 또는 35.199, 128.998"
            className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8]"
          />
        </label>
        <label className="mt-4 block">
          <span className="flex items-center justify-between text-xs font-black text-[#334155]">
            배터리 잔량
            <span>{battery}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={battery}
            onChange={(event) => setBattery(Math.max(0, Math.min(100, Math.round(Number(event.target.value)))))}
            className="mt-2 w-full accent-[#4A82B8]"
          />
        </label>
        <div className="mt-4 rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black text-[#334155]">대여 허용</p>
              <p className="mt-1 text-[11px] font-bold text-[#64748B]">끄면 이용자 지도에 '점검 중'으로 표시되고 대여가 막힙니다.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={rentable}
              onClick={() => setRentable(!rentable)}
              className={`relative h-8 w-14 shrink-0 rounded-full transition ${rentable ? 'bg-[#047857]' : 'bg-[#CBD5E1]'}`}
            >
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition ${rentable ? 'left-7' : 'left-1'}`} />
            </button>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm font-bold text-[#B91C1C]">{error}</p> : null}
        {saved ? (
          <p className="mt-3 flex items-center gap-2 rounded-2xl bg-[#ECFDF5] px-3 py-3 text-sm font-black text-[#047857]">
            <Check className="h-4 w-4" />
            {saved.serial} 등록 완료 · 이용자 지도에 공유됩니다
          </p>
        ) : null}
        <div className={`mt-5 grid gap-2 ${editingSerial ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {editingSerial ? (
            <button type="button" onClick={resetForm} className="rounded-2xl border-2 border-[#CBD5E1] py-3.5 text-sm font-black text-[#475569]">
              새로 등록
            </button>
          ) : null}
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="rounded-2xl bg-[#4A82B8] py-3.5 font-black text-white disabled:opacity-70"
          >
            {saving ? '위치 확인 중…' : editingSerial ? '수정 저장' : '기기 등록'}
          </button>
        </div>
        {uid ? (
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black text-[#64748B]">내 등록 기기 {devices.length}대</p>
              <button type="button" onClick={reload} className="flex items-center gap-1 text-[11px] font-black text-[#4A82B8]" aria-label="목록 새로고침">
                <RefreshCw className={`h-3 w-3 ${loadingList ? 'animate-spin' : ''}`} />
                새로고침
              </button>
            </div>
            {devices.length ? (
              <ul className="mt-2 space-y-2">
                {devices.map((device) => (
                  <li key={device.serial} className="rounded-2xl border border-[#E2E8F0] bg-white px-3 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-black text-[#0F172A]">
                          {device.serial}
                          <span className={`font-black ${statusClass(device.status)}`}> ({MOBILITY_STATUS_LABEL[device.status]})</span>
                        </p>
                        <p className="mt-1 text-xs font-bold text-[#475569]">
                          {device.kind}{device.model ? ` · ${device.model}` : ''} · 배터리 {device.battery}% · {device.address}
                        </p>
                      </div>
                      <button type="button" onClick={() => void remove(device)} className="rounded-full bg-[#FEF2F2] p-2 text-[#BE123C]" aria-label={`${device.serial} 삭제`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => beginEdit(device)} className="rounded-full border border-[#BFDBFE] px-3 py-1.5 text-[11px] font-black text-[#4A82B8]">
                        정보 수정
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleRentable(device, !device.rentable)}
                        className={`rounded-full px-3 py-1.5 text-[11px] font-black ${device.rentable ? 'bg-[#0F172A] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
                      >
                        {device.rentable ? '대여 허용 중' : '대여 중지'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs font-bold text-[#94A3B8]">{loadingList ? '불러오는 중…' : '아직 등록한 기기가 없습니다.'}</p>
            )}
          </div>
        ) : null}
        {uid ? (
          <div className="mt-5 rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4">
            <p className="flex items-center gap-2 text-xs font-black text-[#334155]">
              <Link2 className="h-4 w-4 text-[#4A82B8]" />
              외부 서버 연동 (실시간 기기 피드)
            </p>
            <p className="mt-1.5 text-[11px] font-bold leading-5 text-[#64748B]">
              업체 서버가 기기 위치·배터리·대여 상태를 JSON으로 제공하는 API 주소를 등록하면, 서버가 1분 간격으로 자동 취합해 이용자 지도에 상호명과 함께 표시합니다.
            </p>
            <div className="mt-3">
              <PartnerFeedsPanel ownerUid={uid} />
            </div>
          </div>
        ) : null}
      </section>
      </DeviceFormErrorBoundary>
    </div>
  )
}
