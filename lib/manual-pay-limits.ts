/**
 * 기사 '승객에게 받을 금액'(현장 수동 결제) 입력 한도 — 클라이언트 모달과
 * /api/manual-pay 서버 라우트가 같은 상수를 공유한다.
 * 상한을 바꿀 때는 여기만 수정하면 양쪽에 동시에 반영된다.
 */
export const MANUAL_PAY_MAX_PI = 50

/** 소수점 이하 입력 자릿수 상한 — Pi 표시 단위(7자리)와 동일. */
export const MANUAL_PAY_MAX_DECIMALS = 7

/** 입력 문자열 정제 — 숫자·소수점 외 제거, 소수점 하나, 소수부 7자리까지. */
export function sanitizeManualPayAmount(raw: string): string {
  let value = raw.replace(/[^0-9.]/g, '')
  const dot = value.indexOf('.')
  if (dot >= 0) {
    const head = value.slice(0, dot + 1)
    const decimals = value.slice(dot + 1).replace(/\./g, '').slice(0, MANUAL_PAY_MAX_DECIMALS)
    value = head + decimals
  }
  return value
}

/** 서버/제출 시점 검증 — 유효하면 null, 아니면 거절 사유 키를 돌려준다. */
export function manualPayAmountError(amount: number): 'invalid' | 'too_large' | 'too_precise' | null {
  if (!Number.isFinite(amount) || amount <= 0) return 'invalid'
  if (amount > MANUAL_PAY_MAX_PI) return 'too_large'
  // float 오차 허용하되 소수부 7자리 초과는 거절한다.
  if (Math.abs(amount - Math.round(amount * 10 ** MANUAL_PAY_MAX_DECIMALS) / 10 ** MANUAL_PAY_MAX_DECIMALS) > 1e-12) {
    return 'too_precise'
  }
  return null
}
