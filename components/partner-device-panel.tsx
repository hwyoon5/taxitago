'use client'

import { useCallback, useEffect, useState } from 'react'
import { Link2, MonitorSmartphone, RefreshCw } from 'lucide-react'
import { MobilityDeviceFormModal } from '@/components/mobility-device-form'
import { PartnerFeedsPanel } from '@/components/partner-feeds-panel'
import { SafeBoundary } from '@/components/safe-boundary'
import {
  fetchMyMobilityDevices,
  MOBILITY_STATUS_LABEL,
  updateMyMobilityDevice,
  type MobilityDevice,
} from '@/lib/mobility-devices'

const statusTone = (status: MobilityDevice['status']) =>
  status === 'available' ? 'bg-[#ECFDF5] text-[#047857]'
    : status === 'rented' ? 'bg-[#DBEAFE] text-[#1D4ED8]'
    : status === 'low_battery' ? 'bg-[#FEF3C7] text-[#B45309]'
    : 'bg-[#FFF1F2] text-[#BE123C]'

const batteryTone = (level: number) =>
  level >= 60 ? 'text-[#15803D]' : level >= 20 ? 'text-[#B45309]' : 'text-[#DC2626]'

const agoLabel = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 0) return '—'
  if (diff < 60_000) return '방금 전'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`
  return `${Math.floor(diff / 86_400_000)}일 전`
}

/**
 * 파트너 내 기기·외부 연동 모니터링 패널 — 본인 소유 기기(폼 등록 + 외부 피드
 * 동기화분)의 위치·배터리·대여 상태와 연동 소스 상태를 20초 간격으로 갱신한다.
 */
function PartnerDevicePanelInner({
  ownerUid,
  ownerName = '',
  onNotice,
}: {
  ownerUid: string
  ownerName?: string
  onNotice?: (message: string) => void
}) {
  const uid = ownerUid.trim()
  const [devices, setDevices] = useState<MobilityDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)

  const reload = useCallback(() => {
    if (!uid) return
    void fetchMyMobilityDevices(uid)
      .then(setDevices)
      .finally(() => setLoading(false))
  }, [uid])

  useEffect(() => {
    reload()
    const timer = window.setInterval(reload, 20_000)
    return () => window.clearInterval(timer)
  }, [reload])

  if (!uid) {
    return (
      <p className="rounded-2xl border-2 border-dashed border-[#CBD5E1] p-4 text-center text-xs font-bold leading-5 text-[#64748B]">
        Pi 계정으로 로그인하면 등록한 기기와 외부 연동을 관리할 수 있습니다.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-black text-[#334155]">
            <MonitorSmartphone className="h-4 w-4 text-[#4A82B8]" />
            내 기기 {devices.length}대
          </p>
          <button type="button" onClick={reload} className="flex items-center gap-1 text-[11px] font-black text-[#4A82B8]" aria-label="기기 목록 새로고침">
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>
        {!loading && !devices.length ? (
          <p className="mt-2 rounded-2xl border-2 border-dashed border-[#CBD5E1] p-4 text-center text-xs font-bold leading-5 text-[#64748B]">
            등록된 기기가 없습니다. 아래에서 직접 등록하거나 외부 API 연동을 추가하세요.
          </p>
        ) : null}
        <ul className="mt-2 space-y-2">
          {devices.map((device) => (
            <li key={device.serial} className="rounded-2xl border border-[#E2E8F0] bg-white px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-black text-[#0F172A]">
                  {device.serial}
                  {device.model ? <span className="font-bold text-[#64748B]"> · {device.model}</span> : null}
                </p>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${statusTone(device.status)}`}>
                  {MOBILITY_STATUS_LABEL[device.status]}
                </span>
              </div>
              <p className="mt-1 text-[11px] font-bold text-[#64748B]">
                {device.kind} · <span className={batteryTone(device.battery)}>배터리 {device.battery}%</span> · {device.address || '위치 미등록'}
              </p>
              <p className="mt-0.5 text-[10px] font-bold text-[#94A3B8]">마지막 업데이트 {agoLabel(device.lastSeen)}</p>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => void updateMyMobilityDevice(device.serial, uid, { rentable: !device.rentable }).then((updated) => updated && reload())}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-black ${device.rentable ? 'bg-[#0F172A] text-white' : 'bg-[#F1F5F9] text-[#475569]'}`}
                >
                  {device.rentable ? '대여 허용 중' : '대여 중지'}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="mt-3 w-full rounded-2xl bg-[#4A82B8] py-3 text-xs font-black text-white"
        >
          기기 등록 · 수정 · 삭제
        </button>
      </div>

      <div>
        <p className="flex items-center gap-1.5 text-xs font-black text-[#334155]">
          <Link2 className="h-4 w-4 text-[#4A82B8]" />
          외부 서버 연동
        </p>
        <div className="mt-2">
          <PartnerFeedsPanel ownerUid={uid} onNotice={onNotice} />
        </div>
      </div>

      {formOpen ? (
        <MobilityDeviceFormModal
          ownerUid={uid}
          ownerName={ownerName}
          onClose={() => {
            setFormOpen(false)
            reload()
          }}
        />
      ) : null}
    </div>
  )
}

/** 패널 전체를 감싸 렌더 예외가 페이지 크래시로 번지지 않게 한다. */
export function PartnerDevicePanel(props: Parameters<typeof PartnerDevicePanelInner>[0]) {
  return (
    <SafeBoundary label="기기 목록을 불러오는 중 문제가 발생했어요.">
      <PartnerDevicePanelInner {...props} />
    </SafeBoundary>
  )
}
