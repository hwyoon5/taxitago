import { kvCommand, kvConfigured } from '@/lib/kv'

/**
 * 관리자 접속 현황 — 로그인한 직원이 관리자 화면에 머무는 동안 주기적으로
 * 하트비트를 보내면 '근무 중'으로 표시된다. 교대 근무 전 지금 누가 접속해
 * 있는지 확인하는 용도.
 *
 * KV(HASH)에 직원별 마지막 비트를 저장하고 ONLINE_WINDOW를 넘긴 항목은
 * 읽을 때 정리한다. KV가 없으면 프로세스 메모리로 폴백한다(인스턴스별 집계
 * 한계는 사용자 presence와 동일).
 */
export type StaffPresence = {
  staffId: string
  staffName: string
  position: string
  lastSeen: number
}

const ONLINE_WINDOW_MS = 90_000
const HASH_KEY = 'taxitago:admin-presence'

const mem = globalThis as typeof globalThis & { __taxitagoAdminPresence?: Map<string, StaffPresence> }
if (!mem.__taxitagoAdminPresence) mem.__taxitagoAdminPresence = new Map()

function pruneMemory(now: number) {
  for (const [id, entry] of mem.__taxitagoAdminPresence!) {
    if (now - entry.lastSeen > ONLINE_WINDOW_MS) mem.__taxitagoAdminPresence!.delete(id)
  }
}

/** 하트비트 기록 — 30초 주기로 호출된다. */
export async function beatStaffPresence(input: { staffId: string; staffName: string; position?: string }): Promise<void> {
  const entry: StaffPresence = {
    staffId: input.staffId,
    staffName: input.staffName || input.staffId,
    position: (input.position || '').trim(),
    lastSeen: Date.now(),
  }
  if (kvConfigured) {
    try {
      await kvCommand(['HSET', HASH_KEY, entry.staffId, JSON.stringify(entry)])
      return
    } catch {
      // KV 장애 시에도 메모리 폴백으로 계속 기록한다.
    }
  }
  mem.__taxitagoAdminPresence!.set(entry.staffId, entry)
}

/** 접속 종료(로그아웃·탭 닫기) — 남은 표시를 즉시 지운다. */
export async function dropStaffPresence(staffId: string): Promise<void> {
  if (kvConfigured) {
    try {
      await kvCommand(['HDEL', HASH_KEY, staffId])
      return
    } catch {
      // 메모리 폴백으로 계속한다.
    }
  }
  mem.__taxitagoAdminPresence!.delete(staffId)
}

/** 현재 근무 중인 직원 목록 — 만료 항목을 정리한 뒤 이름순으로 돌려준다. */
export async function listStaffPresence(): Promise<StaffPresence[]> {
  const now = Date.now()
  if (kvConfigured) {
    try {
      const raw = await kvCommand<Record<string, string> | string[] | null>(['HGETALL', HASH_KEY])
      const values = Array.isArray(raw)
        ? raw.filter((_, index) => index % 2 === 1)
        : raw && typeof raw === 'object'
          ? Object.values(raw)
          : []
      const online: StaffPresence[] = []
      const stale: string[] = []
      for (const value of values) {
        try {
          const entry = JSON.parse(value) as StaffPresence
          if (entry && typeof entry.staffId === 'string' && now - entry.lastSeen <= ONLINE_WINDOW_MS) {
            online.push(entry)
          } else if (entry && typeof entry.staffId === 'string') {
            stale.push(entry.staffId)
          }
        } catch {
          undefined
        }
      }
      if (stale.length) await kvCommand(['HDEL', HASH_KEY, ...stale]).catch(() => undefined)
      return online.sort((a, b) => a.staffName.localeCompare(b.staffName, 'ko'))
    } catch {
      // KV 실패 시 이 인스턴스 메모리 값으로라도 응답한다.
    }
  }
  pruneMemory(now)
  return [...mem.__taxitagoAdminPresence!.values()].sort((a, b) => a.staffName.localeCompare(b.staffName, 'ko'))
}
