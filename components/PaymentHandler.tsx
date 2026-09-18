'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, QrCode, WalletCards, X, Zap } from 'lucide-react'
import { getPaymentPolicy, timingLabel, type ParkingPaymentOption, type PaymentTiming } from '@/lib/payment-policy'

function activeTiming(service: string, parkingOption: ParkingPaymentOption): PaymentTiming {
  const policy = getPaymentPolicy(service)
  if (!policy) return 'postpaid'
  if (policy.service === '주차') return parkingOption
  return policy.timing
}

type CameraStatus = 'requesting' | 'live' | 'virtual'

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

export function QrScanModal({
  service,
  onClose,
  onScanned,
}: {
  service: string
  onClose: () => void
  onScanned: (code: string) => void
}) {
  const policy = getPaymentPolicy(service)
  const target = policy?.qrTarget === 'charger' ? '충전기' : service
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const doneRef = useRef(false)
  const [status, setStatus] = useState<CameraStatus>('requesting')
  const [hint, setHint] = useState('카메라 권한을 확인하고 있어요.')
  const [finishing, setFinishing] = useState(false)

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    const video = videoRef.current
    if (video) video.srcObject = null
  }

  const completeScan = (code: string) => {
    if (doneRef.current) return
    doneRef.current = true
    setFinishing(true)
    stopCamera()
    window.setTimeout(() => onScanned(code), 240)
  }

  const startCamera = async () => {
    if (doneRef.current) return
    stopCamera()
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('virtual')
      setHint('이 기기에서는 카메라를 쓸 수 없어 가상 스캔으로 진행할 수 있어요.')
      return
    }
    setStatus('requesting')
    setHint('카메라 권한을 허용해 주세요.')
    const tryStream = (constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints)
    try {
      let stream: MediaStream
      try {
        stream = await tryStream({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
      } catch {
        stream = await tryStream({ audio: false, video: true })
      }
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play().catch(() => undefined)
      }
      setStatus('live')
      setHint('QR 코드를 화면 안쪽에 맞춰 주세요. 인식되면 자동으로 넘어갑니다.')
    } catch {
      setStatus('virtual')
      setHint('카메라를 사용할 수 없어 가상 스캔 화면으로 전환했어요. 아래 버튼으로 완료할 수 있어요.')
    }
  }

  useEffect(() => {
    void startCamera()
    return () => stopCamera()
  }, [])

  useEffect(() => {
    if (status !== 'live') return
    const detector = getBarcodeDetector()
    if (!detector) return
    const canvas = document.createElement('canvas')
    const timer = window.setInterval(async () => {
      const video = videoRef.current
      if (!video || video.readyState < 2 || doneRef.current) return
      if (!video.videoWidth || !video.videoHeight) return
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      try {
        const codes = await detector.detect(canvas)
        const value = codes.find((item) => item.rawValue)?.rawValue
        if (value) completeScan(value)
      } catch {
        /* keep scanning */
      }
    }, 420)
    return () => window.clearInterval(timer)
  }, [status])

  return (
    <div className="fixed inset-0 z-[96] flex items-end bg-[#0f172a]/55 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <section className="mx-auto w-full max-w-md rounded-t-[32px] bg-white p-5 shadow-2xl sm:rounded-[32px]" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d8d2e0]" />
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold text-[#4A82B8]">QR SCAN</p>
            <h2 className="mt-1 text-xl font-bold text-[#0F172A]">{target} QR을 스캔해 주세요</h2>
            <p className="mt-2 text-sm font-medium leading-6 text-[#475569]">{policy?.startHint ?? '카메라로 QR 코드를 맞춰 주세요.'}</p>
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
        <button
          type="button"
          onClick={() => {
            void startCamera()
          }}
          className="relative mx-auto mt-5 block h-56 w-56 overflow-hidden rounded-[28px] border-2 border-[#4A82B8] bg-[#0F172A]"
          aria-label="카메라 영역 · 탭하여 다시 연결"
        >
          <video
            ref={videoRef}
            className={`h-full w-full object-cover ${status === 'live' ? 'opacity-100' : 'opacity-0'}`}
            playsInline
            muted
            autoPlay
          />
          {status !== 'live' ? (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
              <span className="absolute inset-4 rounded-2xl border border-white/25" />
              <span className="absolute left-6 right-6 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-[#93C5FD]" />
              <QrCode className="relative h-16 w-16 text-white/80" />
              <span className="relative px-4 text-center text-[11px] font-semibold text-white/80">
                {status === 'requesting' ? '카메라 연결 중' : '가상 스캔 화면'}
              </span>
            </span>
          ) : (
            <>
              <span className="pointer-events-none absolute inset-4 rounded-2xl border border-white/50" />
              <span className="pointer-events-none absolute left-8 right-8 top-1/2 h-0.5 -translate-y-1/2 bg-[#93C5FD]/80" />
            </>
          )}
        </button>
        <p className="mt-4 text-center text-xs font-medium leading-5 text-[#64748B]">{hint}</p>
        <button
          type="button"
          disabled={finishing}
          onClick={() => completeScan(`${policy?.service ?? service}-${Date.now().toString().slice(-6)}`)}
          className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#4A82B8] py-3.5 text-base font-bold text-white shadow-[0_10px_22px_rgba(74,130,184,0.28)] disabled:opacity-70"
        >
          <QrCode className="h-5 w-5" />
          {finishing ? '인식 완료…' : 'QR 스캔 완료'}
        </button>
      </section>
    </div>
  )
}

