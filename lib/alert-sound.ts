// Lightweight Web Audio alert tones for ride comms events — no audio assets needed.
let audioCtx: AudioContext | null = null
let unlockBound = false
// 자동재생 정책으로 잠긴 사이 놓친 알림 — 잠금이 풀리면 한 번 재생한다.
let pendingAlert: 'message' | 'call' | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!audioCtx) audioCtx = new AC()
  return audioCtx
}

function tone(at: number, freq: number, dur: number, peak = 0.18) {
  const audio = getCtx()
  if (!audio) return
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(gain)
  gain.connect(audio.destination)
  osc.start(at)
  osc.stop(at + dur + 0.05)
}

function playTones(audio: AudioContext, kind: 'message' | 'call') {
  const now = audio.currentTime + 0.02
  if (kind === 'call') {
    ;[0, 0.4, 0.8].forEach((offset) => {
      tone(now + offset, 880, 0.2, 0.22)
      tone(now + offset + 0.2, 1174.66, 0.16, 0.14)
    })
  } else {
    tone(now, 1046.5, 0.16)
    tone(now + 0.17, 1568, 0.24)
  }
}

function flushPendingAlert() {
  const audio = audioCtx
  if (!audio || audio.state !== 'running' || !pendingAlert) return
  const kind = pendingAlert
  pendingAlert = null
  playTones(audio, kind)
}

// 브라우저 자동재생 정책 대응 — 첫 사용자 제스처로 AudioContext를 재개시킨다.
// 컴포넌트 마운트/알림 호출 시 한 번만 바인딩하면 이후 알림이 소리를 잃지 않는다.
export function primeCommsAlertAudio() {
  if (typeof window === 'undefined' || unlockBound) return
  unlockBound = true
  const handler = () => {
    const audio = getCtx()
    if (!audio) return
    if (audio.state === 'suspended') {
      void audio.resume().then(flushPendingAlert).catch(() => undefined)
      return
    }
    flushPendingAlert()
  }
  for (const type of ['pointerdown', 'touchstart', 'keydown']) {
    window.addEventListener(type, handler, { passive: true })
  }
}

export function playCommsAlert(kind: 'message' | 'call') {
  try {
    primeCommsAlertAudio()
    const audio = getCtx()
    if (!audio) return
    if (audio.state === 'running') {
      playTones(audio, kind)
      return
    }
    // suspended 상태에 바로 톤을 예약하면 resume 이전 구간이 무음으로 날아간다.
    // pending으로 보관했다가 잠금 해제(또는 직접 resume 성공) 시 재생한다.
    pendingAlert = kind
    void audio.resume().then(flushPendingAlert).catch(() => undefined)
  } catch {
    undefined
  }
}
