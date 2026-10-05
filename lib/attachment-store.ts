import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

export type SupportAttachment = {
  id: string
  name: string
  mime: string
  dataUrl: string
  uploadedAt: string
}

export type AttachmentInput = { name: string; mime: string; dataUrl: string }

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const attachKey = (id: string) => `taxitago:attach:${id}`
const dirPath = path.join(process.cwd(), 'data', 'attachments')
const filePath = (id: string) => path.join(dirPath, `${id.replace(/[^\w-]/g, '_')}.json`)

export const MAX_ATTACHMENTS = 5
/** 클라이언트가 리사이즈/압축한 JPEG ~600KB → ~800K base64 chars 상한. */
const MAX_DATAURL_CHARS = 900_000
const MIME_OK = /^image\/(jpeg|jpg|png|webp|heic|gif)$/

const globalStore = globalThis as typeof globalThis & { __taxitagoAttachments?: Map<string, SupportAttachment[]> }
if (!globalStore.__taxitagoAttachments) globalStore.__taxitagoAttachments = new Map()

async function kvCommand<T>(command: (string | number)[]): Promise<T | null> {
  const res = await fetch(kvUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`kv request failed: ${res.status}`)
  const data = (await res.json()) as { result?: T | null }
  return data.result ?? null
}

function readFileAttachments(id: string): SupportAttachment[] {
  try {
    const target = filePath(id)
    if (!existsSync(target)) return []
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as { items?: SupportAttachment[] }
    return Array.isArray(parsed.items) ? parsed.items : []
  } catch {
    return []
  }
}

/** 입력을 검증·정규화한다. 유효하지 않은 항목은 버리고 최대 MAX_ATTACHMENTS장까지만 남긴다. */
export function sanitizeAttachments(input: unknown): AttachmentInput[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((item): item is AttachmentInput => typeof item === 'object' && item !== null)
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.slice(0, 120) || 'photo' : 'photo',
      mime: typeof item.mime === 'string' ? item.mime.trim().toLowerCase() : '',
      dataUrl: typeof item.dataUrl === 'string' ? item.dataUrl : '',
    }))
    .filter((item) => MIME_OK.test(item.mime) && item.dataUrl.startsWith(`data:${item.mime}`) && item.dataUrl.length <= MAX_DATAURL_CHARS)
    .slice(0, MAX_ATTACHMENTS)
}

/** 엔티티(문의/분실물) ID 기준으로 첨부 사진을 통째로 저장한다. 빈 배열은 아무것도 하지 않는다. */
export async function saveAttachments(entityId: string, input: AttachmentInput[]): Promise<SupportAttachment[]> {
  const items = sanitizeAttachments(input)
  if (!items.length) return []
  const now = new Date().toISOString()
  const saved: SupportAttachment[] = items.map((item) => ({ ...item, id: crypto.randomUUID(), uploadedAt: now }))
  globalStore.__taxitagoAttachments!.set(entityId, saved)
  if (useKv) {
    await kvCommand(['SET', attachKey(entityId), JSON.stringify(saved)])
    return saved
  }
  try {
    mkdirSync(dirPath, { recursive: true })
    writeFileSync(filePath(entityId), JSON.stringify({ items: saved }), 'utf8')
  } catch {
    undefined
  }
  return saved
}

export async function getAttachments(entityId: string): Promise<SupportAttachment[]> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', attachKey(entityId)])
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as SupportAttachment[]
        if (Array.isArray(parsed)) return parsed
      } catch {
        undefined
      }
    }
  }
  return globalStore.__taxitagoAttachments!.get(entityId) ?? readFileAttachments(entityId)
}
