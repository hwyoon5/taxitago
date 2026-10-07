import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

/**
 * txid → 결제 kind 레지스트리.
 * /api/pi/complete이 검증에 성공하는 순간 기록된다 — 입금 스캐너가
 * 서비스 결제(탑승비 등)를 '사용자 입금'으로 오인해 잔액을 되돌려 주는
 * 이중 크레딧을 막는 안전장치다.
 */

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const KINDS_KEY = 'taxitago:payment-kinds'
const MAX_ENTRIES = 4000
const filePath = path.join(process.cwd(), 'data', 'payment-kinds.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoPaymentKinds?: Record<string, string> }
if (!globalStore.__taxitagoPaymentKinds) globalStore.__taxitagoPaymentKinds = {}

function readFileMap(): Record<string, string> {
  try {
    if (!existsSync(filePath)) return {}
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { kinds?: Record<string, string> }
    return parsed.kinds && typeof parsed.kinds === 'object' ? parsed.kinds : {}
  } catch {
    return {}
  }
}

function writeFileMap(kinds: Record<string, string>) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ kinds }, null, 2), 'utf8')
  } catch {
    undefined
  }
}

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

async function readKinds(): Promise<Record<string, string>> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', KINDS_KEY])
    if (!raw) return {}
    try {
      const parsed = JSON.parse(raw) as Record<string, string>
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  if (!Object.keys(globalStore.__taxitagoPaymentKinds!).length) globalStore.__taxitagoPaymentKinds = readFileMap()
  return globalStore.__taxitagoPaymentKinds!
}

async function writeKinds(kinds: Record<string, string>) {
  const keys = Object.keys(kinds)
  const trimmed = keys.length > MAX_ENTRIES ? Object.fromEntries(keys.slice(-MAX_ENTRIES).map((k) => [k, kinds[k]])) : kinds
  if (useKv) {
    await kvCommand(['SET', KINDS_KEY, JSON.stringify(trimmed)])
    return
  }
  globalStore.__taxitagoPaymentKinds = trimmed
  writeFileMap(trimmed)
}

/** 'wallet-charge' 만이 이용자 잔액 입금 — 나머지는 서비스 결제로 분류된다. */
export function isDepositPaymentKind(kind: string) {
  return kind === 'wallet-charge' || kind === ''
}

export async function markPaymentKind(txid: string, kind: string) {
  const id = txid.trim()
  if (!id || !kind.trim()) return
  const kinds = await readKinds()
  if (kinds[id]) return // 첫 등록이 우선 — 서비스 결제가 입금으로 뒤바뀌지 않게 한다.
  kinds[id] = kind.trim()
  await writeKinds(kinds)
}

export async function paymentKindOf(txid: string): Promise<string> {
  const kinds = await readKinds()
  return kinds[txid.trim()] ?? ''
}

/** 서비스 결제로 확정된 txid 집합 — 입금 장부/크레딧에서 제외한다. */
export async function knownServiceTxids(): Promise<Set<string>> {
  const kinds = await readKinds()
  return new Set(Object.entries(kinds).filter(([, kind]) => !isDepositPaymentKind(kind)).map(([txid]) => txid))
}
