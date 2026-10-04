import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

export type InsuranceDoc = {
  name: string
  mime: string
  dataUrl: string
  uploadedAt: string
}

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const docKey = (uid: string) => `taxitago:insdoc:${uid}`
const dirPath = path.join(process.cwd(), 'data', 'insurance-docs')
const filePath = (uid: string) => path.join(dirPath, `${uid.replace(/[^\w-]/g, '_')}.json`)

/** ~2.5MB binary → ~3.4M base64 chars; keeps requests under the platform body limit. */
const MAX_DATAURL_CHARS = 3_500_000
const MIME_OK = /^image\/|^application\/pdf$/

const globalStore = globalThis as typeof globalThis & { __taxitagoInsuranceDocs?: Map<string, InsuranceDoc> }
if (!globalStore.__taxitagoInsuranceDocs) globalStore.__taxitagoInsuranceDocs = new Map()

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

function readFileDoc(uid: string): InsuranceDoc | null {
  try {
    const target = filePath(uid)
    if (!existsSync(target)) return null
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as InsuranceDoc
    return parsed?.dataUrl ? parsed : null
  } catch {
    return null
  }
}

/** Validate + persist. Returns the stored doc or null when input fails checks. */
export async function saveInsuranceDoc(
  uid: string,
  input: { name: string; mime: string; dataUrl: string },
): Promise<InsuranceDoc | null> {
  const doc: InsuranceDoc = {
    name: input.name.slice(0, 120) || 'insurance-document',
    mime: input.mime,
    dataUrl: input.dataUrl,
    uploadedAt: new Date().toISOString(),
  }
  if (!MIME_OK.test(doc.mime)) return null
  if (!doc.dataUrl.startsWith(`data:${doc.mime}`) || doc.dataUrl.length > MAX_DATAURL_CHARS) return null
  globalStore.__taxitagoInsuranceDocs!.set(uid, doc)
  if (useKv) {
    await kvCommand(['SET', docKey(uid), JSON.stringify(doc)])
    return doc
  }
  try {
    mkdirSync(dirPath, { recursive: true })
    writeFileSync(filePath(uid), JSON.stringify(doc), 'utf8')
  } catch {
    undefined
  }
  return doc
}

export async function getInsuranceDoc(uid: string): Promise<InsuranceDoc | null> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', docKey(uid)])
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as InsuranceDoc
        if (parsed?.dataUrl) return parsed
      } catch {
        undefined
      }
    }
  }
  const cached = globalStore.__taxitagoInsuranceDocs!.get(uid)
  return cached ?? readFileDoc(uid)
}
