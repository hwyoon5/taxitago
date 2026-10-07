import { NextResponse } from 'next/server'
import { listDeposits } from '@/lib/deposit-store'
import { scanInboundDeposits } from '@/lib/deposit-scan'
import { creditUserDeposit, listUserCredits, userCreditTotals } from '@/lib/user-credit-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 플랫폼 입금 지갑으로 들어온 Pi 결제를 Horizon에서 스캔해 장부에 기록하고,
 * 호출한 이용자(지갑 주소 또는 Pi uid)에게 귀속되는 confirmed 입금만 반환한다.
 * ?from={wallet} — 해당 지갑이 보낸 입금. &uid={pi_uid} — uid로 귀속 기록된 입금.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const from = (params.get('from') || '').trim()
  const uid = (params.get('uid') || '').trim()
  const scan = await scanInboundDeposits(from, uid)
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
  const matched = entries.filter((entry) => {
    if (entry.status !== 'confirmed') return false
    if (entry.toWallet !== adminWallet) return false
    if (!from) return true
    return entry.fromWallet === from || (uid !== '' && entry.fromUid === uid)
  })
  // 반환되는 입금은 이용자 크레딧 귀속도 함께 보장한다 — 장부에 있는데
  // 크레딧이 빠진 과거 건도 여기서 복구된다(txid 멱등).
  const credits = await listUserCredits()
  const creditedTxids = new Set(credits.map((credit) => credit.txid))
  for (const entry of matched) {
    if (!entry.txid || creditedTxids.has(entry.txid)) continue
    const credited = await creditUserDeposit({
      txid: entry.txid,
      wallet: entry.fromWallet,
      uid: entry.fromUid || uid,
      amount: entry.amount,
      source: 'scan',
    }).catch(() => null)
    if (credited) creditedTxids.add(entry.txid)
  }
  const deposits = matched.map((entry) => ({ ...entry, userCredited: creditedTxids.has(entry.txid) }))
  const creditsTotal = await userCreditTotals(from, uid)
  // balance — 서버 장부에 귀속된 해당 이용자의 누적 입금 잔액(크레딧 롤업).
  return NextResponse.json({ ok: true, configured: true, deposits, creditsTotal, balance: creditsTotal.total })
}
