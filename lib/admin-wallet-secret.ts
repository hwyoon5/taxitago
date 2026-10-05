/**
 * 관리자 수수료 출금 지갑 서명 시드 해석기.
 *
 * Vercel/로컬 환경 변수:
 *   PI_ADMIN_WALLET_SECRET — Pi 지갑 비밀 시드 (S로 시작하는 56자, 서버 전용)
 *
 * 구형 이름 ADMIN_WALLET_SECRET_PHRASE 도 호환으로 인식한다.
 * 절대 NEXT_PUBLIC_ 접두사를 붙이지 않는다 — 브라우저 번들로 새어나가면 안 된다.
 */
export const ADMIN_WALLET_SECRET_ENV = 'PI_ADMIN_WALLET_SECRET'

export function adminWalletSecret(): string {
  return (process.env.PI_ADMIN_WALLET_SECRET || process.env.ADMIN_WALLET_SECRET_PHRASE || '').trim()
}
