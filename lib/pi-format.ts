/** Pi Network amounts carry up to 7 decimal places — round and display accordingly. */
export const PI_DECIMALS = 7

const PI_SCALE = 10 ** PI_DECIMALS

/** Round to the Pi sub-cent precision (7 decimals) without float drift. */
export function piRound(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * PI_SCALE) / PI_SCALE
}

/** Fixed 7-decimal text — the canonical precision for payment/settlement UI. */
export function piText(value: number): string {
  return piRound(value).toFixed(PI_DECIMALS)
}

export function piLabel(value: number): string {
  return `${piText(value)} Pi`
}
