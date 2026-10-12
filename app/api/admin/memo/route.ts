import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { kvCommand, kvConfigured } from '@/lib/kv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type MemoDoc = {
  content: string
  updatedAt: string
  /** 마지막 작성자 표시 — 공유 메모판에서 누가 바꿨는지 확인용. */
  updatedBy?: string
}

const MAX_MEMO_LEN = 50_000

const memoKey = (scope: 'shared' | 'mine', staffId: string) =>
  scope === 'shared' ? 'taxitago:admin:memo:shared' : `taxitago:admin:memo:staff:${staffId}`

const memoryStore = globalThis as typeof globalThis & { __taxitagoAdminMemo?: Map<string, MemoDoc> }
if (!memoryStore.__taxitagoAdminMemo) memoryStore.__taxitagoAdminMemo = new Map()

async function readMemo(scope: 'shared' | 'mine', staffId: string): Promise<MemoDoc | null> {
  const key = memoKey(scope, staffId)
  if (kvConfigured) {
    try {
      const raw = await kvCommand<string | null>(['GET', key])
      if (!raw) return null
      const parsed = JSON.parse(raw) as MemoDoc
      return parsed && typeof parsed.content === 'string' ? parsed : null
    } catch (error) {
      console.error('[admin-memo] kv read failed; using local fallback', error)
    }
  }
  return memoryStore.__taxitagoAdminMemo!.get(key) ?? null
}

async function writeMemo(scope: 'shared' | 'mine', staffId: string, doc: MemoDoc) {
  const key = memoKey(scope, staffId)
  if (kvConfigured) {
    try {
      await kvCommand(['SET', key, JSON.stringify(doc)])
      return
    } catch (error) {
      console.error('[admin-memo] kv write failed; falling back to local', error)
    }
  }
  memoryStore.__taxitagoAdminMemo!.set(key, doc)
}

/**
 * GET ?scope=shared|mine — 로그인한 관리자면 누구나 읽는다.
 * shared: 전체 관리자 공용 메모판 / mine: 내 계정(staffId) 전용 메모.
 */
export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const scope = new URL(request.url).searchParams.get('scope') === 'mine' ? 'mine' : 'shared'
  const doc = await readMemo(scope, actor.staffId)
  return NextResponse.json({ ok: true, memo: doc ?? { content: '', updatedAt: '', updatedBy: '' } })
}

/** PUT {scope, content, baseUpdatedAt} — 내용을 통째로 덮어쓰되, 조회 시점 이후
 *  다른 관리자가 먼저 저장했으면 409로 거절해 덮어쓰기 유실을 막는다. */
export async function PUT(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as
    | { scope?: unknown; content?: unknown; baseUpdatedAt?: unknown }
    | null
  const scope = body?.scope === 'mine' ? 'mine' : 'shared'
  const content = typeof body?.content === 'string' ? body.content.slice(0, MAX_MEMO_LEN) : ''
  // 낙관적 동시성 제어 — 클라이언트가 불러온 시점의 updatedAt과 다르면 충돌.
  const base = typeof body?.baseUpdatedAt === 'string' ? body.baseUpdatedAt : ''
  if (base) {
    const current = await readMemo(scope, actor.staffId)
    if (current && current.updatedAt !== base) {
      return NextResponse.json({ ok: false, error: 'conflict', memo: current }, { status: 409 })
    }
  }
  const doc: MemoDoc = {
    content,
    updatedAt: new Date().toISOString(),
    updatedBy: `${actor.staffName || actor.staffId}${actor.position ? `(${actor.position})` : ''}`,
  }
  await writeMemo(scope, actor.staffId, doc)
  return NextResponse.json({ ok: true, memo: doc })
}
