import { NextResponse } from 'next/server'
import { adminActor, isAdminRequest } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import { dataNetwork, kvCommand, kvConfigured } from '@/lib/kv'
import type { PiNetworkMode } from '@/lib/pi-sandbox'
import { fetchOnchainPiBalance } from '@/lib/pi-balance'
import { getAdminWallet } from '@/lib/admin-wallet'
import { DEFAULT_ADMIN_WALLET } from '@/lib/admin-wallet'
import { getEscrow, hydrateEscrowFromKv, listAllEscrows, saveEscrow, flushEscrowPersist } from '@/lib/escrow-store'
import type { EscrowRecord, EscrowStatus } from '@/lib/escrow-types'
import { getEvSession, hydrateEvChargeFromKv, listEvSessions, saveEvSession } from '@/lib/ev-charge-store'
import type { EvChargeSession, EvChargeStatus } from '@/lib/ev-charge-types'
import { listSettlements, markAllSettlementsSettled, markSettlementSettled, updateSettlementEntry } from '@/lib/settlement-store'
import type { SettlementEntry } from '@/lib/settlement-types'
import { listAllDeliveries } from '@/lib/delivery-dispatch'
import type { DeliveryDispatch } from '@/lib/delivery-dispatch'
import { getRide, hydrateDispatchFromKv } from '@/lib/dispatch-store'
import { piRound } from '@/lib/pi-format'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Scope = PiNetworkMode

/** 스코프 네임스페이스 키 — 테스트넷은 taxitago:*, 메인넷은 taxitago:main:*. */
function scopedKey(scope: Scope, base: string) {
  return scope === 'mainnet' ? `taxitago:main:${base}` : `taxitago:${base}`
}

