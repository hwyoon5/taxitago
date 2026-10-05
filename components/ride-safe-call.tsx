'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX } from 'lucide-react'
import { fetchSafeCall, sendCallSignal, startSafeCallSession, updateSafeCall } from '@/lib/comms-client'
import type { CallSignal, CommsRole, PublicSafeCall } from '@/lib/comms-types'

const RTC_CONFIG: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
const SIGNAL_POLL_MS = 1400
const RING_TIMEOUT_MS = 50_000

function fmtElapsed(totalSec: number) {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 인앱 음성 통화 — 통신사 회선/전화번호 없이 WebRTC P2P 오디오로 연결한다.
// SDP offer/answer와 ICE candidate는 safe-call 세션의 signals 메일박스로 중계한다.
export default function RideSafeCall({
  rideId,
  actorId,
  role,
  peerName,
  onHangup,
}: {
  rideId: string
  actorId: string
  role: CommsRole
  peerName: string
  onHangup: () => void
}) {
  const [call, setCall] = useState<PublicSafeCall | null>(null)
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [speakerOff, setSpeakerOff] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const seenRef = useRef(new Set<string>())
  const pendingIceRef = useRef<string[]>([])
  const callerRef = useRef(false)
  const ringingAtRef = useRef(0)

  const teardownPeer = () => {
    pcRef.current?.close()
    pcRef.current = null
    localRef.current?.getTracks().forEach((track) => track.stop())
    localRef.current = null
    if (audioRef.current) audioRef.current.srcObject = null
  }

  useEffect(() => {
    let cancelled = false

    const ensurePeer = async () => {
      if (pcRef.current) return pcRef.current
      const pc = new RTCPeerConnection(RTC_CONFIG)
      pcRef.current = pc
      pc.onicecandidate = (event) => {
        if (!event.candidate) return
        void sendCallSignal(rideId, actorId, role, 'ice', JSON.stringify(event.candidate.toJSON())).catch(() => undefined)
      }
      pc.ontrack = (event) => {
        if (audioRef.current) audioRef.current.srcObject = event.streams[0] ?? null
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') setError('통화 연결에 실패했어요. 네트워크를 확인해 주세요.')
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return null
        }
        localRef.current = stream
        stream.getAudioTracks().forEach((track) => {
          track.enabled = !muted
          pc.addTrack(track, stream)
        })
      } catch {
        if (!cancelled) setError('마이크 권한을 허용해야 통화할 수 있어요.')
      }
      return pc
    }

    const flushPendingIce = async () => {
      const pc = pcRef.current
      if (!pc || !pc.remoteDescription) return
      const pending = pendingIceRef.current.splice(0)
      for (const payload of pending) {
        await pc.addIceCandidate(JSON.parse(payload) as RTCIceCandidateInit).catch(() => undefined)
      }
    }

    const handleSignal = async (signal: CallSignal) => {
      if (cancelled || seenRef.current.has(signal.id)) return
      seenRef.current.add(signal.id)
      if (signal.from === role) return
      try {
        if (signal.kind === 'offer') {
          // 이미 연결된 채 stable 상태인데 새 offer가 오면 상대가 재시도한 것 — 재협상한다.
          if (pcRef.current && pcRef.current.signalingState === 'stable') {
            pcRef.current.close()
            pcRef.current = null
            pendingIceRef.current = []
          }
          const pc = await ensurePeer()
          if (!pc || cancelled) return
          await pc.setRemoteDescription(JSON.parse(signal.payload) as RTCSessionDescriptionInit)
          await flushPendingIce()
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          await sendCallSignal(rideId, actorId, role, 'answer', JSON.stringify(answer))
          const next = await updateSafeCall(rideId, actorId, role, 'answer').catch(() => null)
          if (next && !cancelled) setCall(next)
        } else if (signal.kind === 'answer') {
          const pc = pcRef.current
          if (!pc || pc.signalingState !== 'have-local-offer') return
          await pc.setRemoteDescription(JSON.parse(signal.payload) as RTCSessionDescriptionInit)
          await flushPendingIce()
        } else {
          const pc = pcRef.current
          if (!pc || !pc.remoteDescription) {
            pendingIceRef.current.push(signal.payload)
            return
          }
          await pc.addIceCandidate(JSON.parse(signal.payload) as RTCIceCandidateInit).catch(() => undefined)
        }
      } catch {
        if (!cancelled) setError('통화 신호 처리에 실패했어요. 다시 걸어 주세요.')
      }
    }

    const pumpSignals = async (signals: CallSignal[]) => {
      for (const signal of signals) {
        // 순서 보장을 위해 직렬 처리
        await handleSignal(signal)
      }
    }

    const boot = async () => {
      const session = await fetchSafeCall(rideId, actorId, role).catch(() => null)
      if (!session || cancelled) {
        if (!session) setError('통화 세션을 열지 못했어요.')
        return
      }
      if (session.status === 'idle') {
        // 발신 — ringing으로 전환하고 SDP offer를 올린다.
        const started = await startSafeCallSession(rideId, actorId, role).catch(() => null)
        if (!started || cancelled) {
          if (!started) setError('통화를 시작하지 못했어요.')
          return
        }
        setCall(started)
        // 동시 발신 충돌 방지 — 서버에 기록된 callerRole만 offer를 보낸다.
        callerRef.current = started.callerRole === role
        ringingAtRef.current = Date.now()
        if (!callerRef.current) return
        const pc = await ensurePeer()
        if (!pc || cancelled) return
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          await sendCallSignal(rideId, actorId, role, 'offer', JSON.stringify(offer))
        } catch {
          if (!cancelled) setError('통화 제안을 만들지 못했어요.')
        }
        return
      }
      // 수신 — 이미 울리는 통화에 합류해 상대의 offer를 기다린다.
      callerRef.current = session.callerRole === role
      if (callerRef.current) ringingAtRef.current = Date.now()
      setCall(session)
      await pumpSignals(session.signals)
    }

    void boot()

    const poll = window.setInterval(() => {
      void (async () => {
        const next = await fetchSafeCall(rideId, actorId, role).catch(() => null)
        if (!next || cancelled) return
        setCall(next)
        await pumpSignals(next.signals)
        // 발신 측 무응답 타임아웃
        if (callerRef.current && next.status === 'ringing' && ringingAtRef.current && Date.now() - ringingAtRef.current > RING_TIMEOUT_MS) {
          void updateSafeCall(rideId, actorId, role, 'hangup').catch(() => undefined)
          setError('상대방이 응답하지 않아 통화를 종료했어요.')
          teardownPeer()
        }
        if (next.status === 'ended' || next.status === 'released') teardownPeer()
      })()
    }, SIGNAL_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(poll)
      teardownPeer()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId, actorId, role])

  // 마이크 음소거 토글
  useEffect(() => {
    localRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
  }, [muted])

  // 스피커(원격 오디오 출력) 토글
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = speakerOff
  }, [speakerOff])

  // 통화 시간 표시
  useEffect(() => {
    if (call?.status !== 'active') return
    const tick = () => {
      const base = call.startedAt ? Date.parse(call.startedAt) : Date.now()
      setElapsed(Math.max(0, Math.floor((Date.now() - base) / 1000)))
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [call?.status, call?.startedAt])

  const hangup = () => {
    teardownPeer()
    void updateSafeCall(rideId, actorId, role, 'hangup').finally(onHangup)
  }

  const status = call?.status ?? 'idle'
  const talking = status === 'active'
  const ended = status === 'ended' || status === 'released'
  const statusText = error
    ? error
    : ended
      ? '통화가 종료되었어요'
      : talking
        ? `통화 중 ${fmtElapsed(elapsed)} · 번호는 노출되지 않습니다`
        : callerRef.current
          ? '상대방에게 연결 중입니다...'
          : '수신 통화에 연결 중입니다...'

  return (
    <div className="fixed inset-0 z-[97] flex items-center justify-center bg-[#1e1033]/70 p-6">
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      <section className="w-full max-w-sm rounded-[32px] bg-white p-6 text-center shadow-2xl">
        <p className="text-xs font-black text-[#4C1FB8]">인앱 안심 음성 통화</p>
        <div className="relative mx-auto mt-5 flex h-28 w-28 items-center justify-center">
          <span className={`absolute inset-0 rounded-full border-2 border-[#C4B5FD] ${talking ? 'animate-pulse' : 'animate-ping'}`} />
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#4C1FB8] text-white shadow-[0_12px_24px_rgba(76,31,184,0.4)]">
            <Phone className="h-8 w-8" />
          </span>
        </div>
        <h3 className="mt-5 text-xl font-black text-[#0F172A]">{peerName}</h3>
        <p className="mt-1 font-mono text-sm font-black text-[#4C1FB8]">{call?.peerVirtualNumber || '050-****-****'}</p>
        <p className="mt-2 text-sm font-bold text-[#64748B]">{statusText}</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setMuted((value) => !value)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-2xl py-3 text-xs font-black ${muted ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#F1F5F9] text-[#334155]'}`}
          >
            {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {muted ? '음소거 중' : '마이크'}
          </button>
          <button
            type="button"
            onClick={() => setSpeakerOff((value) => !value)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-2xl py-3 text-xs font-black ${speakerOff ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#F1F5F9] text-[#334155]'}`}
          >
            {speakerOff ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            스피커
          </button>
          <button
            type="button"
            onClick={hangup}
            className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-[#BE123C] py-3 text-xs font-black text-white"
          >
            <PhoneOff className="h-4 w-4" />
            종료
          </button>
        </div>
        <p className="mt-3 text-[10px] font-bold text-[#94A3B8]">인터넷 데이터로 연결되는 앱 내 통화입니다 · 전화번호가 노출되지 않습니다</p>
      </section>
    </div>
  )
}
