import { recordSettlement } from '@/lib/settlement-store'
import { payoutSettlementNet } from '@/lib/settlement-payout'
import { driverPayoutTarget } from '@/lib/escrow-engine'
import { hydrateDispatchFromKv } from '@/lib/dispatch-store'
import type { SettlementService } from '@/lib/settlement-types'

const SERVICE_KEYS: SettlementService[] = ['taxi', 'daeri', 'delivery', 'bicycle', 'kickboard', 'ev', 'parking']

const LABEL_SERVICE: [RegExp, SettlementService][] = [
  [/자전거/, 'bicycle'],
  [/킥보드|퀵보드/, 'kickboard'],
  [/EV\s*충전|EV충전|충전/, 'ev'],
  [/주차/, 'parking'],
  [/대리/, 'daeri'],
  [/택배|배송/, 'delivery'],
  [/택시|프리미엄|일반/, 'taxi'],
]

function serviceFromMetadata(metadata: Record<string, unknown>): SettlementService | null {
  const explicit = metadata.service ?? metadata.serviceKey
  if (typeof explicit === 'string' && SERVICE_KEYS.includes(explicit as SettlementService)) {
    return explicit as SettlementService
  }
  const label = typeof metadata.label === 'string' ? metadata.label : ''
  for (const [pattern, service] of LABEL_SERVICE) {
    if (pattern.test(label)) return service
  }
  return null
}

/**
 * Records a platform settlement entry when a service payment completes.
 * Only `kind: 'service-pay'` payments are booked; idempotent by `pay:{paymentId}`.
 */
export async function handleServicePaymentComplete(input: {
  paymentId: string
  txid?: string
  amount?: number | null
  metadata?: Record<string, unknown> | null
}) {
  const paymentId = input.paymentId.trim()
  if (!paymentId) return null
  const metadata = input.metadata ?? {}
  if (metadata.kind !== 'service-pay') return null
  const service = serviceFromMetadata(metadata)
  if (!service) return null
  // 쿠폰 할인은 플랫폼 부담 — 실결제액이 아니라 쿠폰 적용 전 요금(grossAmount)을
  // 정산 기준으로 쓰도록 클라이언트가 메타데이터로 전달한다. 없으면 결제액.
  const metaGross = typeof metadata.grossAmount === 'number' ? metadata.grossAmount : 0
  const gross = Number(input.amount) > 0 && metaGross > 0 && metaGross > Number(input.amount)
    ? metaGross
    : Number(input.amount)
  if (!Number.isFinite(gross) || gross <= 0) return null
  const place = typeof metadata.place === 'string' ? metadata.place.trim() : ''
  const label = typeof metadata.label === 'string' ? metadata.label.trim() : ''
  const partnerId = typeof metadata.partnerId === 'string' ? metadata.partnerId.trim() : ''
  const partnerName = typeof metadata.partnerName === 'string' ? metadata.partnerName.trim() : ''
  const deviceId = typeof metadata.deviceId === 'string' ? metadata.deviceId.trim() : ''
  if (partnerId) await hydrateDispatchFromKv().catch(() => undefined)
  // No linked partner → deterministic platform wallet so the 90/10 split is
  // still recorded instead of leaving the driver leg blank.
  const driverWallet = driverPayoutTarget(partnerId || 'platform').wallet
  const entry = await recordSettlement({
    refId: `pay:${paymentId}`,
    service,
    driverId: partnerId || 'platform',
    driverName: partnerName || place || '서비스 파트너',
    memo: [label || '서비스 결제', deviceId ? `기기 ${deviceId}` : '', place, input.txid ? `txid ${input.txid.slice(0, 10)}` : ''].filter(Boolean).join(' · '),
    gross,
    driverWallet,
    channel: 'inapp',
  })
  // 승객 결제는 플랫폼 지갑에 입금되므로, 수수료를 뺀 net을 파트너에게 A2U 송금한다.
  if (entry && partnerId) {
    await payoutSettlementNet(entry, `${label || '서비스 결제'} 정산`).catch(() => null)
  }
  return entry
}