async function kvGetScoped<T>(scope: Scope, base: string): Promise<T | null> {
  const raw = await kvCommand<string | null>(['GET', scopedKey(scope, base)]).catch(() => null)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** 반대 스코프가 전용 KV로 물리 분리돼 있으면 현재 엔드포인트로는 읽을 수 없다. */
function crossScopeBlind(scope: Scope) {
  const suffix = scope === 'mainnet' ? 'MAINNET' : 'TESTNET'
  return Boolean(process.env[`KV_REST_API_URL_${suffix}`] && scope !== dataNetwork())
}

type Loaded = {
  escrows: EscrowRecord[]
  evSessions: EvChargeSession[]
  settlements: SettlementEntry[]
  deliveries: DeliveryDispatch[]
  wallet: string
  readable: boolean
}

async function loadScope(scope: Scope, serving: Scope): Promise<Loaded> {
  if (scope === serving) {
    await Promise.all([
      hydrateEscrowFromKv().catch(() => undefined),
      hydrateEvChargeFromKv().catch(() => undefined),
      hydrateDispatchFromKv().catch(() => undefined),
    ])
    const [settlements, deliveries, wallet] = await Promise.all([
      listSettlements().catch(() => [] as SettlementEntry[]),
      listAllDeliveries().catch(() => [] as DeliveryDispatch[]),
      getAdminWallet().catch(() => DEFAULT_ADMIN_WALLET),
    ])
    return { escrows: listAllEscrows(), evSessions: listEvSessions(), settlements, deliveries, wallet, readable: true }
  }
  // 반대 네트워크 스코프 읽기 — 같은 KV 엔드포인트를 공유할 때만 가능하다.
  // 전용 KV_REST_API_URL_*이 설정된 네트워크는 이 배포에서 장부를 읽을 수 없다.
  if (!kvConfigured || crossScopeBlind(scope)) {
    return { escrows: [], evSessions: [], settlements: [], deliveries: [], wallet: '', readable: false }
  }
  const [escrowState, evState, entries, wallet, deliveryIds] = await Promise.all([
    kvGetScoped<{ escrows?: EscrowRecord[] }>(scope, 'escrow:state'),
    kvGetScoped<{ sessions?: EvChargeSession[] }>(scope, 'ev-charge:sessions'),
    kvGetScoped<SettlementEntry[]>(scope, 'settlement:entries'),
    kvCommand<string | null>(['GET', scopedKey(scope, 'admin:wallet')]).catch(() => null),
    kvCommand<string[]>(['SMEMBERS', scopedKey(scope, 'deliveries:index')]).catch(() => null),
  ])
  let deliveries: DeliveryDispatch[] = []
  if (deliveryIds?.length) {
    const raw = await kvCommand<(string | null)[]>(['MGET', ...deliveryIds.map((id) => scopedKey(scope, `deliveries:job:${id}`))]).catch(() => null)
    deliveries = (raw ?? [])
      .map((value) => {
        try {
          return value ? (JSON.parse(value) as DeliveryDispatch) : null
        } catch {
          return null
        }
      })
      .filter((job): job is DeliveryDispatch => Boolean(job))
  }
  return {
    escrows: (escrowState?.escrows ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    evSessions: (evState?.sessions ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    settlements: (entries ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    deliveries,
    wallet: (wallet || '').trim(),
    readable: true,
  }
}

/** 통합 자금 흐름 행 — 에스크로·EV·택배·수수료 분배를 한 타임라인으로 합친다. */
type AssetRow = {
  id: string
  kind: 'escrow' | 'ev' | 'delivery' | 'fee'
  service: 'taxi' | 'daeri' | 'delivery' | 'ev'
  status: string
  statusKey: 'locked' | 'settled' | 'refunded' | 'pending' | 'cancelled' | 'active'
  refId: string
  label: string
  driverId: string | null
  driverName: string | null
  userId: string | null
  gross: number | null
  commission: number | null
  net: number | null
  refundPi: number | null
  depositPi: number | null
  lockTxid: string | null
  payoutTxid: string | null
  refundTxid: string | null
  adminWallet: string | null
  driverWallet: string | null
  at: string
}

const ESCROW_STATUS_KEY: Record<EscrowStatus, AssetRow['statusKey']> = {
  pending: 'pending',
  held: 'locked',
  released: 'settled',
  refunded: 'refunded',
}
const ESCROW_STATUS_LABEL: Record<EscrowStatus, string> = {
  pending: '예치 대기',
  held: '예치 중',
  released: '정산 완료',
  refunded: '환불 완료',
}
const EV_STATUS: Record<EvChargeStatus, { key: AssetRow['statusKey']; label: string }> = {
  pending: { key: 'pending', label: '예치 결제 대기' },
  charging: { key: 'locked', label: '충전 중(예치 잠금)' },
  settled: { key: 'settled', label: '정산 완료' },
  refunded: { key: 'refunded', label: '전액 환불' },
  cancelled: { key: 'cancelled', label: '취소' },
}

function escrowRow(record: EscrowRecord, serving: boolean): AssetRow {
  const kind = serving ? (getRide(record.rideId)?.kind === 'daeri' ? 'daeri' : 'taxi') : 'taxi'
  return {
    id: record.id,
    kind: 'escrow',
    service: kind,
    status: ESCROW_STATUS_LABEL[record.status] ?? record.status,
    statusKey: ESCROW_STATUS_KEY[record.status] ?? 'pending',
    refId: `ride:${record.rideId}`,
    label: '택시 에스크로',
    driverId: record.driverId || null,
    driverName: null,
    userId: record.passengerId || null,
    gross: record.amount,
    commission: null,
    net: null,
    refundPi: record.refundAmount ?? null,
    depositPi: record.amount,
    lockTxid: record.lockTxid,
    payoutTxid: record.payoutTxid,
    refundTxid: record.refundTxid ?? null,
    adminWallet: null,
    driverWallet: record.payoutWallet,
    at: record.updatedAt || record.createdAt,
  }
}

function evRow(session: EvChargeSession): AssetRow {
  const meta = EV_STATUS[session.status] ?? { key: 'pending' as const, label: session.status }
  return {
    id: session.id,
    kind: 'ev',
    service: 'ev',
    status: meta.label,
    statusKey: meta.key,
    refId: `ev:${session.id}`,
    label: session.chargerName || 'EV 충전',
    driverId: session.providerId || null,
    driverName: session.providerName || null,
    userId: session.userId || null,
    gross: session.finalPi ?? session.depositPi,
    commission: null,
    net: null,
    refundPi: session.refundPi ?? null,
    depositPi: session.depositPi,
    lockTxid: session.lockTxid,
    payoutTxid: session.payoutTxid ?? null,
    refundTxid: session.refundTxid ?? null,
    adminWallet: null,
    driverWallet: session.payoutWallet ?? null,
    at: session.settledAt || session.updatedAt || session.createdAt,
  }
}

function deliveryRow(job: DeliveryDispatch): AssetRow {
  const statusKey: AssetRow['statusKey'] =
    job.status === 'completed' ? 'settled' : job.status === 'expired' ? 'cancelled' : job.paidAt ? 'locked' : 'active'
  const statusLabel =
    job.status === 'completed' ? '배송 완료' : job.status === 'expired' ? '만료' : job.status === 'in_transit' ? '배송 중' : '수거 이동 중'
  return {
    id: job.id,
    kind: 'delivery',
    service: 'delivery',
    status: job.paidAt ? `${statusLabel} · 결제됨` : statusLabel,
    statusKey,
    refId: `delivery:${job.id}`,
    label: `${job.pickupAddress} → ${job.destAddress}`,
    driverId: job.driverId,
    driverName: job.driverName,
    userId: job.ownerId || null,
    gross: job.paidAt ? job.fare : null,
    commission: null,
    net: null,
    refundPi: null,
    depositPi: null,
    lockTxid: job.paymentTxid ?? null,
    payoutTxid: null,
    refundTxid: null,
    adminWallet: null,
    driverWallet: null,
    at: job.updatedAt || job.createdAt,
  }
}

function feeRow(entry: SettlementEntry): AssetRow {
  return {
    id: entry.id,
    kind: 'fee',
    service: entry.service === 'daeri' ? 'daeri' : entry.service === 'delivery' ? 'delivery' : entry.service === 'ev' ? 'ev' : 'taxi',
    status: entry.status === 'settled' ? '분배 완료' : '분배 대기',
    statusKey: entry.status === 'settled' ? 'settled' : 'pending',
    refId: entry.refId,
    label: entry.memo || entry.refId,
    driverId: entry.driverId || null,
    driverName: entry.driverName || null,
    userId: entry.passengerId || null,
    gross: entry.gross,
    commission: entry.commission,
    net: entry.net,
    refundPi: null,
    depositPi: null,
    lockTxid: null,
    payoutTxid: entry.payoutTxid ?? null,
    refundTxid: null,
    adminWallet: entry.adminWallet ?? null,
    driverWallet: entry.driverWallet ?? null,
    at: entry.settledAt || entry.createdAt,
  }
}

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const serving = dataNetwork()
  const requested = new URL(request.url).searchParams.get('scope')?.trim().toLowerCase()
  const scope: Scope = requested === 'mainnet' || requested === 'testnet' ? requested : serving
  const loaded = await loadScope(scope, serving)

  const balance = loaded.wallet ? await fetchOnchainPiBalance(loaded.wallet, { sandbox: scope === 'testnet' }).catch(() => null) : null

  const rows: AssetRow[] = [
    ...loaded.escrows.map((record) => escrowRow(record, scope === serving)),
    ...loaded.evSessions.map(evRow),
    ...loaded.deliveries
      .filter((job) => (job.driverId || job.paidAt || job.paymentTxid) && job.status !== 'requested')
      .map(deliveryRow),
    ...loaded.settlements.map(feeRow),
  ].sort((a, b) => b.at.localeCompare(a.at))

  const sum = (list: number[]) => piRound(list.reduce((total, value) => total + value, 0))
  const lockedEscrows = loaded.escrows.filter((record) => record.status === 'held' || record.status === 'pending')
  const settledFees = loaded.settlements.filter((entry) => entry.status === 'settled')
  const pendingFees = loaded.settlements.filter((entry) => entry.status === 'pending')
  const evCharging = loaded.evSessions.filter((session) => session.status === 'charging')
  const refundTotal =
    loaded.escrows.filter((record) => record.status === 'refunded').reduce((total, record) => total + (record.refundAmount ?? record.amount), 0) +
    loaded.evSessions.reduce((total, session) => total + (session.refundPi ?? 0), 0)

  return NextResponse.json({
    ok: true,
    servingNetwork: serving,
    scope,
    scopeReadable: loaded.readable,
    crossScopeBlind: scope !== serving && crossScopeBlind(scope),
    wallet: { address: loaded.wallet, balance },
    summary: {
      escrowLocked: { count: lockedEscrows.length + evCharging.length, amount: sum([...lockedEscrows.map((e) => e.amount), ...evCharging.map((s) => s.depositPi)]) },
      feeDistributed: { count: settledFees.length, commission: sum(settledFees.map((e) => e.commission)), gross: sum(settledFees.map((e) => e.gross)) },
      driverNet: { count: settledFees.length, net: sum(settledFees.map((e) => e.net)) },
      pendingSettle: { count: pendingFees.length, net: sum(pendingFees.map((e) => e.net)) },
      refunded: {
        count: loaded.escrows.filter((e) => e.status === 'refunded').length + loaded.evSessions.filter((s) => s.status === 'refunded' || (s.refundPi ?? 0) > 0).length,
        amount: piRound(refundTotal),
      },
    },
    rows: rows.slice(0, 400),
    generatedAt: new Date().toISOString(),
  })
}

export async function PATCH(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as {
    action?: unknown
    id?: unknown
    status?: unknown
    gross?: unknown
    memo?: unknown
    refundAmount?: unknown
    reason?: unknown
    scope?: unknown
  } | null
  const action = typeof body?.action === 'string' ? body.action : ''
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

  // 장부 보정은 항상 이 배포가 서비스하는 데이터 스코프에서만 허용 — 반대
  // 네트워크 모니터링은 읽기 전용이다.
  const scope = typeof body?.scope === 'string' ? body.scope.trim().toLowerCase() : ''
  if (scope && scope !== dataNetwork()) {
    return NextResponse.json({ error: '다른 네트워크 스코프는 조회만 가능합니다.' }, { status: 403 })
  }

  if (action === 'escrow-mark') {
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    const status = body?.status
    if (status !== 'held' && status !== 'released' && status !== 'refunded' && status !== 'pending') {
      return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    }
    const escrow = getEscrow(id)
    if (!escrow) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const before = { status: escrow.status, refundAmount: escrow.refundAmount ?? null }
    escrow.status = status
    if (status === 'released') escrow.releasedAt = escrow.releasedAt || new Date().toISOString()
    if (status === 'refunded') {
      escrow.refundedAt = escrow.refundedAt || new Date().toISOString()
      if (Number.isFinite(Number(body?.refundAmount)) && Number(body?.refundAmount) > 0) {
        escrow.refundAmount = Number(body?.refundAmount)
      } else if (escrow.refundAmount == null) {
        escrow.refundAmount = escrow.amount
      }
    }
    escrow.updatedAt = new Date().toISOString()
    saveEscrow(escrow)
    await flushEscrowPersist()
    await recordAudit({
      kind: 'assets',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `escrow:${id}`,
      reason,
      detail: `에스크로 수동 보정 ${before.status}→${status}`,
      before,
      after: { status: escrow.status, refundAmount: escrow.refundAmount ?? null },
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, escrow })
  }

  if (action === 'ev-mark') {
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    const status = body?.status
    if (status !== 'settled' && status !== 'refunded' && status !== 'cancelled') {
      return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
    }
    const session = getEvSession(id)
    if (!session) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const before = { status: session.status, refundPi: session.refundPi ?? null }
    session.status = status
    if (status === 'settled') session.settledAt = session.settledAt || new Date().toISOString()
    if (status === 'refunded' && session.refundPi == null) session.refundPi = session.depositPi
    session.updatedAt = new Date().toISOString()
    saveEvSession(session)
    await recordAudit({
      kind: 'assets',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `ev:${id}`,
      reason,
      detail: `EV 세션 수동 보정 ${before.status}→${status}`,
      before,
      after: { status: session.status, refundPi: session.refundPi ?? null },
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, session })
  }

  if (action === 'settle') {
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    const entry = await markSettlementSettled(id)
    if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await recordAudit({
      kind: 'settle',
      actor: actor.staffId,
      actorName: actor.staffName,
      entryId: entry.id,
      refId: entry.refId,
      reason,
      detail: `${entry.driverName || entry.driverId} · ${entry.gross}Pi (자산 관리 탭)`,
      after: { status: entry.status, settledAt: entry.settledAt },
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, entry })
  }

  if (action === 'settle-all') {
    const count = await markAllSettlementsSettled()
    await recordAudit({ kind: 'settle-all', actor: actor.staffId, actorName: actor.staffName, reason, detail: `${count}건 일괄 정산 (자산 관리 탭)` }).catch(() => undefined)
    return NextResponse.json({ ok: true, count })
  }

  if (action === 'adjust') {
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    const gross = body?.gross === undefined ? undefined : Number(body.gross)
    const status = body?.status === 'pending' || body?.status === 'settled' ? body.status : undefined
    const before = (await listSettlements()).find((row) => row.id === id) ?? null
    const entry = await updateSettlementEntry(id, {
      gross,
      status,
      memo: typeof body?.memo === 'string' ? body.memo : undefined,
    })
    if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await recordAudit({
      kind: 'adjust',
      actor: actor.staffId,
      actorName: actor.staffName,
      entryId: entry.id,
      refId: entry.refId,
      reason,
      before: before ? { gross: before.gross, status: before.status } : null,
      after: { gross: entry.gross, status: entry.status },
      detail: '자산 관리 탭 수동 보정',
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, entry })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
