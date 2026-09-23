const INVITE_CODE_KEY = 'taxitago-invite-code'
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomSegment(length: number) {
  const bytes = new Uint8Array(length)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')
}

function slugFromUsername(username: string) {
  const slug = username.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase()
  return slug || 'USER'
}

export function getOrCreateInviteCode(username = 'taxitago') {
  try {
    const saved = window.localStorage.getItem(INVITE_CODE_KEY)?.trim()
    if (saved) return saved
  } catch {
    undefined
  }
  const code = `TAGO-${slugFromUsername(username)}-${randomSegment(4)}`
  try {
    window.localStorage.setItem(INVITE_CODE_KEY, code)
  } catch {
    undefined
  }
  return code
}

export function inviteShareLink(code: string) {
  const origin =
    typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
      ? window.location.origin
      : ''
  return `${origin}/?invite=${encodeURIComponent(code)}`
}

export async function copyInviteCode(code: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(code)
    return
  }
  const input = document.createElement('textarea')
  input.value = code
  input.setAttribute('readonly', 'true')
  input.style.position = 'fixed'
  input.style.left = '-9999px'
  document.body.appendChild(input)
  input.select()
  document.execCommand('copy')
  document.body.removeChild(input)
}
