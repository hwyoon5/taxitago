import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(input: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of input) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f]
  return out
}

/** 새 TOTP 시크릿 — 160bit(32자 Base32), Google OTP 권장 길이. */
export function randomTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) continue
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

function hotp(secret: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', secret).update(buf).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  return String(code % 10 ** digits).padStart(digits, '0')
}

/** RFC 6238 TOTP verification. Accepts ±1 step (30s) window for clock drift. */
export function verifyTotpCode(secretBase32: string, code: string, options?: { period?: number; digits?: number; window?: number }) {
  const period = options?.period ?? 30
  const digits = options?.digits ?? 6
  const window = options?.window ?? 1
  const secret = base32Decode(secretBase32)
  if (!secret.length) return false
  const normalized = code.replace(/\s+/g, '')
  if (!/^\d{6,8}$/.test(normalized)) return false
  const counter = Math.floor(Date.now() / 1000 / period)
  for (let drift = -window; drift <= window; drift += 1) {
    const candidate = hotp(secret, counter + drift, digits)
    if (candidate.length === normalized.length && timingSafeEqual(Buffer.from(candidate), Buffer.from(normalized))) {
      return true
    }
  }
  return false
}
