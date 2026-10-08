/**
 * Pi Network addresses are Stellar-style public keys: `G` followed by 55
 * base32 characters (56 total). Shared by the admin UI and API routes —
 * keep this module free of node-only imports.
 */
const PI_WALLET_RE = /^G[A-Z0-9]{55}$/

/**
 * 플랫폼 공식 Pi 입금 수신지 — 서버 기본값이며 클라이언트 폴백으로도 쓰인다.
 * testnet 플랫폼 지갑(PI_ADMIN_WALLET_SECRET이 파생하는 주소와 동일 계정).
 * 서버는 PI_PLATFORM_WALLET env로 무엇이든 덮어쓸 수 있다.
 */
export const PLATFORM_DEPOSIT_WALLET = 'GBBMSI2255PP7AGRHEKKAQ567H5BZ5IWGU4XV3FAXAQ67ZZ7NWWKNJDM'

export function isPiWalletAddress(value: unknown): boolean {
  return typeof value === 'string' && PI_WALLET_RE.test(value.trim())
}

/** Returns a Korean error message when the address fails the format check. */
export function piWalletError(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return '지갑 주소를 입력해 주세요.'
  if (!text.startsWith('G')) return 'Pi 지갑 주소는 영문 대문자 G로 시작해야 합니다.'
  if (text.length !== 56) return `Pi 지갑 주소는 총 56자여야 합니다. (현재 ${text.length}자)`
  if (!/^[A-Z0-9]+$/.test(text)) return 'Pi 지갑 주소는 영문 대문자와 숫자만 사용할 수 있습니다.'
  return null
}
