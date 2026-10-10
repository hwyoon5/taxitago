'use client'

import { useEffect, useState } from 'react'
import { adminHeaders } from '@/lib/admin-key'
import { deviceTypeLabel, type DeviceTelemetry } from '@/lib/device-types'
import { PaginationBar, PageSizeSelect } from '@/components/admin-pagination'

const STATUS_LABEL: Record<string, string> = {
  active: '운행 중',
  idle: '대기',
  charging: '충전 중',
  maintenance: '정비',
  offline: '오프라인',
}

const typeTone = (type: string) =>
  type === 'bicycle' ? 'bg-[#DCFCE7] text-[#15803D]'
    : type === 'kickboard' ? 'bg-[#DBEAFE] text-[#1D4ED8]'
    : type === 'ev' ? 'bg-[#FEF3C7] text-[#B45309]'
    : 'bg-[#F1F5F9] text-[#475569]'

const batteryTone = (level: number | null) =>
  level === null ? 'text-[#94A3B8]'
    : level <= 20 ? 'text-[#DC2626]'
    : level <= 50 ? 'text-[#B45309]'
    : 'text-[#15803D]'

const ageLabel = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return '방금 전'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`
  return `${Math.floor(diff / 86_400_000)}일 전`
}

export default function AdminDevices() {
  const [devices, setDevices] = useState<DeviceTelemetry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)

  const load = () => {
    void fetch('/api/admin/devices', { headers: adminHeaders(), cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { devices?: DeviceTelemetry[]; error?: string } | null
        if (!res.ok) throw new Error(data?.error || 'load_failed')
        setDevices(data?.devices ?? [])
        setError('')
      })
      .catch(() => setError('기기 목록을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 15000)
    return () => window.clearInterval(timer)
  }, [])

  const totalPages = Math.max(1, Math.ceil(devices.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const paged = devices.slice(safePage * pageSize, safePage * pageSize + pageSize)
  const pageButtons = (() => {
    const span = 2
    const start = Math.max(0, Math.min(safePage - span, totalPages - span * 2 - 1))
    const end = Math.min(totalPages, start + span * 2 + 1)
    return Array.from({ length: end - start }, (_, i) => start + i + 1)
  })()

  return (
    <div className="mt-4">
      {error ? <p className="mb-3 rounded-2xl border-2 border-[#FCA5A5] bg-[#FEF2F2] px-4 py-2.5 text-xs font-black text-[#DC2626]">{error}</p> : null}
      <section className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-black text-[#4C1FB8]">등록 기기 · {devices.length}대</p>
          <span className="flex items-center gap-2">
            <PageSizeSelect pageSize={pageSize} onChange={(size) => { setPageSize(size); setPage(0) }} />
            <button
              type="button"
              onClick={load}
              className="rounded-full border border-[#CBD5E1] bg-white px-2 py-0.5 text-[10px] font-black text-[#475569]"
            >
              새로고침
            </button>
          </span>
        </div>
        <p className="mt-1 text-[10px] font-bold text-[#94A3B8]">
          자전거·킥보드 등 기기가 /api/devices/location-update로 보낸 최신 위치 신고입니다. 15초마다 자동 갱신됩니다.
        </p>
        {loading ? <p className="mt-4 text-center text-xs font-bold text-[#64748B]">불러오는 중…</p> : null}
        {!loading && !devices.length ? (
          <p className="mt-4 rounded-2xl border-2 border-dashed border-[#CBD5E1] p-5 text-center text-sm font-bold text-[#64748B]">
            아직 신고된 기기가 없습니다. 기기 시뮬레이터나 실제 단말이 위치를 보내면 여기에 표시됩니다.
          </p>
        ) : null}
        <div className="mt-3 space-y-2">
          {paged.map((row) => (
            <div key={row.deviceId} className="rounded-xl border-2 border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-black">
                  {row.deviceId}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${typeTone(row.type)}`}>
                    {deviceTypeLabel(row.type)}
                  </span>
                </p>
                <span className="text-[10px] font-bold text-[#94A3B8]">{ageLabel(row.lastSeen)}</span>
              </div>
              <p className="mt-1 font-mono text-[11px] font-bold text-[#475569]">
                {row.latitude.toFixed(6)}, {row.longitude.toFixed(6)}
              </p>
              <p className="mt-0.5 flex items-center gap-2 text-[11px] font-bold text-[#64748B]">
                <span className={batteryTone(row.batteryLevel)}>
                  배터리 {row.batteryLevel === null ? '—' : `${row.batteryLevel}%`}
                </span>
                <span>· {STATUS_LABEL[row.status] || row.status}</span>
                <span className="text-[#94A3B8]">· 신고 {row.updateCount}회 · 최초 {new Date(row.firstSeen).toLocaleDateString('ko-KR')}</span>
              </p>
            </div>
          ))}
        </div>
        {devices.length > 0 ? (
          <PaginationBar
            total={devices.length}
            rangeStart={safePage * pageSize + 1}
            rangeEnd={Math.min(devices.length, (safePage + 1) * pageSize)}
            page={safePage + 1}
            totalPages={totalPages}
            pageButtons={pageButtons}
            onPage={(p) => setPage(p - 1)}
          />
        ) : null}
      </section>
    </div>
  )
}
