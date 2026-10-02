const fs = require('fs')
const classes = fs.readFileSync('data/color-classes.txt', 'utf8').trim().split('\n')
const hex2rgb = (h) => {
  h = h.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const lum = ([r, g, b]) => {
  const f = (c) => {
    c /= 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const mix = (a, b, t) => {
  const A = hex2rgb(a)
  const B = hex2rgb(b)
  const r = Math.round(A[0] * (1 - t) + B[0] * t)
  const g = Math.round(A[1] * (1 - t) + B[1] * t)
  const bl = Math.round(A[2] * (1 - t) + B[2] * t)
  return '#' + [r, g, bl].map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('')
}
const esc = (c) => c.replace(/([\[\]#])/g, '\\$1')
const out = []
for (const cls of classes) {
  const m = cls.match(/^(bg|text|border|divide|ring|from|to|via|placeholder)-\[(#[0-9A-Fa-f]{3,8})\]$/)
  if (!m) continue
  const [, prop, hex] = m
  const L = lum(hex2rgb(hex))
  let target = null
  if (prop === 'bg') {
    if (L >= 0.9) target = mix(hex, '#0B1220', 0.9)
    else if (L >= 0.78) target = mix(hex, '#0B1220', 0.85)
    else if (L >= 0.6) target = mix(hex, '#0B1220', 0.78)
    else if (L >= 0.45) target = mix(hex, '#0B1220', 0.55)
  } else if (prop === 'text') {
    if (L < 0.18) target = mix(hex, '#FFFFFF', 0.82)
    else if (L < 0.32) target = mix(hex, '#FFFFFF', 0.6)
    else if (L < 0.5) target = mix(hex, '#FFFFFF', 0.4)
  } else if (prop === 'border' || prop === 'divide' || prop === 'ring') {
    if (L >= 0.75) target = mix(hex, '#0B1220', 0.72)
    else if (L >= 0.6) target = mix(hex, '#0B1220', 0.55)
  } else {
    if (L >= 0.8) target = mix(hex, '#0B1220', 0.85)
  }
  if (!target) continue
  const propName = {
    bg: 'background-color',
    text: 'color',
    border: 'border-color',
    divide: 'border-color',
    ring: '--tw-ring-color',
    from: '--tw-gradient-from',
    to: '--tw-gradient-to',
    via: '--tw-gradient-to',
  }[prop] || prop
  if (prop === 'from') {
    out.push(`.dark .${esc(cls)}{--tw-gradient-from:${target};--tw-gradient-to:${target}00;--tw-gradient-stops:var(--tw-gradient-from),var(--tw-gradient-to)}`)
  } else if (prop === 'via') {
    out.push(`.dark .${esc(cls)}{--tw-gradient-to:${target}00;--tw-gradient-stops:var(--tw-gradient-from),${target},var(--tw-gradient-to)}`)
  } else if (prop === 'to') {
    out.push(`.dark .${esc(cls)}{--tw-gradient-to:${target}}`)
  } else {
    out.push(`.dark .${esc(cls)}{${propName}:${target}}`)
  }
}
// Non-hex utility fallbacks used across the app
out.push('.dark .bg-white{background-color:#0F172A}')
out.push('.dark .text-black{color:#F1F5F9}')
out.push('.dark .bg-slate-50{background-color:#111C30}')
out.push('.dark .bg-gray-50{background-color:#111C30}')
out.push('.dark .text-white\\/70{color:rgba(226,232,240,0.7)}')
out.push('.dark .text-white\\/80{color:rgba(226,232,240,0.8)}')
out.push('.dark .bg-white\\/10{background-color:rgba(255,255,255,0.08)}')
out.push('.dark .bg-black\\/20{background-color:rgba(0,0,0,0.35)}')
out.push('.dark .bg-black\\/40{background-color:rgba(0,0,0,0.55)}')
out.push('.dark .border-white\\/10{border-color:rgba(255,255,255,0.12)}')
fs.writeFileSync('data/dark-overrides.css', out.join('\n') + '\n')
console.log(out.length + ' rules written')
