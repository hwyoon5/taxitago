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

function tone(ctx: AudioContext, freq: number, start: number, duration: number, gain: number) {
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = 'square'
  osc.frequency.value = freq
  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.linearRampToValueAtTime(gain, start + 0.015)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(amp)
  amp.connect(ctx.destination)
  osc.start(start)
  osc.stop(start + duration + 0.05)
}

// Dispatch ring: high-low two-tone, 4 cycles, ~2.4s total.
function playWebAudioAlarm(ctx: AudioContext) {
  const now = ctx.currentTime + 0.03
  let cursor = now
  for (let cycle = 0; cycle < 4; cycle += 1) {
    tone(ctx, 1568, cursor, 0.16, 0.22)
    tone(ctx, 1174.66, cursor + 0.17, 0.16, 0.22)
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

export function vibrateDriverOffer() {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate([450, 150, 450, 150, 700])
  } catch {
    undefined
  }
}

// Deduped across watcher + dashboard so the same offer never rings twice.
export function alertDriverOffer(rideId: string) {
  const now = Date.now()
  const key = `offer:${rideId}`
  if (key === lastAlertKey && now - lastAlertAt < 60000) return
  lastAlertKey = key
  lastAlertAt = now
  playDriverOfferAlarm()
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
