import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { requiredComplianceDocs, type ComplianceDocType } from '@/lib/partner-services'

/**
 * 파트너 자격 인증(컴플라이언스) 서류 스토어 — 운전면허증·화물운송종사자
 * 자격증·차량 등록증의 업로드 원본과 심사 상태(pending/approved/rejected)를
 * uid별로 영속한다. 가입자 레지스트리처럼 전역 스코프(네트워크 무관)다.
 */
export type ComplianceStatus = 'pending' | 'approved' | 'rejected'

export type ComplianceDoc = {
  name: string
  mime: string
  dataUrl: string
  uploadedAt: string
  status: ComplianceStatus
  reviewedBy?: string
  reviewedAt?: string
  /** 반려 사유 — 재제출 안내 문구로 이용자에게도 노출된다. */
  reviewNote?: string
}

/** uid별 서류 묶음 — 제출된 타입만 들어있다(미제출 타입은 키 자체가 없음). */
export type ComplianceRecord = Partial<Record<ComplianceDocType, ComplianceDoc>>

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const docKey = (uid: string) => `taxitago:compdoc:${uid}`
const dirPath = path.join(process.cwd(), 'data', 'compliance-docs')
const filePath = (uid: string) => path.join(dirPath, `${uid.replace(/[^\w-]/g, '_')}.json`)

/** ~2.5MB binary → ~3.4M base64 chars; 보험증권 업로드와 동일 상한. */
const MAX_DATAURL_CHARS = 3_500_000
const MIME_OK = /^image\/|^application\/pdf$/

const globalStore = globalThis as typeof globalThis & { __taxitagoCompliance?: Map<string, ComplianceRecord> }
if (!globalStore.__taxitagoCompliance) globalStore.__taxitagoCompliance = new Map()

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

function readFileRecord(uid: string): ComplianceRecord {
  try {
    const target = filePath(uid)
    if (!existsSync(target)) return {}
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as { docs?: ComplianceRecord }
    return parsed?.docs && typeof parsed.docs === 'object' ? parsed.docs : {}
  } catch {
    return {}
  }
}

function writeFileRecord(uid: string, record: ComplianceRecord) {
  try {
    mkdirSync(dirPath, { recursive: true })
    writeFileSync(filePath(uid), JSON.stringify({ docs: record }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

async function writeRecord(uid: string, record: ComplianceRecord) {
  globalStore.__taxitagoCompliance!.set(uid, record)
  if (useKv) {
    await kvCommand(['SET', docKey(uid), JSON.stringify(record)])
    return
  }
  writeFileRecord(uid, record)
}

export async function getCompliance(uid: string): Promise<ComplianceRecord> {
  const id = uid.trim()
  if (!id) return {}
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', docKey(id)]).catch(() => null)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ComplianceRecord
        if (parsed && typeof parsed === 'object') return parsed
      } catch {
        undefined
      }
    }
  }
  return globalStore.__taxitagoCompliance!.get(id) ?? readFileRecord(id)
}

/** 서류 업로드 — 새 파일이 올라오면 심사 상태는 항상 'pending'으로 되돌아간다. */
export async function saveComplianceDoc(
  uid: string,
  type: ComplianceDocType,
  input: { name: string; mime: string; dataUrl: string },
): Promise<ComplianceDoc | null> {
  const id = uid.trim()
  if (!id || id.length > 64 || !/^[\w-]+$/.test(id)) return null
  const doc: ComplianceDoc = {
    name: input.name.slice(0, 120) || `${type}-document`,
    mime: input.mime,
    dataUrl: input.dataUrl,
    uploadedAt: new Date().toISOString(),
    status: 'pending',
  }
  if (!MIME_OK.test(doc.mime)) return null
  if (!doc.dataUrl.startsWith(`data:${doc.mime}`) || doc.dataUrl.length > MAX_DATAURL_CHARS) return null
  const record = await getCompliance(id)
  await writeRecord(id, { ...record, [type]: doc })
  return doc
}

/** 관리자 심사 — 승인/반려와 심사자·사유·시각을 기록한다. */
export async function setComplianceDocStatus(
  uid: string,
  type: ComplianceDocType,
  status: Exclude<ComplianceStatus, 'pending'>,
  meta: { by?: string; note?: string } = {},
): Promise<ComplianceDoc | null> {
  const record = await getCompliance(uid)
  const doc = record[type]
  if (!doc) return null
  const next: ComplianceDoc = {
    ...doc,
    status,
    reviewedBy: (meta.by || '').slice(0, 60),
    reviewedAt: new Date().toISOString(),
    reviewNote: status === 'rejected' ? (meta.note || '').slice(0, 300) : undefined,
  }
  await writeRecord(uid.trim(), { ...record, [type]: next })
  return next
}

export type ComplianceGate = {
  ok: boolean
  /** 'compliant' 전원 승인 · 'pending' 미제출/심사 중 · 'rejected' 하나 이상 반려 */
  status: 'compliant' | 'pending' | 'rejected' | 'none'
  required: ComplianceDocType[]
  /** 미제출 타입. */
  missing: ComplianceDocType[]
  pending: ComplianceDocType[]
  rejected: ComplianceDocType[]
}

/**
 * 접근 제어 게이트 — 수행 역할이 요구하는 서류가 전부 'approved'여야 ok.
 * 시설형 파트너 등 필수 서류가 없는 계정은 'none'으로 통과한다.
 */
export async function complianceGate(
  source: { uid: string; serviceType?: string | null; serviceRoles?: string[] | null },
): Promise<ComplianceGate> {
  const required = requiredComplianceDocs(source)
  if (!required.length) {
    return { ok: true, status: 'none', required, missing: [], pending: [], rejected: [] }
  }
  const record = await getCompliance(source.uid)
  const missing: ComplianceDocType[] = []
  const pending: ComplianceDocType[] = []
  const rejected: ComplianceDocType[] = []
  for (const type of required) {
    const doc = record[type]
    if (!doc) missing.push(type)
    else if (doc.status === 'rejected') rejected.push(type)
    else if (doc.status !== 'approved') pending.push(type)
  }
  if (rejected.length) return { ok: false, status: 'rejected', required, missing, pending, rejected }
  if (missing.length || pending.length) return { ok: false, status: 'pending', required, missing, pending, rejected }
  return { ok: true, status: 'compliant', required, missing, pending, rejected }
}
