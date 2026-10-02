import { piRound } from '@/lib/pi-format'

export type SettledRideFare = {
  estimate: number
  actual: number
  adjusted: boolean
}

/** Deterministic live fare from the quoted estimate (traffic / distance / time). */
export function settleRideFare(estimate: number, key: string): SettledRideFare {
  const normalized = piRound(estimate)
  let hash = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const bump = (((hash >>> 0) % 28) + 8) / 100
  const actual = piRound(normalized + bump)
  return { estimate: normalized, actual, adjusted: actual !== normalized }
}

export type MidTripCancelSettlement = {
  quoted: number
  cancelFee: number
  waived: number
  driverPayout: number
  feeRate: number
}

export type CancelFeePolicyInput = { rate?: number; min?: number }

/** In-trip passenger cancel: driver keeps a cancellation fee; unused quoted fare is waived. */
export function settleMidTripCancelFee(quotedFare: number, policy?: CancelFeePolicyInput): MidTripCancelSettlement {
  const quoted = piRound(Math.max(0, quotedFare))
  const rate = Number.isFinite(policy?.rate) ? Math.min(1, Math.max(0, Number(policy!.rate))) : 0.4
  const min = Number.isFinite(policy?.min) ? Math.max(0, Number(policy!.min)) : 0.5
  const cancelFee = piRound(Math.min(quoted, Math.max(quoted > 0 ? min : 0, quoted * rate)))
  const waived = piRound(quoted - cancelFee)
  return { quoted, cancelFee, waived, driverPayout: cancelFee, feeRate: rate }
}

export function isRidePayLabel(label: string) {
  return /택시|대리/.test(label)
}
