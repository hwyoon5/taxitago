'use client'

import { useState } from 'react'
import { Check, Trash2, X } from 'lucide-react'
import { searchPlacesFromApi } from '@/lib/geocode-client'
import {
  deleteMobilityDevice,
  loadMobilityDevices,
  MOBILITY_STATUS_LABEL,
  parseCoordInput,
  saveMobilityDevice,
  updateMobilityDevice,
  type MobilityDevice,
  type MobilityDeviceKind,
  type MobilityDeviceStatus,
} from '@/lib/mobility-devices'

const PARTNER_STATUSES: MobilityDeviceStatus[] = ['available', 'maintenance', 'low_battery']

function statusClass(status: MobilityDeviceStatus) {
  if (status === 'available') return 'text-[#0F766E]'
  if (status === 'low_battery') return 'text-[#B45309]'
  if (status === 'rented') return 'text-[#1D4ED8]'
  return 'text-[#9F1239]'
}

export function MobilityDeviceFormModal({
  initialKind = '자전거',
  onClose,
  onRegistered,
}: {
  initialKind?: MobilityDeviceKind
  onClose: () => void
  onRegistered?: (device: MobilityDevice) => void
}) {
  const [serial, setSerial] = useState('')
  const [kind, setKind] = useState<MobilityDeviceKind>(initialKind)
  const [location, setLocation] = useState('')
  const [battery, setBattery] = useState(80)
  const [status, setStatus] = useState<MobilityDeviceStatus>('available')
  const [editingSerial, setEditingSerial] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<MobilityDevice | null>(null)
  const [devices, setDevices] = useState<MobilityDevice[]>(() => loadMobilityDevices())

  const rentable = status === 'available'

  const applyBattery = (value: number) => {
    const next = Math.max(0, Math.min(100, Math.round(value)))
    setBattery(next)
    if (next < 20 && status === 'available') setStatus('low_battery')
    if (next >= 20 && status === 'low_battery') setStatus('available')
  }

  const beginEdit = (device: MobilityDevice) => {
    setEditingSerial(device.serial)
    setSerial(device.serial)
    setKind(device.kind)
    setLocation(device.address)
    setBattery(device.battery)
    setStatus(device.status === 'rented' ? 'available' : device.status)
    setSaved(null)
    setError('')
  }

  const resetForm = () => {
    setEditingSerial('')
    setSerial('')
    setLocation('')
    setBattery(80)
    setStatus('available')
    setKind(initialKind)
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
      const previous = editingSerial ? loadMobilityDevices().find((item) => item.serial === editingSerial) : undefined
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
      const device: MobilityDevice = {
        serial: serialNo,
        kind,
        address,
        lat,
        lng,
        battery,
        status,
        registeredAt: previous?.registeredAt || new Date().toISOString(),
      }
      setDevices(saveMobilityDevice(device, editingSerial || undefined))
      setSaved(device)
      resetForm()
      onRegistered?.(device)
    } catch {
      setError('등록 중 위치를 확인하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = (device: MobilityDevice, next: MobilityDeviceStatus) => {
    setDevices(updateMobilityDevice(device.serial, { status: next }))
  }

  const remove = (device: MobilityDevice) => {
    setDevices(deleteMobilityDevice(device.serial))
    if (editingSerial === device.serial) resetForm()
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end bg-[#1e1033]/50 sm:items-center sm:p-4" onClick={onClose}>
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
            <h2 id="mobility-device-title" className="mt-1 text-2xl font-black text-[#0F172A]">{editingSerial ? '기기 정보 수정' : '자전거 · 퀵보드 기기 등록'}</h2>
            <p className="mt-1 text-sm font-bold leading-6 text-[#64748B]">배터리와 상태를 저장하면 대여 가능 여부가 목록에 바로 반영됩니다.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F1F5F9] p-2 text-[#334155]" aria-label="닫기">
            <X className="h-5 w-5" />
          </button>
        </div>
        <label className="mt-4 block">
          <span className="text-xs font-black text-[#334155]">기기 고유 ID (Serial No.)</span>
          <input
            value={serial}
            onChange={(event) => setSerial(event.target.value)}
            placeholder="예: BK-2048"
            className="mt-2 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-3 text-sm font-bold outline-none focus:border-[#4A82B8]"
          />
        </label>
        <div className="mt-4">
          <p className="text-xs font-black text-[#334155]">기기 종류</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(['자전거', '퀵보드'] as const).map((item) => (
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
          <span className="text-xs font-black text-[#334155]">위치 (주소 또는 위도, 경도)</span>
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
            onChange={(event) => applyBattery(Number(event.target.value))}
            className="mt-2 w-full accent-[#4A82B8]"
          />
        </label>
        <div className="mt-4 rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black text-[#334155]">이용 가능</p>
              <p className="mt-1 text-[11px] font-bold text-[#64748B]">끄면 점검 중 또는 배터리 부족으로 대여가 막힙니다.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={rentable}
              onClick={() => setStatus(rentable ? (battery < 20 ? 'low_battery' : 'maintenance') : 'available')}
              className={`relative h-8 w-14 shrink-0 rounded-full transition ${rentable ? 'bg-[#047857]' : 'bg-[#CBD5E1]'}`}
            >
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition ${rentable ? 'left-7' : 'left-1'}`} />
            </button>
          </div>
          {rentable ? null : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {PARTNER_STATUSES.filter((item) => item !== 'available').map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setStatus(item)}
                  className={`rounded-xl border-2 py-2.5 text-xs font-black ${status === item ? 'border-[#9F1239] bg-[#9F1239] text-white' : 'border-[#FECACA] bg-white text-[#9F1239]'}`}
                >
                  {MOBILITY_STATUS_LABEL[item]}
                </button>
              ))}
            </div>
          )}
        </div>
        {error ? <p className="mt-3 text-sm font-bold text-[#B91C1C]">{error}</p> : null}
        {saved ? (
          <p className="mt-3 flex items-center gap-2 rounded-2xl bg-[#ECFDF5] px-3 py-3 text-sm font-black text-[#047857]">
            <Check className="h-4 w-4" />
            {saved.serial} 저장 · ({MOBILITY_STATUS_LABEL[saved.status]})
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
        {devices.length ? (
          <ul className="mt-5 space-y-2">
            <li className="text-xs font-black text-[#64748B]">등록 기기 {devices.length}대 · 이용 가능 기기가 가까운 순으로 목록 상단에 표시됩니다</li>
            {devices.map((device) => (
              <li key={`${device.kind}-${device.serial}`} className="rounded-2xl border border-[#E2E8F0] bg-white px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-[#0F172A]">
                      {device.serial}
                      <span className={`font-black ${statusClass(device.status)}`}> ({MOBILITY_STATUS_LABEL[device.status]})</span>
                    </p>
                    <p className="mt-1 text-xs font-bold text-[#475569]">{device.kind} · 배터리 {device.battery}% · {device.address}</p>
                  </div>
                  <button type="button" onClick={() => remove(device)} className="rounded-full bg-[#FEF2F2] p-2 text-[#BE123C]" aria-label={`${device.serial} 삭제`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => beginEdit(device)} className="rounded-full border border-[#BFDBFE] px-3 py-1.5 text-[11px] font-black text-[#4A82B8]">
                    정보 수정
                  </button>
                  {PARTNER_STATUSES.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => changeStatus(device, item)}
                      className={`rounded-full px-3 py-1.5 text-[11px] font-black ${device.status === item ? 'bg-[#0F172A] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
                    >
                      {MOBILITY_STATUS_LABEL[item]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  )
}
