import { kvCommand, kvConfigured } from '@/lib/kv'

/**
 * 근무 교대 인수인계 보드 — 교대·파트타임 직원이 다음 근무자에게 전달할
 * 특이사항/처리 대기 문의/공지를 남기는 공용 게시판.
 * append-only + 본인(또는 상위 직급) 삭제라 동시성 충돌이 없고, 최신 200건만 유지한다.
 */
export type ShiftTag = '특이사항' | '처리대기' | '공지'
export const SHIFT_TAGS: ShiftTag[] = ['특이사항', '처리대기', '공지']

export type ShiftEntry = {
  id: string
  staffId: string
  staffName: string
  position: string
  tag: ShiftTag
  text: string
  createdAt: string
}

const LIST_KEY = 'taxitago:admin:shiftboard'
const MAX_ENTRIES = 200
export const SHIFT_TEXT_MAX = 500

const mem = globalThis as typeof globalThis & { __taxitagoShiftBoard?: ShiftEntry[] }
if (!mem.__taxitagoShiftBoard) mem.__taxitagoShiftBoard = []

export async function listShiftBoard(limit = 100): Promise<ShiftEntry[]> {
  if (kvConfigured) {
    try {
      const raw = await kvCommand<string[] | null>(['LRANGE', LIST_KEY, 0, Math.max(0, limit - 1)])
      if (Array.isArray(raw)) {
        return raw
          .map((value) => {
            try {
              return JSON.parse(value) as ShiftEntry
            } catch {
              return null
            }
          })
          .filter((entry): entry is ShiftEntry => Boolean(entry && typeof entry.id === 'string'))
      }
    } catch {
      // KV 실패 시 메모리 폴백으로 응답한다.
    }
  }
  return mem.__taxitagoShiftBoard!.slice(0, limit)
}

export async function addShiftEntry(input: {
  staffId: string
  staffName: string
  position?: string
  tag: ShiftTag
  text: string
}): Promise<ShiftEntry> {
  const entry: ShiftEntry = {
    id: crypto.randomUUID(),
    staffId: input.staffId,
    staffName: input.staffName || input.staffId,
    position: (input.position || '').trim(),
    tag: input.tag,
    text: input.text.slice(0, SHIFT_TEXT_MAX),
    createdAt: new Date().toISOString(),
  }
  if (kvConfigured) {
    try {
      await kvCommand(['LPUSH', LIST_KEY, JSON.stringify(entry)])
      await kvCommand(['LTRIM', LIST_KEY, 0, MAX_ENTRIES - 1])
      return entry
    } catch {
      // KV 장애 시 메모리 폴백으로 계속 기록한다.
    }
  }
  mem.__taxitagoShiftBoard!.unshift(entry)
  if (mem.__taxitagoShiftBoard!.length > MAX_ENTRIES) mem.__taxitagoShiftBoard!.length = MAX_ENTRIES
  return entry
}

export async function removeShiftEntry(id: string): Promise<ShiftEntry | null> {
  if (kvConfigured) {
    try {
      const all = await listShiftBoard(MAX_ENTRIES)
      const found = all.find((entry) => entry.id === id)
      if (!found) return null
      // LREM count=1 — 값이 정확히 일치하는 첫 항목만 지운다.
      await kvCommand(['LREM', LIST_KEY, 1, JSON.stringify(found)])
      return found
    } catch {
      // 메모리 폴백으로 계속한다.
    }
  }
  const index = mem.__taxitagoShiftBoard!.findIndex((entry) => entry.id === id)
  if (index < 0) return null
  return mem.__taxitagoShiftBoard!.splice(index, 1)[0]
}
