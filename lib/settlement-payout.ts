import { driverPayoutTarget } from '@/lib/escrow-engine'
import { hydrateDispatchFromKv } from '@/lib/dispatch-store'
import { isPiSandboxEnv } from '@/lib/pi-sandbox'
import { createA2UPayment } from '@/lib/pi-platform'
import { markSettlementSettled } from '@/lib/settlement-store'
import { kvConfigured, kvSetNx, netKey } from '@/lib/kv'
import type { SettlementEntry } from '@/lib/settlement-types'

/**
 * 플랫폼 지갑에 입금된 결제(gross)에서 수수료를 뗀 나머지(net)를
 * 파트너에게 A2U로 송금하고 장부를 '정산 완료'로 마감한다.
 * 멱등 — refId 기준 KV SET NX + entry.status/payoutTxid 가드로 이중 송금 방지.
 * 송금 실패 시 pending으로 남겨 관리자 수동 정산 경로가 받는다.
 */

const useKv = kvConfigured

const inFlight = new Set<string>()

async function claimPayout(refId: string): Promise<boolean> {
  if (useKv) return kvSetNx(netKey(`taxitago:payout:${refId}`), 24 * 60 * 60 * 1000)
  if (inFlight.has(refId)) return false
  inFlight.add(refId)
  return true
}

export async function payoutSettlementNet(entry: SettlementEntry, memo: string): Promise<string | null> {
  // manual 채널은 기사가 현장에서 이미 전액 수령 — 송금 대상이 아니다.
  if (entry.channel === 'manual') return null
  // 이미 정산 완료됐거나 송금 흔적이 있으면 재송금하지 않는다.
  if (entry.status === 'settled' || entry.payoutTxid) return entry.payoutTxid ?? null
  if (isPiSandboxEnv()) return null
  if (entry.net <= 0) return null
  const uid = driverPayoutTarget(entry.driverId).uid
  if (!uid || uid.startsWith('virtual-') || uid.startsWith('driver-') || uid === 'platform') return null
  if (!(await claimPayout(entry.refId))) return null
  await hydrateDispatchFromKv().catch(() => undefined)
  const target = driverPayoutTarget(entry.driverId)
  if (!target.uid || target.uid.startsWith('virtual-') || target.uid.startsWith('driver-')) return null
  const payment = await createA2UPayment({
    amount: entry.net,
    memo,
    uid: target.uid,
    metadata: {
      kind: 'driver-payout',
      settlementId: entry.id,
      refId: entry.refId,
      gross: entry.gross,
      commission: entry.commission,
    },
  })
  const txid = payment.transaction?.txid || payment.identifier || ''
  await markSettlementSettled(entry.id, txid || undefined).catch(() => null)
  return txid || null
}
