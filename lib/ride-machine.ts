import {
  abandonAssignedRide,
  cancelRide,
  completeAssignedRide,
  ensureRideForCompletion,
  getPublicRide,
  markRideProgress,
  respondToOffer,
  restorePendingOffer,
  toPublicRide,
} from '@/lib/dispatch-engine'
import { flushDispatchPersist, getRide, hydrateDispatchFromKv, listRides, syncDispatchFromDisk } from '@/lib/dispatch-store'
import {
  flushEscrowPersist,
  getEscrowByRide,
  hydrateEscrowFromKv,
  syncEscrowFromDisk,
} from '@/lib/escrow-store'
import { releaseEscrow, settlePassengerCancelFee, toPublicEscrow } from '@/lib/escrow-engine'
import { archiveRideComms } from '@/lib/comms-engine'
import type { PublicRide, RideRequestRecord } from '@/lib/dispatch-types'
import type { PublicEscrow, SettlementReceipt } from '@/lib/escrow-types'

/**
 * Single entry point for every ride state transition.
 *
 *   searching → offered → assigned → (boardedAt) → (readyToSettleAt) → completed
 *                  ↘ rejected/timeout → next driver          ↘ cancelled (passenger)
 *                                                            ↘ abandoned (driver)
 *
 * Every mutation route funnels through `transitionRide`, so hydration, guards,
 * side effects (escrow, comms archive, driver release) and error semantics live
 * in exactly one place.
 */
export type RideTransitionAction =
  | 'accept'
  | 'reject'
  | 'board'
  | 'arrive'
  | 'complete'
  | 'cancel'
  | 'abandon'

export type RidePointSnapshot = { lat?: unknown; lng?: unknown; address?: unknown; label?: unknown }

export type RideSnapshotInput = {
  passengerId?: string
  pickup?: { lat: number; lng: number; address?: string; label?: string }
  dest?: { lat: number; lng: number; address?: string; label?: string }
  estimatedFare?: number
  kind?: 'taxi' | 'daeri'
  boardedAt?: string | null
  readyToSettleAt?: string | null
  driverId?: string | null
}

export type RideEscrowProof = {
  status?: string | null
  lockTxid?: string | null
  lockPaymentId?: string | null
}

export type RideTransitionResult =
  | { ok: true; ride: PublicRide | null; escrow: PublicEscrow | null; receipt: SettlementReceipt | null }
  | { ok: false; error: string; ride: PublicRide | null }

const okRecord = (ride: RideRequestRecord | null, extras?: { escrow?: PublicEscrow | null; receipt?: SettlementReceipt | null }): RideTransitionResult => ({
  ok: true,
  ride: ride ? toPublicRide(ride) : null,
  escrow: extras?.escrow ?? null,
  receipt: extras?.receipt ?? null,
})

const fail = (error: string, ride?: RideRequestRecord | PublicRide | null): RideTransitionResult => ({
  ok: false,
  error,
  ride: ride ? ('assignedDriver' in ride ? (ride as PublicRide) : toPublicRide(ride as RideRequestRecord)) : null,
})

