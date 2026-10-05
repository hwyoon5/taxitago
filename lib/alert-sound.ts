// Lightweight Web Audio alert tones for ride comms events — no audio assets needed.
let audioCtx: AudioContext | null = null

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

export function playCommsAlert(kind: 'message' | 'call') {
  try {
    const audio = getCtx()
    if (!audio) return
    if (audio.state === 'suspended') void audio.resume()
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
  } catch {
    undefined
  }
}
