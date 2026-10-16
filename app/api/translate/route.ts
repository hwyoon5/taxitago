import { NextResponse } from 'next/server'
import { detectChatLang, isChatLang, translateChatTextVerbose, translateProvidersConfigured } from '@/lib/chat-translate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 단문 번역 API — 목적지 검색어·음성 인식 결과의 다국어 번역에 쓴다.
 * 채팅 번역과 같은 provider 체인(TRANSLATE_API_URL → NCP Papago → 구형 Papago)을
 * 쓰며, 번역기가 하나도 설정되지 않으면 원문을 그대로 돌려준다(기능은 유지).
 * 응답의 provider/configured로 번역이 실제 적용됐는지·왜 누락됐는지 진단할 수 있다.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    text?: unknown
    source?: unknown
    target?: unknown
  } | null
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  const targetRaw = typeof body?.target === 'string' ? body.target : null
  const target = isChatLang(targetRaw) ? targetRaw : 'ko'
  if (!text || text.length > 200) {
    return NextResponse.json({ error: 'text required (max 200 chars)' }, { status: 400 })
  }
  const sourceRaw = typeof body?.source === 'string' ? body.source : null
  const source = isChatLang(sourceRaw) ? sourceRaw : detectChatLang(text)
  const configured = translateProvidersConfigured()
  if (source === target) {
    return NextResponse.json({ ok: true, source, target, translated: text, provider: 'same-lang', configured })
  }
  const result = await translateChatTextVerbose(text, source, target).catch((error) => {
    console.warn('[api/translate] translate failed', { source, target, error })
    return null
  })
  return NextResponse.json({
    ok: true,
    source,
    target,
    translated: result?.translated || text,
    provider: result?.provider ?? null,
    configured,
  })
}
