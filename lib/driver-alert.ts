let audioContext: AudioContext | null = null
let unlockBound = false
let fallbackAudio: HTMLAudioElement | null = null
let fallbackUri = ''
let lastAlertKey = ''
let lastAlertAt = 0

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  const w = window as Window & { webkitAudioContext?: typeof AudioContext }
  return window.AudioContext || w.webkitAudioContext || null
}

function getContext() {
  const Ctor = audioContextCtor()
  if (!Ctor) return null
  if (!audioContext || audioContext.state === 'closed') audioContext = new Ctor()
  return audioContext
}

function resumeContext() {
  const ctx = getContext()
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
}

// Call from any user gesture (or on driver-mode mount) so the alarm is
// allowed to play later even after the page sat idle/backgrounded.
export function primeDriverAlertAudio() {
  resumeContext()
  if (unlockBound || typeof window === 'undefined') return
  unlockBound = true
  const handler = () => resumeContext()
  for (const type of ['pointerdown', 'touchstart', 'keydown']) {
    window.addEventListener(type, handler, { passive: true })
  }
}

function tone(ctx: AudioContext, out: AudioNode, freq: number, start: number, duration: number, gain: number) {
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = 'square'
  osc.frequency.value = freq
  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.linearRampToValueAtTime(gain, start + 0.015)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(amp)
  amp.connect(out)
  osc.start(start)
  osc.stop(start + duration + 0.05)
}

// Dispatch ring: high-low two-tone, 4 cycles, ~2.4s total.
function playWebAudioAlarm(ctx: AudioContext, out?: AudioNode) {
  const dest = out || ctx.destination
  const now = ctx.currentTime + 0.03
  let cursor = now
  for (let cycle = 0; cycle < 4; cycle += 1) {
    tone(ctx, dest, 1568, cursor, 0.16, 0.22)
    tone(ctx, dest, 1174.66, cursor + 0.17, 0.16, 0.22)
    cursor += 0.42
  }
}

function buildFallbackWavUri() {
  if (fallbackUri) return fallbackUri
  const rate = 22050
  const durationSec = 1.8
  const total = Math.floor(rate * durationSec)
  const data = new Int16Array(total)
  for (let i = 0; i < total; i += 1) {
    const t = i / rate
    const cycle = Math.floor(t / 0.42)
    const within = t - cycle * 0.42
    let freq = 0
    if (within < 0.16) freq = 1568
    else if (within < 0.33) freq = 1174.66
    const envelope = freq === 0 ? 0 : Math.min(1, (within % 0.17) / 0.01) * Math.min(1, (0.17 - (within % 0.17)) / 0.03)
    data[i] = Math.floor(Math.sin(2 * Math.PI * freq * t) * 14000 * Math.max(0, envelope))
  }
  const buffer = new ArrayBuffer(44 + total * 2)
  const view = new DataView(buffer)
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + total * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, total * 2, true)
  for (let i = 0; i < total; i += 1) view.setInt16(44 + i * 2, data[i], true)
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  fallbackUri = `data:audio/wav;base64,${window.btoa(binary)}`
  return fallbackUri
}

function playFallbackAlarm() {
  try {
    if (!fallbackAudio) fallbackAudio = new Audio(buildFallbackWavUri())
    fallbackAudio.currentTime = 0
    void fallbackAudio.play().catch(() => undefined)
  } catch {
    undefined
  }
}

export function playDriverOfferAlarm() {
  const ctx = getContext()
  if (!ctx) {
    playFallbackAlarm()
    return
  }
  resumeContext()
  if (ctx.state === 'running') {
    playWebAudioAlarm(ctx)
    return
  }
  void ctx.resume().then(() => {
    if (ctx.state === 'running') playWebAudioAlarm(ctx)
    else playFallbackAlarm()
  }).catch(() => playFallbackAlarm())
}

// Looping offer alarm — all loop tones run through offerLoopBus so a stop can
// mute in-flight oscillators instantly instead of waiting out the envelope.
let offerLoopTimer: number | null = null
let offerLoopGuard: number | null = null
let offerLoopBus: GainNode | null = null

