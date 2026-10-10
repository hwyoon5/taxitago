import { isPiWalletAddress } from '@/lib/pi-wallet'
import { resolvePiSandbox, type PiNetworkMode } from '@/lib/pi-sandbox'

const TESTNET_HORIZON = 'https://api.testnet.minepi.com'
const MAINNET_HORIZON = 'https://api.mainnet.minepi.com'

/**
 * 네트워크별 공식 Pi(Horizon 호환) API 베이스.
 * PI_HORIZON_URL 커스텀 엔드포인트를 둘 수 있다(자체 Horizon 프록시 등).
 */
export function piHorizonBase(network: PiNetworkMode): string {
  const override = (process.env.PI_HORIZON_URL || '').trim()
  if (override) return override
  return network === 'testnet' ? TESTNET_HORIZON : MAINNET_HORIZON
}

export type PiOnchainBalance = {
  ok: boolean
  wallet: string
  network: PiNetworkMode
  /** native Pi 잔액 — 조회 성공 시 숫자(계정 미생성 포함 0), 실패 시 null. 절대 임의 생성하지 않는다. */
  balancePi: number | null
  /** Horizon에 계정이 존재하는지 — 404(미생성/미펀딩)면 false + balancePi 0. */
  accountExists: boolean
  horizon: string
  fetchedAt: string
  error?: 'invalid-wallet' | 'unreachable'
}

/**
 * 실제 온체인 Pi 잔액 조회 — 메인넷에서는 임의 잔액 생성 대신 이 함수가
 * Pi 공식 블록체인 API(GET {horizon}/accounts/{wallet})의 native balance를 읽는다.
 * 서버 전용: 브라우저가 이 함수 대신 /api/wallet/balance를 호출한다.
 * 읽기 전용 공개 API라 Pi API 키는 필요 없고, 실패해도 잔액을 지어내지 않는다.
 */
export async function fetchOnchainPiBalance(
  wallet: string,
  opts?: { sandbox?: boolean | null },
): Promise<PiOnchainBalance> {
  const network: PiNetworkMode = (typeof opts?.sandbox === 'boolean' ? opts.sandbox : resolvePiSandbox())
    ? 'testnet'
    : 'mainnet'
  const horizon = piHorizonBase(network)
  const base: Omit<PiOnchainBalance, 'ok' | 'balancePi' | 'accountExists'> = {
    wallet,
    network,
    horizon,
    fetchedAt: new Date().toISOString(),
  }

  if (!isPiWalletAddress(wallet)) {
    return { ...base, ok: false, balancePi: null, accountExists: false, error: 'invalid-wallet' }
  }

  try {
    const res = await fetch(`${horizon}/accounts/${encodeURIComponent(wallet)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 404) {
      // 체인에 계정이 아직 없다(미펀딩) — 실제 잔액 0으로 보고한다.
      return { ...base, ok: true, balancePi: 0, accountExists: false }
    }
    if (!res.ok) {
      return { ...base, ok: false, balancePi: null, accountExists: false, error: 'unreachable' }
    }
    const account = (await res.json().catch(() => null)) as {
      balances?: { asset_type?: string; balance?: string }[]
    } | null
    const native = (account?.balances ?? []).filter((entry) => !entry.asset_type || entry.asset_type === 'native')
    const balancePi = native.reduce((total, entry) => total + (Number(entry.balance) || 0), 0)
    return { ...base, ok: true, balancePi: Math.round(balancePi * 1_000_000) / 1_000_000, accountExists: true }
  } catch {
    return { ...base, ok: false, balancePi: null, accountExists: false, error: 'unreachable' }
  }
}
