import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { DEFAULT_FARE_CONFIG, normalizeFareConfig, type FareConfig } from '@/lib/fare-config'

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const CONFIG_KEY = 'taxitago:fare:config'
const filePath = path.join(process.cwd(), 'data', 'fare-config.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoFareConfig?: FareConfig }

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

async function kvGet<T>(key: string): Promise<T | null> {
  const raw = await kvCommand<string | null>(['GET', key])
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function readFileConfig(): FareConfig | null {
  try {
    if (!existsSync(filePath)) return null
    return normalizeFareConfig(JSON.parse(readFileSync(filePath, 'utf8')) as Partial<FareConfig>)
  } catch {
    return null
  }
}

export async function getFareConfig(): Promise<FareConfig> {
  if (useKv) return normalizeFareConfig(await kvGet<Partial<FareConfig>>(CONFIG_KEY))
  if (!globalStore.__taxitagoFareConfig) {
    globalStore.__taxitagoFareConfig = readFileConfig() ?? { ...DEFAULT_FARE_CONFIG }
  }
  return globalStore.__taxitagoFareConfig
}

export async function saveFareConfig(input: Partial<FareConfig>): Promise<FareConfig> {
  const next = normalizeFareConfig(input)
  globalStore.__taxitagoFareConfig = next
  if (useKv) {
    await kvCommand(['SET', CONFIG_KEY, JSON.stringify(next)])
    return next
  }
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf8')
  } catch {
    undefined
  }
  return next
}
