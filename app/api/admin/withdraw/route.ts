import { NextResponse } from 'next/server'
import { Account, Asset, Horizon, Keypair, Memo, Operation, TransactionBuilder } from '@stellar/stellar-sdk'
import { adminActor } from '@/lib/admin-auth'
import { isPiWalletAddress, piWalletError } from '@/lib/pi-wallet'
import { getAdminWallet, saveAdminWallet } from '@/lib/admin-wallet'
import { ADMIN_WALLET_SECRET_ENV, adminWalletSecret } from '@/lib/admin-wallet-secret'
import { recordAudit } from '@/lib/audit-store'
import { recordWalletTx } from '@/lib/wallet-history'
import { piRound } from '@/lib/pi-format'
import { isPiSandboxEnv } from '@/lib/pi-sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_WITHDRAW_PI = 10_000
/** Pi mainnet requires a 0.01 Pi base fee (100_000 stroops); pay at least that everywhere. */
const MIN_FEE_STROOPS = 100_000

function horizonFor(sandbox: boolean) {
  const url = (process.env.PI_HORIZON_URL || '').trim()
  const passphrase =
    (process.env.PI_NETWORK_PASSPHRASE || '').trim() || (sandbox ? 'Pi Testnet' : 'Pi Network')
  if (url) return { url, passphrase }
  return sandbox
    ? { url: 'https://api.testnet.minepi.com', passphrase: 'Pi Testnet' }
    : { url: 'https://api.mainnet.minepi.com', passphrase: 'Pi Network' }
}

function horizonError(error: unknown): string {
  const data = (error as {
    response?: { data?: { extras?: { result_codes?: Record<string, string> }; detail?: string } }
  })?.response?.data
  const codes = data?.extras?.result_codes ?? {}
  const op = codes.operations
  if (op === 'op_underfunded' || codes.transaction === 'tx_insufficient_balance') {
    return '관리자 지갑 잔액이 부족합니다.'
  }
  if (op === 'op_no_destination') return '수신 주소가 네트워크에 존재하지 않습니다. (활성화되지 않은 계정)'
  if (op === 'op_malformed') return '수신 주소 또는 금액 형식이 올바르지 않습니다.'
  if (codes.transaction === 'tx_bad_seq') return '시퀀스 충돌입니다. 잠시 후 다시 시도해 주세요.'
  if (codes.transaction === 'tx_insufficient_fee') return '네트워크 수수료가 부족합니다. 잠시 후 다시 시도해 주세요.'
  if (codes.transaction === 'tx_bad_auth' || codes.transaction === 'tx_bad_auth_extra') {
    return '트랜잭션 서명이 올바르지 않습니다.'
  }
  if (codes.transaction === 'tx_failed') return '네트워크가 트랜잭션을 거부했습니다.'
  if (typeof data?.detail === 'string' && data.detail) return data.detail
  if (error instanceof Error && error.message) return error.message
  return '출금 트랜잭션에 실패했습니다.'
}

