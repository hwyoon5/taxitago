import { piRound } from '@/lib/pi-format'
import { getFareConfig } from '@/lib/fare-config-server'
import { isPiSandboxEnv } from '@/lib/pi-sandbox'
import { createA2UPayment } from '@/lib/pi-platform'
import { recordSettlement } from '@/lib/settlement-store'
import { payoutSettlementNet } from '@/lib/settlement-payout'
import { driverPayoutTarget } from '@/lib/escrow-engine'
import { getPartnerLink } from '@/lib/partner-ledger-server'
import { recordReceivable } from '@/lib/receivable-store'
import { addEarning, saveReceipt } from '@/lib/escrow-store'
import { getEvSession, listEvSessions, saveEvSession, syncEvChargeFromDisk } from '@/lib/ev-charge-store'
import { evSessionGate, linkEvSessionToBooking, onEvSessionEnded, onEvSessionLocked } from '@/lib/ev-booking'
import type { EvChargeSession, EvMeterSource } from '@/lib/ev-charge-types'

const nowIso = () => new Date().toISOString()

function stamp(session: EvChargeSession) {
  session.updatedAt = nowIso()
  saveEvSession(session)
  return session
}

function clip(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function num(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** 이용자 식별 보조 — Pi uid가 없는 로컬 이용자는 A2U 환불 대상이 아니다. */
function refundTarget(session: EvChargeSession) {
  const linked = getPartnerLink(session.userId)
  const uid = clip(session.userUid, 80) || clip(linked?.uid, 80) || session.userId
  const external =
    Boolean(uid) &&
    !uid.startsWith('virtual-') &&
    !uid.startsWith('driver-') &&
    !uid.startsWith('passenger-') &&
    !uid.startsWith('guest-')
  return { uid, wallet: clip(session.userWallet, 80) || clip(linked?.wallet, 80), external }
}

/**
 * EV 충전 세션 생성 — 예치금은 "단가 × 예치 기준 충전량"(관리자 설정
 * evCharging.perKwh·depositKwh)으로 계산하고, 충전기별 단가가 표시되면
 * 그 단가를 세션에 고정한다. 실결제는 이후 Pi 결제 검증(complete)으로 잠긴다.
 */
export async function createEvSession(input: {
  userId: string
  userUid?: string
  userWallet?: string
  userPhone?: string
  chargerId: string
  chargerName: string
  powerKw?: number
  providerId?: string
  providerName?: string
  /** 충전기 목록에 표시된 kWh 단가 — 없으면 관리자 설정 단가. */
  perKwhPi?: number
  /** 예약 체크인으로 시작하는 세션이면 예약 id — 서버가 소유·차례를 검증한다. */
  bookingId?: string
}) {
  syncEvChargeFromDisk()
  const userId = clip(input.userId, 80)
  if (!userId) return { ok: false as const, error: 'user_required', session: null }
  // 진행 중 세션이 있으면 새로 만들지 않고 기존 건을 돌려준다(멱등).
  const open = listEvSessions(userId).find((item) => item.status === 'pending' || item.status === 'charging')
  if (open) return { ok: true as const, session: open, deduped: true as const }
  // 스마트 밸런싱 게이트 — 슬롯이 꽉 찬 충전소는 차례가 온 예약자만 세션을
  // 열 수 있다. 슬롯이 비면 예약 없이도 즉시 이용 가능(대기열 무의미).
  const chargerId = clip(input.chargerId, 80) || 'ev-charger'
  const gate = evSessionGate(chargerId, userId)
  if (!gate.allow) {
    return { ok: false as const, error: 'station_busy' as const, queueDepth: gate.queueDepth, session: null }
  }
  const requestedBooking = clip(input.bookingId, 60)
  // 명시 예약이 있으면 그 건을 검증해 연결하고, 없으면 차례가 온 본인 예약을 자동 연결한다.
  const bookingId = gate.booking && (!requestedBooking || requestedBooking === gate.booking.id) ? gate.booking.id : null
  // 차례가 오지 않은(또는 남의) 예약으로 체크인하려는 요청은 명시적으로 거절한다.
  if (requestedBooking && !bookingId) {
    return { ok: false as const, error: 'booking_not_due' as const, session: null }
  }
  const config = await getFareConfig()
  const rate = num(input.perKwhPi)
  const perKwhPi = piRound(rate != null && rate > 0 ? rate : config.evCharging.perKwh)
  const depositPi = piRound(Math.max(config.flatBase.ev, perKwhPi * config.evCharging.depositKwh))
  // 파트너 충전기 id는 `partner-<uid>` 형태 — 정산 대상 uid로 정규화한다.
  const rawProvider = clip(input.providerId, 80)
  const providerId = rawProvider.startsWith('partner-') ? rawProvider.slice(8) : rawProvider
  const createdAt = nowIso()
  const session = saveEvSession({
    id: crypto.randomUUID(),
    userId,
    userUid: clip(input.userUid, 80) || undefined,
    userWallet: clip(input.userWallet, 80) || undefined,
    userPhone: clip(input.userPhone, 30) || undefined,
    chargerId,
    chargerName: clip(input.chargerName, 80) || 'EV 충전기',
    powerKw: num(input.powerKw) ?? undefined,
    providerId: providerId || undefined,
    providerName: clip(input.providerName, 60) || undefined,
    perKwhPi,
    depositPi,
    status: 'pending',
    lockPaymentId: null,
    lockTxid: null,
    heldAt: null,
    startedAt: null,
    endedAt: null,
    settledAt: null,
    createdAt,
    updatedAt: createdAt,
  })
  // 차례가 온 예약과 세션을 연결 — 잠금(lock)이 완료되면 예약이 'active'가 된다.
  if (bookingId) {
    const linked = linkEvSessionToBooking(session, bookingId, userId)
    if (linked) {
      session.bookingId = linked.id
      saveEvSession(session)
    }
  }
  return { ok: true as const, session }
}

/**
 * 예치금 결제 검증 잠금 — /api/pi/complete의 서버 검증을 통과한
 * 'ev-deposit' 결제만 세션을 잠근다. 클라이언트 주장 txid는
 * payment-kind 레지스트리로 검증해 서버가 확인하지 않은 결제로
 * 세션을 여는 경로를 차단한다.
 */
export async function lockEvSession(
  sessionId: string,
  proof: { paymentId?: string; txid?: string },
  opts?: { requireVerified?: boolean },
) {
  syncEvChargeFromDisk()
  const session = getEvSession(sessionId)
  if (!session) return { ok: false as const, error: 'not_found', session: null }
  if (session.status === 'charging' || session.status === 'settled') {
    if (session.status === 'charging') onEvSessionLocked(session)
    return { ok: true as const, session }
  }
  if (session.status !== 'pending') return { ok: false as const, error: 'invalid_state', session }
  const paymentId = proof.paymentId?.trim() || ''
  const txid = proof.txid?.trim() || ''
  if (!paymentId || !txid) return { ok: false as const, error: 'payment_required', session }
  if (opts?.requireVerified !== false) {
    const { paymentKindOf } = await import('@/lib/payment-kind-store')
    const kind = await paymentKindOf(txid).catch(() => '')
    if (!kind) {
      console.warn('[ev-charge] lock rejected: txid is not a server-verified payment', { sessionId, txid })
      return { ok: false as const, error: 'payment_unverified', session }
    }
  }
  session.status = 'charging'
  session.lockPaymentId = paymentId
  session.lockTxid = txid
  session.heldAt = nowIso()
  session.startedAt = session.heldAt
  onEvSessionLocked(session)
  return { ok: true as const, session: stamp(session) }
}

/** Pi 결제 완료 후킥 — metadata.kind === 'ev-deposit'이면 해당 세션을 잠근다. */
export async function lockEvSessionFromPayment(
  paymentId: string,
  txid: string,
  metadata: Record<string, unknown> | null | undefined,
) {
  if (!metadata || metadata.kind !== 'ev-deposit') return
  const sessionId = typeof metadata.evSessionId === 'string' ? metadata.evSessionId.trim() : ''
  if (!sessionId) return
  const locked = await lockEvSession(sessionId, { paymentId, txid }, { requireVerified: false })
  if (!locked.ok) console.warn('[ev-charge] payment-side lock failed', { sessionId, error: locked.error })
}

/**
 * CPO 서버의 실측 충전량 보고 — 세션의 meteredKwh로 기록되며
 * 종료 정산 시 클라이언트 입력값보다 우선한다.
 */
export function reportEvMeter(sessionId: string, input: { kwh: number; source: EvMeterSource }) {
  syncEvChargeFromDisk()
  const session = getEvSession(sessionId)
  if (!session) return { ok: false as const, error: 'not_found', session: null }
  if (session.status === 'settled' || session.status === 'refunded' || session.status === 'cancelled') {
    return { ok: false as const, error: 'closed', session }
  }
  const kwh = num(input.kwh)
  if (kwh == null || kwh < 0 || kwh > 500) return { ok: false as const, error: 'invalid_kwh', session }
  // CPO 실측이 이미 있으면 수동 입력으로 덮어쓰지 않는다.
  if (session.meterSource === 'cpo' && input.source !== 'cpo') {
    return { ok: true as const, session }
  }
  session.meteredKwh = Math.round(kwh * 1000) / 1000
  session.meterSource = input.source
  return { ok: true as const, session: stamp(session) }
}

/**
 * 예치금 차액 환불 — 메인넷은 이용자 uid로 A2U 실송금, 테스트넷은
 * 장부 크레딧으로 기록한다. refundTxid 멱등으로 재시도·중복 호출이
 * 이중 환불을 만들지 않는다.
 */
async function refundEvDifference(session: EvChargeSession, amount: number, memo: string) {
  if (!(amount > 0) || session.refundTxid) return
  const target = refundTarget(session)
  let txid = `ev-refund-${session.id.slice(0, 10)}`
  if (!isPiSandboxEnv() && target.external) {
    const payment = await createA2UPayment({
      amount,
      memo,
      uid: target.uid,
      metadata: { kind: 'ev-refund', evSessionId: session.id },
    })
    txid = payment.transaction?.txid || payment.identifier || txid
  } else if (isPiSandboxEnv()) {
    const { creditUserDeposit } = await import('@/lib/user-credit-store')
    await creditUserDeposit({
      txid,
      wallet: target.wallet,
      uid: target.uid,
      amount,
      source: 'manual',
    }).catch((error) => {
      console.error('[ev-charge] refund credit ledger failed', { sessionId: session.id, amount, error })
    })
  }
  session.refundTxid = txid
  session.refundPi = piRound(amount)
}

const settlingSessions = new Set<string>()

/**
 * 충전 종료 정산 — 실측 kWh(CPO 보고 > 수동 입력 > 경과시간 추정)로
 * 확정 요금을 계산하고, 예치금과의 차액을 이용자에게 환불한 뒤 나머지를
 * 제공자에게 정산한다. 장부 기록이 송금보다 먼저 — refId 멱등이라
 * 재시도가 이중 정산을 만들지 않는다.
 */
export async function settleEvSession(
  sessionId: string,
  opts?: { kwh?: number; endedBy?: 'user' | 'cpo' | 'admin' },
) {
  syncEvChargeFromDisk()
  const session = getEvSession(sessionId)
  if (!session) return { ok: false as const, error: 'not_found', session: null }
  if (session.status === 'settled' || session.status === 'refunded') return { ok: true as const, session, duplicate: true as const }
  if (session.status === 'cancelled') return { ok: false as const, error: 'cancelled', session }
  if (session.status === 'pending' || !session.lockTxid) {
    return { ok: false as const, error: 'not_locked', session }
  }
  if (settlingSessions.has(sessionId)) {
    for (let waited = 0; waited < 4000 && settlingSessions.has(sessionId); waited += 200) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    const settled = getEvSession(sessionId)
    if (settled && (settled.status === 'settled' || settled.status === 'refunded')) {
      return { ok: true as const, session: settled, duplicate: true as const }
    }
    return { ok: false as const, error: 'settling', session }
  }
  settlingSessions.add(sessionId)
  try {
    // 실측 충전량 확정 — CPO 보고 > 호출 시 전달값 > 충전기 출력×경과시간 추정.
    let kwh = session.meteredKwh ?? null
    let source: EvMeterSource = session.meterSource ?? 'cpo'
    const given = num(opts?.kwh)
    if (kwh == null && given != null && given >= 0 && given <= 500) {
      kwh = given
      source = 'manual'
    }
    if (kwh == null) {
      const elapsedMin =
        session.startedAt ? Math.max(0, (Date.now() - Date.parse(session.startedAt)) / 60000) : 0
      const power = session.powerKw && session.powerKw > 0 ? session.powerKw : 50
      kwh = Math.round(power * (elapsedMin / 60) * 0.9 * 1000) / 1000
      source = 'estimate'
    }
    const finalKwh = Math.round(Math.max(0, kwh) * 1000) / 1000
    const finalPi = piRound(finalKwh * session.perKwhPi)
    // 제공자 정산 한도는 실제 잠긴 예치금 — 부족분은 미수금으로 이관한다.
    const payoutGross = piRound(Math.min(finalPi, session.depositPi))
    const refundPi = piRound(Math.max(0, session.depositPi - finalPi))
    const deficitPi = piRound(Math.max(0, finalPi - session.depositPi))
    const settledAt = nowIso()
    const providerId = session.providerId || 'platform'
    const target = driverPayoutTarget(providerId)

    console.log('[ev-charge] settle start', {
      sessionId,
      kwh: finalKwh,
      source,
      perKwhPi: session.perKwhPi,
      deposit: session.depositPi,
      final: finalPi,
      refund: refundPi,
      deficit: deficitPi,
      network: isPiSandboxEnv() ? 'testnet' : 'mainnet',
    })

    // 정산 장부를 송금·환불보다 먼저 기록 — 어느 송금이 실패해도 미정산 채권이 남는다.
    const entry = await recordSettlement({
      refId: `ev:${sessionId}`,
      service: 'ev',
      driverId: providerId,
      driverName: session.providerName || target.name || '충전 사업자',
      passengerId: session.userId,
      memo: `${session.chargerName} · 실측 ${finalKwh} kWh × ${session.perKwhPi} Pi${deficitPi > 0 ? ` · 예치 초과 ${deficitPi} Pi 미수` : ''}`,
      gross: payoutGross,
      driverWallet: target.wallet,
      channel: 'inapp',
    }).catch((error) => {
      console.error('[ev-charge] settlement ledger write failed', { sessionId, error: error instanceof Error ? error.message : 'error' })
      return null
    })
    let payoutTxid: string | null = null
    if (entry) {
      payoutTxid = await payoutSettlementNet(entry, 'EV 충전 정산').catch((error) => {
        console.error('[ev-charge] provider payout failed — left pending', { sessionId, error: error instanceof Error ? error.message : 'error' })
        return null
      })
    }

    // 차액 환불 — 예치금이 확정 요금보다 크면 초과분을 이용자에게 즉시 돌려준다.
    if (refundPi > 0) {
      try {
        await refundEvDifference(session, refundPi, 'EV 충전 차액 환불')
      } catch (error) {
        // 환불 송금 실패 — refundTxid를 비워 두고 의도 금액만 기록해 다음 정산 패스가 재시도한다.
        session.refundPi = refundPi
        console.error('[ev-charge] refund failed — retryable on next settle pass', {
          sessionId,
          refundPi,
          error: error instanceof Error ? error.message : 'error',
        })
      }
    } else {
      session.refundPi = 0
    }

    // 예치 초과분 — 충전량이 예상을 넘어 예치금으로 못 덮은 금액은 미수금 장부에 올린다.
    if (deficitPi > 0) {
      await recordReceivable({
        userId: session.userUid || session.userId,
        wallet: session.userWallet,
        phone: session.userPhone,
        service: 'EV 충전 초과분',
        serviceKey: 'ev',
        partnerId: session.providerId,
        partnerName: session.providerName,
        deviceId: session.chargerId,
        place: session.chargerName,
        amount: deficitPi,
        reason: 'insufficient',
        detail: `실측 ${finalKwh} kWh 확정 요금 ${finalPi} Pi가 예치금 ${session.depositPi} Pi를 초과`,
      }).catch((error) => {
        console.error('[ev-charge] deficit receivable record failed', { sessionId, deficitPi, error })
      })
    }

    session.finalKwh = finalKwh
    session.meterSource = source
    session.finalPi = finalPi
    session.deficitPi = deficitPi > 0 ? deficitPi : undefined
    session.payoutTxid = payoutTxid
    session.payoutWallet = target.wallet
    session.status = refundPi >= session.depositPi && payoutGross <= 0 ? 'refunded' : 'settled'
    session.endedAt = session.endedAt || settledAt
    session.settledAt = settledAt
    stamp(session)
    onEvSessionEnded(session)

    // 제공자 수익 내역 + 이용자 영수증 — 기존 정산 영수증 구조를 재사용한다.
    addEarning({
      id: crypto.randomUUID(),
      driverId: providerId,
      rideId: sessionId,
      amount: payoutGross,
      route: `${session.chargerName} · ${finalKwh} kWh`,
      status: 'completed',
      at: settledAt,
    })
    saveReceipt({
      rideId: sessionId,
      passengerId: session.userId,
      driverId: providerId,
      driverName: session.providerName || target.name || '충전 사업자',
      route: `${session.chargerName} (실측 ${finalKwh} kWh)`,
      origin: session.chargerName,
      dest: '충전 완료',
      amount: finalPi,
      estimatedFare: session.depositPi,
      fareBase: payoutGross,
      lockTxid: session.lockTxid || '',
      payoutTxid: payoutTxid || `ev-${sessionId.slice(0, 10)}`,
      payoutWallet: target.wallet,
      vehicle: 'EV 충전',
      plate: session.chargerId,
      settledAt,
    })

    console.log('[ev-charge] settle done', {
      sessionId,
      finalPi,
      payoutGross,
      refundPi,
      refundTxid: session.refundTxid || null,
      payoutTxid: payoutTxid || '(pending)',
      deficitPi,
    })
    return { ok: true as const, session }
  } finally {
    settlingSessions.delete(sessionId)
  }
}

/**
 * 세션 취소 — 잠금 전이면 자금 이동 없이 종료, 잠금 후 충전 실측이
 * 없으면 예치금 전액을 이용자에게 돌려준다. 실측이 잡힌 세션은
 * 취소가 아니라 정산 경로로 보낸다.
 */
export async function cancelEvSession(sessionId: string, userId: string) {
  syncEvChargeFromDisk()
  const session = getEvSession(sessionId)
  if (!session) return { ok: false as const, error: 'not_found', session: null }
  if (session.userId !== userId) return { ok: false as const, error: 'forbidden', session }
  if (session.status === 'settled' || session.status === 'refunded' || session.status === 'cancelled') {
    return { ok: true as const, session, duplicate: true as const }
  }
  if (session.meteredKwh != null && session.meteredKwh > 0) {
    return settleEvSession(sessionId, { endedBy: 'user' })
  }
  if (session.status === 'pending') {
    session.status = 'cancelled'
    const cancelled = stamp(session)
    onEvSessionEnded(cancelled)
    return { ok: true as const, session: cancelled }
  }
  // 잠금 후 미충전 취소 — 예치금 전액 환불.
  try {
    await refundEvDifference(session, session.depositPi, 'EV 충전 취소 예치금 환불')
  } catch (error) {
    session.refundPi = session.depositPi
    stamp(session)
    console.error('[ev-charge] cancel refund failed — retryable', { sessionId, error: error instanceof Error ? error.message : 'error' })
  }
  session.status = 'refunded'
  session.endedAt = nowIso()
  session.settledAt = session.endedAt
  const refunded = stamp(session)
  onEvSessionEnded(refunded)
  return { ok: true as const, session: refunded }
}
