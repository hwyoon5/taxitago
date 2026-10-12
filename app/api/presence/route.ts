import { NextResponse } from 'next/server'
import { beatPresence, PRESENCE_ROLES, type PresenceRole } from '@/lib/presence-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 앱 접속 하트비트 — 익명이지만 역할·식별자만 받고 개인정보는 저장하지 않는다. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const id = typeof body?.id === 'string' ? body.id.trim().slice(0, 128) : ''
  const role = typeof body?.role === 'string' ? body.role : ''
  if (!id || !(PRESENCE_ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: 'id and valid role required' }, { status: 400 })
  }
  await beatPresence(id, role as PresenceRole)
  return NextResponse.json({ ok: true })
}
