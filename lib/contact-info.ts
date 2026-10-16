/** Primary customer-support / admin contact surfaced across terms, guide and settings pages. */
export const SUPPORT_EMAIL = 'grace837100@gmail.com'
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`

/**
 * 고객센터 전화번호 — 미수금 안내·수동 정산 유도 등 즉시 연결이 필요한 화면에
 * 노출한다. NEXT_PUBLIC_SUPPORT_PHONE env로 주입하고, 미설정 시 빈 문자열이라
 * 호출부가 이메일 문의로 폴백한다.
 */
export const SUPPORT_PHONE = (process.env.NEXT_PUBLIC_SUPPORT_PHONE || '').trim()
export const SUPPORT_TEL = SUPPORT_PHONE ? `tel:${SUPPORT_PHONE.replace(/[^\d+]/g, '')}` : ''