export async function POST(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as {
    recipientAddress?: unknown
    amount?: unknown
    memo?: unknown
    reason?: unknown
  } | null

  const recipient = typeof body?.recipientAddress === 'string' ? body.recipientAddress.trim() : ''
  if (!isPiWalletAddress(recipient)) {
    return NextResponse.json(
      { error: piWalletError(recipient) ?? '수신 지갑 주소가 올바르지 않습니다.' },
      { status: 400 },
    )
  }
  const amount = piRound(Number(body?.amount))
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_WITHDRAW_PI) {
    return NextResponse.json(
      { error: `출금 금액은 0보다 크고 ${MAX_WITHDRAW_PI.toLocaleString('ko-KR')} Pi 이하여야 합니다.` },
      { status: 400 },
    )
  }
  const memoText = typeof body?.memo === 'string' ? body.memo.trim() : ''
  if (memoText && Buffer.byteLength(memoText, 'utf8') > 28) {
    return NextResponse.json({ error: '메모는 28바이트를 초과할 수 없습니다.' }, { status: 400 })
  }
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

  const secret = adminWalletSecret()
  if (!secret) {
    return NextResponse.json(
      { error: `${ADMIN_WALLET_SECRET_ENV} 환경 변수가 설정되지 않았습니다.` },
      { status: 500 },
    )
  }
  let keypair: Keypair
  try {
    keypair = Keypair.fromSecret(secret)
  } catch {
    return NextResponse.json(
      { error: '관리자 지갑 비밀 키 형식이 올바르지 않습니다. (S로 시작하는 56자리 시드)' },
      { status: 500 },
    )
  }

  // The secret must control the configured admin wallet — otherwise an env
  // mismatch would silently send funds from a different wallet than expected.
  const adminWallet = await getAdminWallet()
  if (isPiWalletAddress(adminWallet) && adminWallet !== keypair.publicKey()) {
    return NextResponse.json(
      { error: '비밀 키가 등록된 관리자 지갑 주소와 일치하지 않습니다.' },
      { status: 409 },
    )
  }
  // 아직 데모 플레이스홀더만 등록되어 있다면 시드에서 파생된 공개 주소를
  // 관리자 지갑으로 자동 등록해 추가 설정 없이 바로 출금할 수 있게 한다.
  if (!isPiWalletAddress(adminWallet)) {
    await saveAdminWallet(keypair.publicKey()).catch(() => undefined)
  }

  const sandbox = isPiSandboxEnv()
  const { url, passphrase } = horizonFor(sandbox)

  try {
    const server = new Horizon.Server(url)
    const record = await server.accounts().accountId(keypair.publicKey()).call()
    const account = new Account(keypair.publicKey(), record.sequence)
    const native = record.balances.find((line) => line.asset_type === 'native')
    const balance = Number(native?.balance ?? '0')
    const baseFee = await server.fetchBaseFee().catch(() => 0)
    const fee = Math.max(baseFee || 0, MIN_FEE_STROOPS)
    const feePi = fee / 1e7
    if (Number.isFinite(balance) && balance < amount + feePi) {
      const message = `관리자 지갑 잔액이 부족합니다. 잔액 ${balance.toFixed(7)} Pi < 필요 ${(amount + feePi).toFixed(7)} Pi (수수료 포함)`
      await recordWalletTx({
        kind: 'withdraw',
        fromWallet: keypair.publicKey(),
        toWallet: recipient,
        amount,
        memo: reason || memoText,
        status: 'failed',
        error: message,
        network: sandbox ? 'testnet' : 'mainnet',
      }).catch(() => undefined)
      return NextResponse.json({ error: message }, { status: 400 })
    }
    const builder = new TransactionBuilder(account, { fee: String(fee), networkPassphrase: passphrase })
      .addOperation(
        Operation.payment({ destination: recipient, asset: Asset.native(), amount: amount.toFixed(7) }),
      )
      .setTimeout(180)
    if (memoText) builder.addMemo(Memo.text(memoText))
    const transaction = builder.build()
    transaction.sign(keypair)
    const result = await server.submitTransaction(transaction, { skipMemoRequiredCheck: true })
    await recordWalletTx({
      kind: 'withdraw',
      txid: result.hash,
      fromWallet: keypair.publicKey(),
      toWallet: recipient,
      amount,
      memo: reason || memoText,
      status: 'confirmed',
      fee: feePi,
      network: sandbox ? 'testnet' : 'mainnet',
    }).catch(() => undefined)
    await recordAudit({
      kind: 'withdraw',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: `withdraw:${result.hash}`,
      reason: reason || memoText,
      detail: `${keypair.publicKey()} → ${recipient} · ${amount.toFixed(7)}Pi (${sandbox ? 'testnet' : 'mainnet'})`,
      after: { txid: result.hash, amount, recipient },
    }).catch(() => undefined)
    return NextResponse.json({
      ok: true,
      txid: result.hash,
      ledger: result.ledger,
      amount,
      recipient,
      network: sandbox ? 'testnet' : 'mainnet',
    })
  } catch (error) {
    const message = horizonError(error)
    await recordWalletTx({
      kind: 'withdraw',
      fromWallet: keypair.publicKey(),
      toWallet: recipient,
      amount,
      memo: reason || memoText,
      status: 'failed',
      error: message,
      network: sandbox ? 'testnet' : 'mainnet',
    }).catch(() => undefined)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