function toPoint(value: RidePointSnapshot | undefined) {
  const lat = Number(value?.lat)
  const lng = Number(value?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined
  return {
    lat,
    lng,
    address: typeof value?.address === 'string' ? value.address : undefined,
    label: typeof value?.label === 'string' ? value.label : undefined,
  }
}

/** The ride a passenger is currently engaged in — searching, offered, or assigned. */
export function getPassengerActiveRide(passengerId: string) {
  syncDispatchFromDisk()
  syncEscrowFromDisk()
  const list = listRides().filter(
    (ride) =>
      ride.passengerId === passengerId &&
      (ride.status === 'searching' || ride.status === 'offered' || ride.status === 'assigned'),
  )
  list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return list[0] ?? null
}

export async function transitionRide(input: {
  rideId: string
  action: RideTransitionAction
  passengerId?: string
  driverId?: string
  settleFee?: boolean
  proof?: RideEscrowProof
  snapshot?: {
    passengerId?: unknown
    pickup?: RidePointSnapshot
    dest?: RidePointSnapshot
    estimatedFare?: unknown
    kind?: unknown
    boardedAt?: unknown
    readyToSettleAt?: unknown
    driverId?: unknown
  }
}): Promise<RideTransitionResult> {
  syncDispatchFromDisk()
  syncEscrowFromDisk()
  await Promise.all([hydrateDispatchFromKv(), hydrateEscrowFromKv()])

  const result = await applyTransition(input)
  // Mutations must reach the shared store before the response returns —
  // fire-and-forget writes can be killed when a serverless instance freezes,
  // leaving later requests on other instances unable to find the ride.
  if (result.ok) {
    await Promise.all([flushDispatchPersist(), flushEscrowPersist()]).catch(() => undefined)
  }
  return result
}

async function applyTransition(input: {
  rideId: string
  action: RideTransitionAction
  passengerId?: string
  driverId?: string
  settleFee?: boolean
  proof?: RideEscrowProof
  snapshot?: {
    passengerId?: unknown
    pickup?: RidePointSnapshot
    dest?: RidePointSnapshot
    estimatedFare?: unknown
    kind?: unknown
    boardedAt?: unknown
    readyToSettleAt?: unknown
    driverId?: unknown
  }
}): Promise<RideTransitionResult> {
  const { rideId, action } = input
  const driverId = typeof input.driverId === 'string' ? input.driverId.trim() : ''
  const passengerId = typeof input.passengerId === 'string' ? input.passengerId.trim() : ''
  const snapshot = input.snapshot
  const rideSnapshot = snapshot
    ? {
        passengerId: typeof snapshot.passengerId === 'string' ? snapshot.passengerId : undefined,
        pickup: toPoint(snapshot.pickup),
        dest: toPoint(snapshot.dest),
        estimatedFare: typeof snapshot.estimatedFare === 'number' ? snapshot.estimatedFare : undefined,
        kind: snapshot.kind === 'daeri' ? ('daeri' as const) : undefined,
        boardedAt: typeof snapshot.boardedAt === 'string' ? snapshot.boardedAt : null,
        readyToSettleAt: typeof snapshot.readyToSettleAt === 'string' ? snapshot.readyToSettleAt : null,
        driverId: typeof snapshot.driverId === 'string' ? snapshot.driverId : null,
      }
    : undefined

  switch (action) {
    case 'accept':
    case 'reject': {
      if (!driverId) return fail('driver_required')
      let result = respondToOffer(rideId, driverId, action)
      if (!result.ok && result.error === 'not_found' && action === 'accept' && rideSnapshot) {
        const restored = restorePendingOffer(rideId, driverId, rideSnapshot)
        if (restored) result = respondToOffer(rideId, driverId, action)
      }
      if (!result.ride) return fail(result.error)
      if (!result.ok) return fail(result.error, result.ride)
      return okRecord(result.ride)
    }

    case 'board':
    case 'arrive': {
      if (!passengerId) return fail('passenger_required')
      const result = markRideProgress(
        rideId,
        passengerId,
        action === 'board' ? 'boarded' : 'arrived',
        rideSnapshot,
      )
      if (!result.ride) return fail(result.error)
      if (!result.ok) return fail(result.error, result.ride)
      return okRecord(result.ride)
    }

    case 'abandon': {
      if (!driverId) return fail('driver_required')
      const result = abandonAssignedRide(rideId, driverId)
      if (!result.ride) return fail(result.error)
      if (!result.ok) return fail(result.error, result.ride)
      return okRecord(result.ride)
    }

    case 'cancel': {
      const current = getRide(rideId)
      if (!current) return { ok: true, ride: null, escrow: null, receipt: null }
      if (passengerId && current.passengerId !== passengerId) return fail('forbidden', current)
      if (input.settleFee && current.status === 'assigned' && current.assignedDriverId) {
        try {
          await settlePassengerCancelFee(rideId)
        } catch (error) {
          console.error('[cancel] fee settlement failed', error instanceof Error ? error.message : 'error')
        }
      }
      const ride = cancelRide(rideId, passengerId || undefined)
      if (!ride) return { ok: true, ride: null, escrow: null, receipt: null }
      await archiveRideComms(rideId, 'cancelled').catch(() => undefined)
      return { ok: true, ride: toPublicRide(ride), escrow: toPublicEscrow(getEscrowByRide(rideId)), receipt: null }
    }

    case 'complete': {
      if (!driverId) return fail('driver_required')
      ensureRideForCompletion(rideId, driverId, rideSnapshot)
      const result = await releaseEscrow(rideId, driverId, input.proof)
      if (!result.ok) return fail(result.error, getPublicRide(rideId))
      const finished = completeAssignedRide(rideId, driverId)
      await archiveRideComms(rideId, 'completed').catch(() => undefined)
      const ride = getPublicRide(rideId) ?? (finished ? toPublicRide(finished) : null)
      if (!ride) return fail('not_found')
      return { ok: true, ride, escrow: toPublicEscrow(result.escrow), receipt: result.receipt }
    }
  }
}

/** One canonical map from machine error codes to user-facing Korean messages. */
export function rideTransitionErrorMessage(error: string): string {
  switch (error) {
    case 'not_found':
      return '운행을 찾지 못했어요.'
    case 'forbidden':
      return '이 운행을 처리할 권한이 없어요.'
    case 'not_your_offer':
      return '이미 만료되었거나 다른 기사에게 배정된 콜이에요.'
    case 'already_assigned':
      return '이미 배정된 운행이에요.'
    case 'cancelled':
      return '운행이 취소되었어요.'
    case 'unmatched':
      return '배차가 종료된 운행이에요.'
    case 'completed':
      return '이미 완료된 운행이에요.'
    case 'driver_unavailable':
      return '기사 온라인 상태를 확인해 주세요.'
    case 'driver_busy':
      return '다른 운행을 처리 중이라 이 콜은 다음 기사에게 넘겼어요.'
    case 'not_boarded':
      return '먼저 탑승을 확인해 주세요.'
    case 'not_assigned':
      return '배정된 운행이 아니에요.'
    case 'passenger_not_ready':
      return '승객이 탑승과 목적지 도착을 확인한 뒤에 정산할 수 있어요.'
    case 'escrow_not_held':
      return '승객 결제가 확인된 뒤에 정산할 수 있어요.'
    case 'settling':
      return '정산이 진행 중이에요. 잠시 후 다시 눌러 주세요.'
    case 'driver_required':
      return '기사 정보가 필요해요.'
    case 'passenger_required':
      return '승객 정보가 필요해요.'
    default:
      return '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
  }
}
