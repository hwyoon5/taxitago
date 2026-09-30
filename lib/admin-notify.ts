export type SupportNotifyKind = 'ticket' | 'lost' | 'sos'

const KIND_LABEL: Record<SupportNotifyKind, string> = {
  ticket: '1:1 문의',
  lost: '분실물 접수',
  sos: '긴급 SOS',
}

export async function notifySupportInbox(input: {
  kind: SupportNotifyKind
  id: string
  title: string
  detail: string
  from: string
}) {
  const label = KIND_LABEL[input.kind]
  const text = [`[택시타고 고객센터] ${label} 접수`, input.title, input.detail, `접수자: ${input.from}`, `ID: ${input.id}`]
    .filter(Boolean)
    .join('\n')
    .slice(0, 3000)

  const tasks: Promise<unknown>[] = []

  const webhook = process.env.SUPPORT_WEBHOOK_URL?.trim()
  if (webhook) {
    tasks.push(
      fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, kind: input.kind, id: input.id, title: input.title, detail: input.detail, from: input.from }),
        signal: AbortSignal.timeout(8000),
      }),
    )
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim()
  if (botToken && chatId) {
    tasks.push(
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(8000),
      }),
    )
  }

  await Promise.allSettled(tasks)
}
