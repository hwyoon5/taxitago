'use client'

import { useState } from 'react'
import {
  emptySpec,
  EV_CHARGE_TYPES,
  facilityTypeToDeviceKind,
  PARKING_LOT_TYPES,
  specKindForDeviceKind,
  SPEED_LIMIT_OPTIONS,
  type DeviceSpec,
  type EvChargerSpec,
  type MobilitySpec,
  type ParkingSpec,
} from '@/lib/device-types'

type Props = {
  /** '자전거' | '킥보드' | 'EV 충전' | '주차' */
  serviceType: string
  spec: DeviceSpec | null
  onChange: (spec: DeviceSpec) => void
}

const inputCls =
  'mt-1.5 w-full rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-2.5 text-sm font-bold outline-none focus:border-[#4A82B8]'
const labelCls = 'text-[11px] font-black text-[#334155]'

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="flex items-center justify-between rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-2.5"
    >
      <span className="text-[11px] font-black text-[#334155]">{label}</span>
      <span className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-[#4A82B8]' : 'bg-[#CBD5E1]'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

/** 주소 검색 → 첫 결과의 주소·좌표를 spec에 반영한다. */
function AddressField({
  value,
  latitude,
  longitude,
  onResolved,
}: {
  value: string
  latitude: number | null
  longitude: number | null
  onResolved: (address: string, lat: number, lng: number) => void
}) {
  const [draft, setDraft] = useState(value)
  const [searching, setSearching] = useState(false)
  const [resolvedNote, setResolvedNote] = useState('')
  const search = async () => {
    const q = draft.trim()
    if (!q || searching) return
    setSearching(true)
    setResolvedNote('')
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as { places?: { name?: string; address?: string; lat?: number; lng?: number }[] } | null
      const place = data?.places?.find((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      if (place && Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
        onResolved(place.address || place.name || q, place.lat!, place.lng!)
        setDraft(place.address || place.name || q)
        setResolvedNote(`좌표 확인됨 · ${place.lat!.toFixed(5)}, ${place.lng!.toFixed(5)}`)
      } else {
        setResolvedNote('주소를 찾지 못했습니다. 다르게 입력해 보세요.')
      }
    } catch {
      setResolvedNote('주소 검색에 실패했습니다.')
    } finally {
      setSearching(false)
    }
  }
  return (
    <div>
      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void search() } }}
          placeholder="주소 입력 후 검색 (예: 부산역)"
          className="flex-1 rounded-2xl border-2 border-[#BFDBFE] bg-[#E8F1FA] px-4 py-2.5 text-sm font-bold outline-none focus:border-[#4A82B8]"
        />
        <button
          type="button"
          onClick={() => void search()}
          disabled={searching || !draft.trim()}
          className="shrink-0 rounded-2xl bg-[#4A82B8] px-4 text-xs font-black text-white disabled:opacity-50"
        >
          {searching ? '검색 중…' : '주소 검색'}
        </button>
      </div>
      {resolvedNote ? <p className="mt-1 text-[10px] font-bold text-[#4A82B8]">{resolvedNote}</p> : null}
      {latitude !== null && longitude !== null ? (
        <p className="mt-1 text-[10px] font-bold text-[#64748B]">위도 {latitude.toFixed(6)} · 경도 {longitude.toFixed(6)}</p>
      ) : null}
    </div>
  )
}

