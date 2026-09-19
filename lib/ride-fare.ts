export type SettledRideFare = {
  estimate: number
  actual: number
  adjusted: boolean
}

function roundPi(value: number) {
  return Math.round(value * 100) / 100
}

/** Deterministic live fare from the quoted estimate (traffic / distance / time). */
export function settleRideFare(estimate: number, key: string): SettledRideFare {
  const normalized = roundPi(estimate)
  let hash = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const bump = (((hash >>> 0) % 28) + 8) / 100
  const actual = roundPi(normalized + bump)
  return { estimate: normalized, actual, adjusted: actual !== normalized }
}

export type MidTripCancelSettlement = {
  quoted: number
  cancelFee: number
  waived: number
  driverPayout: number
  feeRate: number
}

/** In-trip passenger cancel: driver keeps a cancellation fee; unused quoted fare is waived. */
export function settleMidTripCancelFee(quotedFare: number): MidTripCancelSettlement {
  const quoted = roundPi(Math.max(0, quotedFare))
  const feeRate = 0.4
  const cancelFee = roundPi(Math.min(quoted, Math.max(quoted > 0 ? 0.5 : 0, quoted * feeRate)))
  const waived = roundPi(quoted - cancelFee)
  return { quoted, cancelFee, waived, driverPayout: cancelFee, feeRate }
}

export function isRidePayLabel(label: string) {
  return /택시|대리/.test(label)
}
