import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { isPiWalletAddress } from '@/lib/pi-wallet'

/** Fallback shown until a real testnet address is configured (never a valid wallet). */
export const DEFAULT_ADMIN_WALLET = 'PI_DEMO_ADMIN_WALLET_999_TAXI_TAGO'

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const WALLET_KEY = 'taxitago:admin:wallet'
const filePath = path.join(process.cwd(), 'data', 'admin-wallet.json')

const globalStore = globalThis as typeof globalThis & { __taxitagoAdminWallet?: string }

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

function normalizeWallet(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || DEFAULT_ADMIN_WALLET
}

function readFileWallet(): string | null {
  try {
    if (!existsSync(filePath)) return null
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { address?: unknown }
    const text = normalizeWallet(parsed.address)
    return text === DEFAULT_ADMIN_WALLET && !parsed.address ? null : text
  } catch {
    return null
  }
}

export async function getAdminWallet(): Promise<string> {
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', WALLET_KEY])
    return normalizeWallet(raw)
  }
  if (globalStore.__taxitagoAdminWallet === undefined) {
    globalStore.__taxitagoAdminWallet = readFileWallet() ?? DEFAULT_ADMIN_WALLET
  }
  return globalStore.__taxitagoAdminWallet
}

export async function saveAdminWallet(input: unknown): Promise<string> {
  const next = normalizeWallet(input)
  // Only real testnet/mainnet addresses may be persisted — the demo
  // placeholder can never be re-saved through this path.
  if (!isPiWalletAddress(next)) throw new Error('invalid_wallet_address')
  globalStore.__taxitagoAdminWallet = next
  if (useKv) {
    await kvCommand(['SET', WALLET_KEY, next])
    return next
  }
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ address: next }, null, 2), 'utf8')
  } catch {
    undefined
  }
  return next
}