/** 파트너 시설 서비스별 맞춤 입력 폼 — 가입·수정 화면이 공유한다. */
export default function FacilitySpecForm({ serviceType, spec, onChange }: Props) {
  const kind = specKindForDeviceKind(facilityTypeToDeviceKind(serviceType))
  if (!kind) return null
  const current = spec && spec.kind === kind ? spec : emptySpec(kind)
  const patch = (partial: Partial<DeviceSpec>) => onChange({ ...current, ...partial } as DeviceSpec)

  if (kind === 'mobility') {
    const s = current as MobilitySpec
    return (
      <div className="mt-3 space-y-3 rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4">
        <p className="text-xs font-black text-[#334155]">{serviceType} 기기 상세 정보</p>
        <label className="block">
          <span className={labelCls}>모델명</span>
          <input value={s.model} onChange={(e) => patch({ model: e.target.value })} placeholder={serviceType === '킥보드' ? '예: 전동 킥보드 모델 A' : '예: 전기 자전거 모델 B'} className={inputCls} />
        </label>
        <div>
          <span className={labelCls}>최대 속도 제한</span>
          <div className="mt-1.5 flex items-center gap-1.5">
            {SPEED_LIMIT_OPTIONS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => patch({ speedLimitKmh: v })}
                className={`rounded-xl px-3 py-2 text-[11px] font-black ${s.speedLimitKmh === v ? 'bg-[#4A82B8] text-white' : 'bg-[#E8F1FA] text-[#4A82B8]'}`}
              >
                {v}km/h
              </button>
            ))}
            <input
              type="number"
              min={0}
              max={60}
              value={s.speedLimitKmh ?? ''}
              onChange={(e) => patch({ speedLimitKmh: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="직접 입력"
              className="w-24 rounded-xl border-2 border-[#BFDBFE] bg-white px-2.5 py-2 text-[11px] font-bold outline-none focus:border-[#4A82B8]"
            />
          </div>
        </div>
        <label className="block">
          <span className={labelCls}>기기 스펙 메모 (선택)</span>
          <input value={s.specNote} onChange={(e) => patch({ specNote: e.target.value })} placeholder="예: 배터리 500Wh · 교체형" className={inputCls} />
        </label>
        <div>
          <span className={labelCls}>초기 배치 위치</span>
          <div className="mt-1.5">
            <AddressField
              value={s.address}
              latitude={s.latitude}
              longitude={s.longitude}
              onResolved={(address, lat, lng) => patch({ address, latitude: lat, longitude: lng })}
            />
          </div>
        </div>
        <div>
          <span className={labelCls}>초기 배터리 잔량 · {s.batteryLevel ?? 100}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={s.batteryLevel ?? 100}
            onChange={(e) => patch({ batteryLevel: Number(e.target.value) })}
            className="mt-1.5 w-full accent-[#4A82B8]"
            aria-label="초기 배터리 잔량"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Toggle label="잠금 상태" checked={s.locked} onChange={(v) => patch({ locked: v })} />
          <Toggle label="대여 가능" checked={s.rentable} onChange={(v) => patch({ rentable: v })} />
        </div>
      </div>
    )
  }

  if (kind === 'ev') {
    const s = current as EvChargerSpec
    return (
      <div className="mt-3 space-y-3 rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4">
        <p className="text-xs font-black text-[#334155]">EV 충전기 상세 정보</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={labelCls}>충전 방식</span>
            <select value={s.chargeType} onChange={(e) => patch({ chargeType: e.target.value })} className={inputCls}>
              {EV_CHARGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>출력 용량 (kW)</span>
            <input type="number" min={0} step={0.1} value={s.powerKw ?? ''} onChange={(e) => patch({ powerKw: e.target.value === '' ? null : Number(e.target.value) })} placeholder="예: 50" className={inputCls} />
          </label>
        </div>
        <label className="block">
          <span className={labelCls}>설치 장소명</span>
          <input value={s.placeName} onChange={(e) => patch({ placeName: e.target.value })} placeholder="예: 부산역 환승센터" className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>상세 위치</span>
          <input value={s.locationDetail} onChange={(e) => patch({ locationDetail: e.target.value })} placeholder="예: 지하 2층 주차장 C구역" className={inputCls} />
        </label>
        <div>
          <span className={labelCls}>주소 (지도 표시용)</span>
          <div className="mt-1.5">
            <AddressField
              value={s.address}
              latitude={s.latitude}
              longitude={s.longitude}
              onResolved={(address, lat, lng) => patch({ address, latitude: lat, longitude: lng })}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={labelCls}>이용 요금 (원/kWh)</span>
            <input type="number" min={0} value={s.pricePerKwh ?? ''} onChange={(e) => patch({ pricePerKwh: e.target.value === '' ? null : Number(e.target.value) })} placeholder="예: 350" className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>운영 시간</span>
            <input value={s.operatingHours} onChange={(e) => patch({ operatingHours: e.target.value })} placeholder="예: 24시간 / 06:00-23:00" className={inputCls} />
          </label>
        </div>
      </div>
    )
  }

  const s = current as ParkingSpec
  return (
    <div className="mt-3 space-y-3 rounded-2xl border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4">
      <p className="text-xs font-black text-[#334155]">주차장 상세 정보</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={labelCls}>주차 면수 (대)</span>
          <input type="number" min={0} value={s.spaces ?? ''} onChange={(e) => patch({ spaces: e.target.value === '' ? null : Number(e.target.value) })} placeholder="예: 120" className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>주차장 유형</span>
          <select value={s.lotType} onChange={(e) => patch({ lotType: e.target.value })} className={inputCls}>
            {PARKING_LOT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className={labelCls}>기본 요금 (원)</span>
          <input type="number" min={0} value={s.baseFee ?? ''} onChange={(e) => patch({ baseFee: e.target.value === '' ? null : Number(e.target.value) })} placeholder="예: 2000" className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>추가 요금 (원)</span>
          <input type="number" min={0} value={s.extraFee ?? ''} onChange={(e) => patch({ extraFee: e.target.value === '' ? null : Number(e.target.value) })} placeholder="예: 500" className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>단위 시간 (분)</span>
          <input type="number" min={0} value={s.feeUnitMinutes ?? ''} onChange={(e) => patch({ feeUnitMinutes: e.target.value === '' ? null : Number(e.target.value) })} placeholder="예: 10" className={inputCls} />
        </label>
      </div>
      <div>
        <span className={labelCls}>상세 위치 (주소 검색)</span>
        <div className="mt-1.5">
          <AddressField
            value={s.address}
            latitude={s.latitude}
            longitude={s.longitude}
            onResolved={(address, lat, lng) => patch({ address, latitude: lat, longitude: lng })}
          />
        </div>
      </div>
      <label className="block">
        <span className={labelCls}>진입 안내</span>
        <input value={s.entranceNote} onChange={(e) => patch({ entranceNote: e.target.value })} placeholder="예: 서측 게이트 진입 후 B1으로 하강" className={inputCls} />
      </label>
    </div>
  )
}
