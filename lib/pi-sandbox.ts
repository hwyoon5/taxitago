export function isPiSandboxEnv() {
  const raw = (process.env.NEXT_PUBLIC_PI_SANDBOX ?? process.env.PI_SANDBOX ?? 'true').trim().toLowerCase()
  return raw !== 'false' && raw !== '0' && raw !== 'mainnet'
}

export function parseChargeAmount(value: unknown) {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  const rounded = Math.round(amount * 1_000_000) / 1_000_000
  if (!Number.isFinite(rounded) || rounded <= 0 || rounded > 10_000) return null
  return rounded
}
