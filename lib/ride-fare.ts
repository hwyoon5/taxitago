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

export function isRidePayLabel(label: string) {
  return /택시|대리/.test(label)
}
