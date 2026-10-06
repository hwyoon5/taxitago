import { NextResponse } from 'next/server'
import { Horizon } from '@stellar/stellar-sdk'
import { getAdminWallet } from '@/lib/admin-wallet'
import { isPiWalletAddress } from '@/lib/pi-wallet'
import { listDeposits, recordDeposit } from '@/lib/deposit-store'
import { recordWalletTx } from '@/lib/wallet-history'
import { isPiSandboxEnv } from '@/lib/pi-sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SCAN_LIMIT = 60

function horizonUrl() {
  const override = (process.env.PI_HORIZON_URL || '').trim()
  if (override) return override
  return isPiSandboxEnv() ? 'https://api.testnet.minepi.com' : 'https://api.mainnet.minepi.com'
}

type HorizonPayment = {
  type?: string
  transaction_hash?: string
  from?: string
  to?: string
  amount?: string
  created_at?: string
}

/**
 * 플랫폼 입금 지갑으로 들어온 Pi 결제를 Horizon에서 스캔해 장부에 기록한다.
 * 수동 승인 없이 즉시 confirmed로 반영되고 (txid) 멱등이라 폴링 중복도 안전하다.
 * ?from={wallet} — 해당 지갑이 보낸 입금만 반환한다.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const from = (params.get('from') || '').trim()
  const uid = (params.get('uid') || '').trim()
  const adminWallet = (await getAdminWallet()).trim()
  if (!isPiWalletAddress(adminWallet)) {
    return NextResponse.json({ ok: true, deposits: [], configured: false })
  }
  let records: HorizonPayment[] = []
  try {
    const server = new Horizon.Server(horizonUrl())
    const page = await server
      .payments()
      .forAccount(adminWallet)
      .order('desc')
      .limit(SCAN_LIMIT)
      .call()
    records = page.records as HorizonPayment[]
  } catch {
    return NextResponse.json({ ok: true, deposits: [], configured: true, scanError: true })
  }
  const inbound = records.filter(
    (record) => record.type === 'payment' && record.to === adminWallet && record.transaction_hash && record.from,
  )
  for (const record of inbound) {
    const amount = Number(record.amount)
    const deposit = await recordDeposit({
      txid: record.transaction_hash!,
      fromWallet: record.from!,
      fromUid: record.from === from ? uid : undefined,
      toWallet: adminWallet,
      amount,
      seenAt: record.created_at,
      status: 'confirmed',
    }).catch(() => null)
    if (deposit) {
      await recordWalletTx({
        kind: 'deposit',
        txid: deposit.txid,
        fromWallet: deposit.fromWallet,
        toWallet: deposit.toWallet,
        amount: deposit.amount,
        memo: deposit.memo,
        status: 'confirmed',
        network: isPiSandboxEnv() ? 'testnet' : 'mainnet',
      }).catch(() => undefined)
    }
  }
  // 스캔 범위 밖의 과거 입금도 유저별 조회에서 빠지지 않게 장부 기준으로 반환한다.
  const entries = await listDeposits()
  const deposits = entries.filter((entry) => {
    if (!from) return entry.toWallet === adminWallet
    return entry.fromWallet === from && entry.toWallet === adminWallet
  })
  return NextResponse.json({ ok: true, configured: true, deposits })
}
