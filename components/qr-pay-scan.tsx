'use client'

import { useEffect, useRef, useState } from 'react'
import { Link2, QrCode, ScanLine, X } from 'lucide-react'
import { apiFetch } from '@/lib/app-origin'
import { payFromBalance } from '@/lib/balance-pay'

/**
 * 승객용 QR 결제 스캐너 — 기사 모달이 생성한 /pay/manual/{id} QR(또는 링크)을
 * 앱 안에서 스캔해 Pi.createPayment 인앱 결제 시트로 바로 연결한다.
 * 결제는 항상 플랫폼 지갑으로 들어가 서버 측 수수료 정산(kind 'manual-settle')이
 * 적용되므로 승객↔기사 다이렉트 송금을 유도하지 않는다.
 */

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>
}

function getBarcodeDetector(): BarcodeDetectorLike | null {
  const Detector = (window as Window & { BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector
  if (!Detector) return null
  try {
    return new Detector({ formats: ['qr_code'] })
  } catch {
    return null
  }
}

/** 스캔된 문자열(URL·경로·날것 id)에서 수동 결제 요청 id를 뽑는다. */
export function extractManualPayId(text: string): string {
  const trimmed = text.trim()
  const match = /\/pay\/manual\/([A-Za-z0-9_-]{6,64})/.exec(trimmed)
  if (match) return match[1]
  return /^[a-f0-9]{8,32}$/i.test(trimmed) ? trimmed : ''
}

type ManualPayPublic = {
  id: string
  driverName: string
  amount: number
  memo: string
  status: 'pending' | 'paid' | 'manual' | 'cancelled'
}

type Stage = 'scan' | 'loading' | 'confirm' | 'paying' | 'done' | 'closed' | 'missing'

export default function QrPayScanModal({
  onClose,
  onPaid,
}: {
  onClose: () => void
  /** 결제 완료 후 호출 — 호출부가 지갑 잔액 차감·거래 내역·활동 기록을 반영한다. */
  onPaid?: (record: ManualPayPublic, proof: { paymentId: string; txid: string }) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const doneRef = useRef(false)
  const [stage, setStage] = useState<Stage>('scan')
  const [cameraHint, setCameraHint] = useState('카메라 권한을 확인하고 있어요.')
  const [cameraLive, setCameraLive] = useState(false)
  const [detectorOk, setDetectorOk] = useState(true)
  const [record, setRecord] = useState<ManualPayPublic | null>(null)
  const [error, setError] = useState('')
  const [pasteValue, setPasteValue] = useState('')

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  const loadRecord = async (id: string) => {
    setStage('loading')
    setError('')
    try {
      const res = await apiFetch(`/api/manual-pay/?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as { record?: ManualPayPublic } | null
      if (!res.ok || !data?.record) {
        setStage('missing')
        return
      }
      setRecord(data.record)
      setStage(
        data.record.status === 'pending'
          ? 'confirm'
          : data.record.status === 'paid' || data.record.status === 'manual'
            ? 'done'
            : 'closed',
      )
    } catch {
      setStage('missing')
    }
  }

  const handleCode = (raw: string) => {
    const id = extractManualPayId(raw)
    if (!id) {
      setError('TaxiTago 결제 QR이 아닙니다. 기사가 보여준 결제 QR을 스캔해 주세요.')
      return
    }
    doneRef.current = true
    stopCamera()
    void loadRecord(id)
  }

  const startCamera = async () => {
    if (doneRef.current) return
    stopCamera()
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraHint('이 기기에서는 카메라를 쓸 수 없어요. 아래에 결제 링크를 붙여 넣어 주세요.')
      return
    }
    setCameraHint('카메라 권한을 허용해 주세요.')
    try {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true })
      }
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play().catch(() => undefined)
      }
      setCameraLive(true)
      setCameraHint(getBarcodeDetector() ? '결제 QR 코드를 화면 안쪽에 맞춰 주세요.' : 'QR을 비춰 주세요. 인식이 안 되면 아래에 링크를 붙여 넣으세요.')
    } catch {
      setCameraHint('카메라를 사용할 수 없어요. 아래에 결제 링크를 붙여 넣어 주세요.')
    }
  }

  useEffect(() => {
    setDetectorOk(Boolean(getBarcodeDetector()))
    void startCamera()
    return () => stopCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!cameraLive || stage !== 'scan') return
    const detector = getBarcodeDetector()
    if (!detector) return
    const canvas = document.createElement('canvas')
    const timer = window.setInterval(async () => {
      const video = videoRef.current
      if (!video || video.readyState < 2 || doneRef.current || !video.videoWidth) return
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      try {
        const codes = await detector.detect(canvas)
        const value = codes.find((item) => item.rawValue)?.rawValue
        if (value) handleCode(value)
      } catch {
        /* keep scanning */
      }
    }, 420)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraLive, stage])

  const pay = () => {
    if (!record || stage !== 'confirm') return
    setStage('paying')
    setError('')
    // 앱 잔액에서 즉시 차감 — 금액은 서버의 결제 요청 레코드가 권위다.
    void payFromBalance({ purpose: 'manual', manualId: record.id, label: '현장 수동 결제' })
      .then((proof) => {
        onPaid?.(record, proof)
        setStage('done')
      })
      .catch((payError) => {
        setError(payError instanceof Error ? payError.message : '결제를 처리하지 못했습니다.')
        setStage('confirm')
      })
  }

  const reset = () => {
    doneRef.current = false
    setRecord(null)
    setError('')
    setStage('scan')
    void startCamera()
  }

  return (
    <div className="fixed inset-0 z-[96] flex items-end bg-[#0f172a]/55 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <section
        className="mx-auto w-full max-w-md rounded-t-[32px] bg-white p-5 shadow-2xl sm:rounded-[32px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold text-[#4C1FB8]">QR 결제</p>
            <h2 className="mt-1 text-xl font-bold text-[#0F172A]">
              {stage === 'scan' || stage === 'loading' ? '기사의 결제 QR을 스캔해 주세요' : '결제 확인'}
            </h2>
            {stage === 'scan' ? (
              <p className="mt-2 text-sm font-medium leading-6 text-[#475569]">기사가 보여준 결제 QR을 스캔하면 Pi 결제 시트가 열립니다.</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera()
              onClose()
            }}
            className="rounded-full bg-[#F1F5F9] p-2 text-[#64748B]"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {stage === 'scan' || stage === 'loading' ? (
          <>
            <div className="relative mx-auto mt-5 block h-56 w-56 overflow-hidden rounded-[28px] border-2 border-[#4C1FB8] bg-[#0F172A]">
              <video ref={videoRef} className={`h-full w-full object-cover ${cameraLive ? 'opacity-100' : 'opacity-0'}`} playsInline muted autoPlay />
              {!cameraLive ? (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
                  <QrCode className="h-16 w-16 text-white/80" />
                </span>
              ) : (
                <>
                  <span className="pointer-events-none absolute inset-4 rounded-2xl border border-white/50" />
                  <span className="pointer-events-none absolute left-8 right-8 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-[#93C5FD]/80" />
                </>
              )}
              {stage === 'loading' ? (
                <span className="absolute inset-0 flex items-center justify-center bg-[#0F172A]/70 text-sm font-bold text-white">결제 정보를 확인하는 중…</span>
              ) : null}
            </div>
            <p className="mt-4 text-center text-xs font-medium leading-5 text-[#64748B]">{cameraHint}</p>
            {error ? <p className="mt-2 text-center text-xs font-black text-[#DC2626]">{error}</p> : null}
            {(!cameraLive || !detectorOk) && (
              <div className="mt-3 flex items-center gap-2 rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] px-3 py-2">
                <Link2 className="h-4 w-4 shrink-0 text-[#4C1FB8]" />
                <input
                  value={pasteValue}
                  onChange={(event) => setPasteValue(event.target.value)}
                  placeholder="결제 링크를 붙여 넣으세요"
                  className="w-full bg-transparent text-xs font-bold text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
                />
                <button
                  type="button"
                  onClick={() => handleCode(pasteValue)}
                  className="shrink-0 rounded-xl bg-[#4C1FB8] px-3 py-1.5 text-[11px] font-black text-white"
                >
                  확인
                </button>
              </div>
            )}
          </>
        ) : null}

        {(stage === 'confirm' || stage === 'paying') && record ? (
          <>
            <div className="mt-4 rounded-2xl border-2 border-[#E0D4FF] bg-[#F8F5FF] p-5 text-center">
              <p className="text-sm font-black text-[#0F172A]">{record.driverName || '기사'}님에게 결제</p>
              {record.memo ? <p className="mt-1 text-xs font-bold text-[#64748B]">{record.memo}</p> : null}
              <p className="mt-3 text-3xl font-black text-[#4C1FB8]">{record.amount.toFixed(7)} Pi</p>
            </div>
            {error ? <p className="mt-2 text-center text-xs font-black text-[#DC2626]">{error}</p> : null}
            <button
              type="button"
              disabled={stage === 'paying'}
              onClick={pay}
              className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#4C1FB8] py-3.5 text-base font-bold text-white shadow-[0_10px_22px_rgba(76,31,184,0.3)] disabled:opacity-70"
            >
              <ScanLine className="h-5 w-5" />
              {stage === 'paying' ? '잔액 결제 처리 중…' : '앱 잔액으로 결제하기'}
            </button>
            <p className="mt-2 text-center text-[11px] font-bold leading-5 text-[#94A3B8]">
              앱 내 충전 잔액에서 즉시 차감됩니다. 플랫폼 수수료가 자동 정산됩니다.
            </p>
            <button type="button" onClick={reset} className="mt-2 w-full py-2 text-xs font-black text-[#64748B]">
              다른 QR 스캔하기
            </button>
          </>
        ) : null}

        {stage === 'done' ? (
          <div className="mt-4 rounded-2xl bg-[#ECFDF5] p-5 text-center">
            <p className="text-base font-black text-[#047857]">결제가 완료되었습니다</p>
            <p className="mt-1 text-xs font-bold text-[#065F46]">
              {record ? `${record.driverName || '기사'}님에게 ${record.amount.toFixed(7)} Pi가 전달되었습니다.` : '정산이 완료되었습니다.'}
            </p>
            <button type="button" onClick={onClose} className="mt-4 w-full rounded-2xl bg-[#10B981] py-3 text-sm font-black text-white">
              확인
            </button>
          </div>
        ) : null}

        {stage === 'closed' ? (
          <div className="mt-4 rounded-2xl bg-[#F1F5F9] p-5 text-center">
            <p className="text-base font-black text-[#334155]">취소된 결제입니다</p>
            <p className="mt-1 text-xs font-bold text-[#64748B]">기사가 이 결제 요청을 취소했습니다.</p>
            <button type="button" onClick={reset} className="mt-4 w-full rounded-2xl border border-[#CBD5E1] bg-white py-3 text-sm font-black text-[#334155]">
              다시 스캔
            </button>
          </div>
        ) : null}

        {stage === 'missing' ? (
          <div className="mt-4 rounded-2xl bg-[#FFF1F2] p-5 text-center">
            <p className="text-base font-black text-[#BE123C]">결제 요청을 찾을 수 없어요</p>
            <p className="mt-1 text-xs font-bold text-[#64748B]">링크가 만료되었거나 잘못되었습니다. 기사에게 새 결제 QR을 받아 주세요.</p>
            <button type="button" onClick={reset} className="mt-4 w-full rounded-2xl border border-[#FDA4AF] bg-white py-3 text-sm font-black text-[#BE123C]">
              다시 스캔
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
