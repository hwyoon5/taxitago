'use client'

import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { searchPlacesFromApi } from '@/lib/geocode-client'
import {
  loadMobilityDevices,
  parseCoordInput,
  saveMobilityDevice,
  type MobilityDevice,
  type MobilityDeviceKind,
} from '@/lib/mobility-devices'

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
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<MobilityDevice | null>(null)
  const [devices, setDevices] = useState<MobilityDevice[]>(() => loadMobilityDevices())

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
      if (lat == null || lng == null) {
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
        registeredAt: new Date().toISOString(),
      }
      setDevices(saveMobilityDevice(device))
      setSaved(device)
      setSerial('')
      setLocation('')
      onRegistered?.(device)
    } catch {
      setError('등록 중 위치를 확인하지 못했어요. 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
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
            <h2 id="mobility-device-title" className="mt-1 text-2xl font-black text-[#0F172A]">자전거 · 퀵보드 기기 등록</h2>
            <p className="mt-1 text-sm font-bold leading-6 text-[#64748B]">시리얼과 위치를 저장하면 목록과 지도에 이용가능 기기로 바로 올라갑니다.</p>
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
        {error ? <p className="mt-3 text-sm font-bold text-[#B91C1C]">{error}</p> : null}
        {saved ? (
          <p className="mt-3 flex items-center gap-2 rounded-2xl bg-[#ECFDF5] px-3 py-3 text-sm font-black text-[#047857]">
            <Check className="h-4 w-4" />
            {saved.serial} 등록 완료 · (이용가능)
          </p>
        ) : null}
        <button
          type="button"
          disabled={saving}
          onClick={() => void submit()}
          className="mt-5 w-full rounded-2xl bg-[#4A82B8] py-3.5 font-black text-white disabled:opacity-70"
        >
          {saving ? '위치 확인 중…' : '기기 등록'}
        </button>
        {devices.length ? (
          <ul className="mt-5 space-y-2">
            <li className="text-xs font-black text-[#64748B]">등록된 기기 {devices.length}대 · 가까운 순으로 목록 상단에 표시됩니다</li>
            {devices.map((device) => (
              <li key={`${device.kind}-${device.serial}`} className="rounded-2xl border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-3">
                <p className="text-sm font-black text-[#0F172A]">
                  {device.serial}
                  <span className="font-black text-[#0F766E]"> (이용가능)</span>
                </p>
                <p className="mt-1 text-xs font-bold text-[#475569]">{device.kind} · {device.address}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  )
}
