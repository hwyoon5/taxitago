import { randomUUID } from 'crypto'
import { piRound } from '@/lib/pi-format'
import { recordSettlement } from '@/lib/settlement-store'

/**
 * 현장 수동 결제 — 기사가 앱 배차 없이 현장 승객에게 청구하는 건.
 * 승객이 QR/링크로 Pi 결제하거나, 기사가 현장 수령을 직접 확정(수동 정산)하면
 * 정산 장부(refId ride:manual-{id})에 기록돼 기사 수익·운행 건수에 반영된다.
 */
export type ManualPayStatus = 'pending' | 'paid' | 'manual' | 'cancelled'

export type ManualPayRecord = {
  id: string
  driverId: string
  driverName: string
  driverWallet: string
  amount: number
  memo: string
  status: ManualPayStatus
  paymentId: string
  txid: string
  createdAt: string
  settledAt: string
}

const kvUrl = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '')
const kvToken = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
const useKv = Boolean(kvUrl && kvToken)

const TTL_MS = 24 * 60 * 60 * 1000
const key = (id: string) => `taxitago:manual-pay:${id}`

const globalStore = globalThis as typeof globalThis & { __taxitagoManualPay?: Map<string, ManualPayRecord> }
function localStore() {
  if (!globalStore.__taxitagoManualPay) globalStore.__taxitagoManualPay = new Map()
  return globalStore.__taxitagoManualPay
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

export async function createManualPay(input: {
  driverId: string
  driverName: string
  driverWallet: string
  amount: number
  memo: string
}): Promise<ManualPayRecord> {
  const record: ManualPayRecord = {
    id: randomUUID().replace(/-/g, '').slice(0, 16),
    driverId: input.driverId,
    driverName: input.driverName,
    driverWallet: input.driverWallet,
    amount: piRound(input.amount),
    memo: input.memo.slice(0, 60),
    status: 'pending',
    paymentId: '',
    txid: '',
    createdAt: new Date().toISOString(),
    settledAt: '',
  }
  if (useKv) await kvCommand(['SET', key(record.id), JSON.stringify(record), 'PX', TTL_MS])
  else localStore().set(record.id, record)
  return record
}

export async function getManualPay(id: string): Promise<ManualPayRecord | null> {
  const safeId = id.trim()
  if (!safeId) return null
  if (useKv) {
    const raw = await kvCommand<string | null>(['GET', key(safeId)]).catch(() => null)
    if (raw) {
      try {
        return JSON.parse(raw) as ManualPayRecord
      } catch {
        return null
      }
    }
  }
  return localStore().get(safeId) ?? null
}

async function save(record: ManualPayRecord) {
  if (useKv) await kvCommand(['SET', key(record.id), JSON.stringify(record), 'PX', TTL_MS])
  else localStore().set(record.id, record)
}

function settlementMemo(record: ManualPayRecord, via: 'pi' | 'manual') {
  return [
    via === 'pi' ? '현장 수동 결제(Pi)' : '현장 수동 정산',
    record.memo || '',
    record.txid ? `txid ${record.txid.slice(0, 10)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** 정산 장부 기록 — refId가 멱등키라 Pi 완료/수동 확정이 중복 반영되지 않는다. */
async function bookSettlement(record: ManualPayRecord, via: 'pi' | 'manual') {
  return recordSettlement({
    refId: `ride:manual-${record.id}`,
    service: 'taxi',
    driverId: record.driverId,
    driverName: record.driverName || '현장 기사',
    memo: settlementMemo(record, via),
    gross: record.amount,
    driverWallet: record.driverWallet,
  })
}

/** 기사가 "현장에서 직접 받음"을 확정 — Pi 트랜잭션 없이 정산만 기록한다. */
export async function settleManualPayByDriver(id: string, driverId: string) {
  const record = await getManualPay(id)
  if (!record || record.driverId !== driverId) return { ok: false as const, error: 'not_found' }
  if (record.status === 'paid' || record.status === 'manual') return { ok: true as const, record }
  if (record.status === 'cancelled') return { ok: false as const, error: 'cancelled' }
  record.status = 'manual'
  record.settledAt = new Date().toISOString()
  await save(record)
  await bookSettlement(record, 'manual')
  return { ok: true as const, record }
}

export async function cancelManualPay(id: string, driverId: string) {
  const record = await getManualPay(id)
  if (!record || record.driverId !== driverId) return { ok: false as const, error: 'not_found' }
  if (record.status !== 'pending') return { ok: false as const, error: 'already_processed' }
  record.status = 'cancelled'
  await save(record)
  return { ok: true as const, record }
}

/**
 * /api/pi/complete 이후 호출 — kind 'manual-settle' 결제를 해당 요청 건에
 * 귀속시켜 paid로 마감하고 정산 장부에 기록한다. paymentId 기준으로 멱등.
 */
export async function handleManualPayComplete(input: {
  paymentId: string
  txid: string
  metadata?: Record<string, unknown> | null
}) {
  const metadata = input.metadata ?? {}
  if (metadata.kind !== 'manual-settle') return null
  const manualId = typeof metadata.manualId === 'string' ? metadata.manualId.trim() : ''
  if (!manualId) return null
  const record = await getManualPay(manualId)
  if (!record) {
    console.warn('[manual-pay] complete for unknown record', { manualId, paymentId: input.paymentId })
    return null
  }
  if (record.status === 'paid' || record.status === 'manual') return record
  record.status = 'paid'
  record.paymentId = input.paymentId
  record.txid = input.txid
  record.settledAt = new Date().toISOString()
  await save(record)
  await bookSettlement(record, 'pi')
  return record
}
