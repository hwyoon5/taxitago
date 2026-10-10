import { Account, Asset, Horizon, Keypair, Memo, Operation, TransactionBuilder } from '@stellar/stellar-sdk'
import { isPiWalletAddress } from '@/lib/pi-wallet'
import { getAdminWallet, saveAdminWallet } from '@/lib/admin-wallet'
import { ADMIN_WALLET_SECRET_ENV, adminWalletSecret } from '@/lib/admin-wallet-secret'
import { recordWalletTx } from '@/lib/wallet-history'

/**
 * 플랫폼(관리자) 지갑에서 임의의 Pi 주소로 직접 송금하는 공용 경로.
 * 관리자 수수료 출금과 이용자 잔액 출금(사용자 지정 주소)이 공유한다.
 * 송금 실패는 에러로 돌려 호출자가 장부 차감을 하지 않게 한다.
 */

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

export type PiDirectSendResult =
  | { ok: true; txid: string; ledger: number | bigint; network: string; fromWallet: string }
  | { ok: false; status: number; error: string }

/** 실제 체인 송금 — 플랫폼 지갑 시드로 서명해 recipient 주소에 native Pi를 보낸다. */
export async function sendPiToAddress(input: {
  recipient: string
  amount: number
  memoText: string
  /** 지갑 내역·감사 로그에 남는 사유 */
  reason?: string
  /** 'fee' = 수수료 수익 인출(순수익 차감), 'user' = 이용자 잔액 반환(수익 무관). 기본 'fee'. */
  purpose?: 'fee' | 'user'
  sandbox: boolean
}): Promise<PiDirectSendResult> {
  const { recipient, amount, memoText, reason = '', purpose = 'fee', sandbox } = input
  const secret = adminWalletSecret()
  if (!secret) {
    return { ok: false, status: 500, error: `${ADMIN_WALLET_SECRET_ENV} 환경 변수가 설정되지 않았습니다.` }
  }
  let keypair: Keypair
  try {
    keypair = Keypair.fromSecret(secret)
  } catch {
    return { ok: false, status: 500, error: '관리자 지갑 비밀 키 형식이 올바르지 않습니다. (S로 시작하는 56자리 시드)' }
  }

  // The secret must control the configured admin wallet — otherwise an env
  // mismatch would silently send funds from a different wallet than expected.
  const adminWallet = await getAdminWallet()
  if (isPiWalletAddress(adminWallet) && adminWallet !== keypair.publicKey()) {
    return { ok: false, status: 409, error: '비밀 키가 등록된 관리자 지갑 주소와 일치하지 않습니다.' }
  }
  // 아직 데모 플레이스홀더만 등록되어 있다면 시드에서 파생된 공개 주소를
  // 관리자 지갑으로 자동 등록해 추가 설정 없이 바로 출금할 수 있게 한다.
  if (!isPiWalletAddress(adminWallet)) {
    await saveAdminWallet(keypair.publicKey()).catch(() => undefined)
  }

  const { url, passphrase } = horizonFor(sandbox)
  const recordFailed = (message: string) =>
    recordWalletTx({
      kind: 'withdraw',
      fromWallet: keypair.publicKey(),
      toWallet: recipient,
      amount,
      memo: reason || memoText,
      status: 'failed',
      error: message,
      purpose,
      network: sandbox ? 'testnet' : 'mainnet',
    }).catch(() => undefined)

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
      await recordFailed(message)
      return { ok: false, status: 400, error: message }
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
      purpose,
      network: sandbox ? 'testnet' : 'mainnet',
    }).catch(() => undefined)
    return {
      ok: true,
      txid: result.hash,
      ledger: result.ledger,
      network: sandbox ? 'testnet' : 'mainnet',
      fromWallet: keypair.publicKey(),
    }
  } catch (error) {
    const message = horizonError(error)
    await recordFailed(message)
    return { ok: false, status: 502, error: message }
  }
}
