import { NextResponse } from 'next/server'
import { listDeposits } from '@/lib/deposit-store'
import { scanInboundDeposits } from '@/lib/deposit-scan'
import { userCreditTotals, userSpendableBalance, walletsForUid, withdrawnDepositTxids } from '@/lib/user-credit-store'
import { knownServiceTxids } from '@/lib/payment-kind-store'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 플랫폼 입금 지갑으로 들어온 Pi 결제를 Horizon에서 스캔해 장부에 기록하고,
 * 호출한 이용자(지갑 주소 또는 Pi uid)에게 귀속되는 confirmed 입금만 반환한다.
 * ?from={wallet} — 해당 지갑이 보낸 입금. &uid={pi_uid} — uid로 귀속 기록된 입금.
 *
 * 사전 충전 폐지 이후: 입금은 감사·이력 용도로만 기록되며 이용자 잔액 크레딧을
 * 부여하지 않는다. 서비스 요금은 종료 시점 Pi SDK 직결제로 정산된다.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const from = (params.get('from') || '').trim()
  const uid = (params.get('uid') || '').trim()
  const sandboxParam = (params.get('sandbox') || '').trim().toLowerCase()
  const sandboxHint = sandboxParam === 'true' ? true : sandboxParam === 'false' ? false : null
  const effectiveSandbox = isPiSandboxRequest(request, sandboxHint)
  console.log('[Deposit] GET /api/wallet/deposits', { from: from || '(none)', uid: uid || '(none)', sandboxHint, effectiveSandbox })
  // 식별자 없는 호출에는 전체 장부를 노출하지 않는다 — 이용자 조회 전용 엔드포인트.
  if (!from && !uid) {
    return NextResponse.json({ ok: true, deposits: [], configured: true })
  }
  // 스캔 자체의 예외가 라우트를 500으로 죽이지 않게 방어한다.
  const scan = await scanInboundDeposits(from, uid, effectiveSandbox).catch((error) => {
    console.error('[Deposit] GET scan threw', error)
    return { configured: true, scanned: 0, scanError: true, adminWallet: '' }
  })
  if (!scan.configured) {
    return NextResponse.json({ ok: true, deposits: [], configured: false })
  }
  if (scan.scanError) {
    return NextResponse.json({ ok: true, deposits: [], configured: true, scanError: true })
  }
  const adminWallet = scan.adminWallet
  // 스캔 범위 밖의 과거 입금도 유저별 조회에서 빠지지 않게 장부 기준으로 반환한다.
  // confirmed 건만 반환 — pending은 이용자 잔액에 반영되지 않는다.
  const entries = await listDeposits()
  // 서비스 결제로 확정된 txid는 이용자 입금이 아니다 — 잔액 크레딧 대상에서 제외.
  const serviceTxids = await knownServiceTxids().catch(() => new Set<string>())
  // 탈퇴 계정의 과거 입금 — 재가입자(동일 uid·지갑)에게 다시 귀속되면 안 된다.
  const withdrawnTxids = await withdrawnDepositTxids().catch(() => new Set<string>())
  // 클라이언트가 보내는 from은 uid 유사주소일 수 있어 실제 on-chain 주소와
  // 불일치한다 — 과거 결제로 확인된 지갑↔uid 연결로 진짜 주소 매칭도 커버.
  const linkedWallets = uid ? await walletsForUid(uid).catch(() => new Set<string>()) : new Set<string>()
  const matched = entries.filter((entry) => {
    if (entry.status !== 'confirmed') return false
    if (entry.toWallet !== adminWallet) return false
    if (serviceTxids.has(entry.txid)) return false
    if (withdrawnTxids.has(entry.txid)) return false
    return (
      (from !== '' && entry.fromWallet === from) ||
      (uid !== '' && (entry.fromUid === uid || linkedWallets.has(entry.fromWallet)))
    )
  })
  console.log('[Deposit] GET matched', { total: entries.length, matched: matched.length, uid, linkedWallets: linkedWallets.size })
  const creditsTotal = await userCreditTotals(from, uid)
  const spendable = await userSpendableBalance(from, uid)
  // balance — 누적 입금 크레딧(지출 전), spendable — 지출 차감 후 사용 가능 잔액.
  return NextResponse.json({ ok: true, configured: true, deposits: matched, creditsTotal, balance: creditsTotal.total, spendable })
}

/**
 * 사전 충전 폐지 — 이용자 셀프 입금 클레임(잔액 크레딧 귀속)은 종료되었다.
 * 서비스 요금은 이용 종료 시점에 Pi SDK 결제로 직접 정산한다.
 */
export async function POST() {
  return NextResponse.json(
    { ok: false, error: '사전 충전은 지원되지 않습니다. 서비스 이용 종료 시점에 Pi 결제로 바로 정산해 주세요.' },
    { status: 410 },
  )
}