export function stopDriverOfferAlarm() {
  if (offerLoopTimer != null) {
    window.clearInterval(offerLoopTimer)
    offerLoopTimer = null
  }
  if (offerLoopGuard != null) {
    window.clearTimeout(offerLoopGuard)
    offerLoopGuard = null
  }
  const bus = offerLoopBus
  offerLoopBus = null
  if (bus) {
    try {
      bus.gain.cancelScheduledValues(audioContext?.currentTime ?? 0)
      bus.gain.setTargetAtTime(0.0001, audioContext?.currentTime ?? 0, 0.02)
    } catch {
      undefined
    }
    window.setTimeout(() => {
      try {
        bus.disconnect()
      } catch {
        undefined
      }
    }, 120)
  }
  if (fallbackAudio) {
    try {
      fallbackAudio.pause()
      fallbackAudio.currentTime = 0
    } catch {
      undefined
    }
    fallbackAudio.loop = false
  }
  // 명시적으로 끈 뒤 같은 오퍼가 다시 살아나면 재알림을 허용한다.
  lastAlertKey = ''
}

function startOfferAlarmLoop() {
  stopDriverOfferAlarm()
  const ctx = getContext()
  if (ctx) {
    resumeContext()
    const bus = ctx.createGain()
    bus.connect(ctx.destination)
    offerLoopBus = bus
  } else {
    try {
      if (!fallbackAudio) fallbackAudio = new Audio(buildFallbackWavUri())
      fallbackAudio.loop = true
      fallbackAudio.currentTime = 0
      void fallbackAudio.play().catch(() => undefined)
    } catch {
      undefined
    }
  }
  const playOnce = () => {
    const c = getContext()
    if (!c || !offerLoopBus) return
    resumeContext()
    if (c.state === 'running') {
      try {
        fallbackAudio?.pause()
      } catch {
        undefined
      }
      playWebAudioAlarm(c, offerLoopBus)
      return
    }
    void c.resume().then(() => {
      if (c.state === 'running' && offerLoopBus) playWebAudioAlarm(c, offerLoopBus)
    }).catch(() => {
      // Web Audio가 잠긴 환경 — HTMLAudio 폴백으로 반복 재생.
      try {
        if (!fallbackAudio) fallbackAudio = new Audio(buildFallbackWavUri())
        fallbackAudio.loop = true
        fallbackAudio.currentTime = 0
        void fallbackAudio.play().catch(() => undefined)
      } catch {
        undefined
      }
    })
  }
  playOnce()
  offerLoopTimer = window.setInterval(playOnce, 2800)
  // 오퍼 만료·UI 종료 경로를 놓쳐도 무한 반복되지 않게 하는 안전 상한.
  offerLoopGuard = window.setTimeout(() => stopDriverOfferAlarm(), 120000)
}

export function vibrateDriverOffer() {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate([450, 150, 450, 150, 700])
  } catch {
    undefined
  }
}

// Deduped across watcher + dashboard so the same offer never rings twice.
// The alarm now loops until stopDriverOfferAlarm() (user interaction, offer
// cleared/expired, or the safety cap) — 기사가 확인할 때까지 울리는 콜 벨.
export function alertDriverOffer(rideId: string) {
  const now = Date.now()
  const key = `offer:${rideId}`
  if (key === lastAlertKey && now - lastAlertAt < 60000) return
  lastAlertAt = now
  startOfferAlarmLoop()
  lastAlertKey = key
  vibrateDriverOffer()
}

type WakeLockSentinel = {
  release: () => Promise<void>
  addEventListener?: (type: string, listener: () => void) => void
}
let wakeLock: WakeLockSentinel | null = null

export async function acquireDriverWakeLock() {
  if (typeof navigator === 'undefined' || wakeLock) return
  const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } }
  if (typeof nav.wakeLock?.request !== 'function') return
  try {
    const sentinel = await nav.wakeLock.request('screen')
    wakeLock = sentinel
    sentinel.addEventListener?.('release', () => {
      if (wakeLock === sentinel) wakeLock = null
    })
  } catch {
    wakeLock = null
  }
}

export async function releaseDriverWakeLock() {
  const sentinel = wakeLock
  wakeLock = null
  try {
    await sentinel?.release()
  } catch {
    undefined
  }
}
