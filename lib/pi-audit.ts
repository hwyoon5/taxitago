import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { kvCommand, kvConfigured, netFilePath, netKey } from '@/lib/kv'

/**
 * Pi 결제 승인/완료 이벤트 링 버퍼 — Vercel 함수 로그를 열지 않고도
 * /api/pi/diagnostics로 '요청이 서버에 도달했는가(received) → Pi 응답이
 * 무엇이었는가(ok/error + httpStatus)'를 확인하기 위한 최소 영속 기록이다.
 * 키·토큰 등 비밀은 절대 기록하지 않는다.
 */
export type PiAuditEvent = {
  at: string
  kind: 'approve' | 'complete' | 'cancel'
  /** received = 라우트 도달 · ok = Pi 승인/완료 성공 · error = 실패 ·
   *  pending = 동기 승인 실패 후 백그라운드 재시도가 진행 중 */
  stage: 'received' | 'ok' | 'error' | 'pending'
  paymentId: string
  network: string
  ms?: number
  httpStatus?: number
  message?: string
  /** 클라이언트 SDK가 속한 Pi 앱 인스턴스 식별자 — 백엔드 키의 앱과 불일치 판별용 */
  app?: string
}

const useKv = kvConfigured
const PI_EVENTS_KEY = netKey('taxitago:pi-events')
const MAX_EVENTS = 30
const filePath = netFilePath(path.join(process.cwd(), 'data', 'pi-events.json'))

const globalStore = globalThis as typeof globalThis & { __taxitagoPiEvents?: PiAuditEvent[] }
if (!globalStore.__taxitagoPiEvents) globalStore.__taxitagoPiEvents = []

function readFileEvents(): PiAuditEvent[] {
  try {
    if (!existsSync(filePath)) return []
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { entries?: PiAuditEvent[] }
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function writeFileEvents(entries: PiAuditEvent[]) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ entries }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function readEvents(): Promise<PiAuditEvent[]> {
  if (useKv) {
    try {
      const raw = await kvCommand<string | null>(['GET', PI_EVENTS_KEY])
      if (!raw) return []
      const parsed = JSON.parse(raw) as PiAuditEvent[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      if (!globalStore.__taxitagoPiEvents!.length) globalStore.__taxitagoPiEvents = readFileEvents()
      return globalStore.__taxitagoPiEvents!
    }
  }
  if (!globalStore.__taxitagoPiEvents!.length) globalStore.__taxitagoPiEvents = readFileEvents()
  return globalStore.__taxitagoPiEvents!
}

async function writeEvents(entries: PiAuditEvent[]) {
  const trimmed = entries.slice(-MAX_EVENTS)
  if (useKv) {
    try {
      await kvCommand(['SET', PI_EVENTS_KEY, JSON.stringify(trimmed)])
      return
    } catch {
      undefined
    }
  }
  globalStore.__taxitagoPiEvents = trimmed
  writeFileEvents(trimmed)
}

/**
 * 결제 경로는 지갑 만료 창 안에 응답해야 하므로 기록은 절대 await로 막지 않는다 —
 * 호출부에서 .catch로만 삼키는 fire-and-forget 용도.
 */
export async function recordPiEvent(event: Omit<PiAuditEvent, 'at'>) {
  const entries = await readEvents()
  entries.push({ ...event, at: new Date().toISOString() })
  await writeEvents(entries)
}

export async function listPiEvents(): Promise<PiAuditEvent[]> {
  const entries = await readEvents()
  return [...entries].sort((a, b) => b.at.localeCompare(a.at))
}