export function PaymentHandler({
  service,
  amount,
  balance,
  place,
  qrScanned,
  parkingOption,
  prepaidSettled,
  mode = 'setup',
  continueLabel = '이용 시작',
  canProceed = true,
  onParkingOption,
  onRequestQr,
  onPay,
  onNeedCharge,
  onContinue,
  onPrepaidSettled,
}: {
  service: string
  amount: number
  balance: number
  place: string
  qrScanned: boolean
  parkingOption: ParkingPaymentOption
  prepaidSettled: boolean
  mode?: 'setup' | 'notice'
  continueLabel?: string
  canProceed?: boolean
  onParkingOption: (value: ParkingPaymentOption) => void
  onRequestQr: () => void
  onPay: (amount: number, place: string, label: string) => boolean | Promise<boolean>
  onNeedCharge: () => void
  onContinue: () => void
  onPrepaidSettled: () => void
}) {
  const policy = getPaymentPolicy(service)
  if (!policy) return null
  const timing = activeTiming(service, parkingOption)
  const enough = balance >= amount
  const needsQr = policy.requiresQr && !qrScanned
  const needsPrepaid = timing === 'prepaid' && !prepaidSettled
  const payNow = async () => {
    if (!enough) {
      onNeedCharge()
      return
    }
    const ok = await onPay(amount, place, `${policy.title} 선결제`)
    if (ok) onPrepaidSettled()
  }
  const primary = () => {
    if (!canProceed) return
    if (needsQr) {
      onRequestQr()
      return
    }
    if (needsPrepaid) {
      payNow()
      return
    }
    onContinue()
  }
  const primaryLabel = needsQr ? 'QR 스캔하기' : needsPrepaid ? (enough ? `선결제 ${amount.toFixed(2)} Pi` : '잔액 충전하기') : continueLabel

  return (
    <div className="space-y-3">
      <div className="rounded-[22px] border-2 border-[#BFDBFE] bg-[#F8FAFC] p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-[#4A82B8]">결제 안내</p>
          <span className="rounded-full bg-[#4A82B8] px-2.5 py-1 text-[10px] font-bold text-white">{timingLabel(timing)}</span>
        </div>
        <p className="mt-2 text-base font-bold text-[#0F172A]">{policy.summary}</p>
        <p className="mt-2 text-sm font-medium leading-6 text-[#475569]">{mode === 'notice' ? policy.endHint : policy.startHint}</p>
      </div>

      {policy.service === '주차' && mode === 'setup' ? (
        <div className="grid grid-cols-2 gap-2">
          {(['prepaid', 'postpaid'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onParkingOption(option)}
              className={`rounded-2xl border-2 px-3 py-3 text-left ${parkingOption === option ? 'border-[#4A82B8] bg-[#E8F1FA]' : 'border-[#CBD5E1] bg-white'}`}
            >
              <strong className="block text-sm font-bold text-[#0F172A]">{timingLabel(option)}</strong>
              <span className="mt-1 block text-[11px] font-medium text-[#64748B]">{option === 'prepaid' ? '예약·입차 전 결제' : '출차 시 자동결제'}</span>
            </button>
          ))}
        </div>
      ) : null}

      {policy.requiresQr ? (
        <div className={`flex items-center gap-3 rounded-2xl border-2 p-4 ${qrScanned ? 'border-[#A7F3D0] bg-[#ECFDF5]' : 'border-[#CBD5E1] bg-white'}`}>
          <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${qrScanned ? 'bg-[#10B981] text-white' : 'bg-[#E8F1FA] text-[#4A82B8]'}`}>
            {qrScanned ? <Check className="h-5 w-5" strokeWidth={3} /> : policy.qrTarget === 'charger' ? <Zap className="h-5 w-5" /> : <QrCode className="h-5 w-5" />}
          </span>
          <div>
            <p className="text-sm font-bold text-[#0F172A]">{qrScanned ? 'QR 스캔 완료' : 'QR 스캔이 필요해요'}</p>
            <p className="mt-0.5 text-xs font-medium text-[#64748B]">{qrScanned ? '이용을 이어서 진행할 수 있어요.' : policy.startHint}</p>
          </div>
        </div>
      ) : null}

      <div className="rounded-[22px] border-2 border-[#CBD5E1] bg-white p-4">
        <div className="flex items-center gap-2">
          <WalletCards className="h-4 w-4 text-[#4A82B8]" />
          <p className="text-xs font-bold text-[#4A82B8]">Pi 결제</p>
        </div>
        <div className="mt-2 flex items-end justify-between">
          <p className="text-xs font-medium text-[#64748B]">보유 {balance.toFixed(2)} Pi</p>
          <p className="text-lg font-bold text-[#0F172A]">{amount.toFixed(2)} Pi</p>
        </div>
        {timing === 'qr_auto' ? <p className="mt-2 text-xs font-semibold text-[#334155]">반납·이용 종료 후 자동결제됩니다.</p> : null}
        {timing === 'postpaid' ? <p className="mt-2 text-xs font-semibold text-[#334155]">도착·출차 후 후결제됩니다.</p> : null}
        {prepaidSettled ? <p className="mt-2 text-xs font-semibold text-[#047857]">선결제가 완료되었습니다.</p> : null}
        {!enough && needsPrepaid ? <p className="mt-2 text-xs font-bold text-[#BE123C]">잔액이 부족합니다. 충전 후 결제해 주세요.</p> : null}
      </div>

      {mode === 'setup' ? (
        <button
          type="button"
          onClick={primary}
          disabled={!canProceed}
          className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#4A82B8] py-4 text-base font-bold text-white shadow-[0_10px_22px_rgba(74,130,184,0.28)] transition hover:bg-[#3F74A8] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {primaryLabel}
        </button>
      ) : null}
    </div>
  )
}
