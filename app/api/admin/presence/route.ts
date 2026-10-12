import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { beatStaffPresence, dropStaffPresence, listStaffPresence } from '@/lib/admin-presence-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET — 현재 근무 중(최근 90초 내 하트비트)인 관리자 목록. */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const staff = await listStaffPresence()
  return NextResponse.json({ ok: true, staff, self: actor.staffId })
}

/** POST — 접속 하트비트. 관리자 화면이 열려 있는 동안 30초 주기로 호출된다. */
export async function POST(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await beatStaffPresence({ staffId: actor.staffId, staffName: actor.staffName, position: actor.position })
  return NextResponse.json({ ok: true })
}

/** DELETE — 로그아웃·화면 종료 시 접속 표시를 즉시 지운다. */
export async function DELETE(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await dropStaffPresence(actor.staffId)
  return NextResponse.json({ ok: true })
}
