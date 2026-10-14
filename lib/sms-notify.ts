/**
 * SMS/알림톡 발송 모듈.
 *
 * 공급자 연동은 웹훅 위임 — SMS_WEBHOOK_URL이 설정되면 { to, text }를 POST하고
 * SMS_WEBHOOK_TOKEN이 있으면 Bearer 인증을 붙인다. 미설정 환경에서는 서버
 * 로그로 대체해 호출부가 실패 없이 동작한다(개발·테스트 안전).
 */

const SMS_TIMEOUT_MS = 6000

export async function sendSmsText(to: string, text: string): Promise<'sent' | 'skipped' | 'failed'> {
  const target = to.replace(/[^0-9+]/g, '')
  if (!target) return 'skipped'
  const webhook = process.env.SMS_WEBHOOK_URL?.trim()
  if (!webhook) {
    console.log('[sms] provider not configured — message logged only', { to: target, text })
    return 'skipped'
  }
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SMS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify({ to: target, text }),
      signal: AbortSignal.timeout(SMS_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn('[sms] provider rejected', { status: res.status, to: target })
      return 'failed'
    }
    return 'sent'
  } catch (error) {
    console.warn('[sms] provider unreachable', { error: String(error), to: target })
    return 'failed'
  }
}
