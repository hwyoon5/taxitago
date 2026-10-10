import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { recordAudit } from '@/lib/audit-store'
import { listPartnerLinks } from '@/lib/partner-ledger-server'
import { piRound } from '@/lib/pi-format'
import {
  getRegistryUser,
  listRegistryUsers,
  matchUserQuery,
  registryStats,
  setUserLock,
  upsertRegistryUser,
  type RegistryUser,
} from '@/lib/user-registry'
import {
  creditUserDeposit,
  recordUserSpend,
  userSpendableBalance,
  userCreditTotals,
  userSpendTotals,
} from '@/lib/user-credit-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 레지스트리를 권위로 하되, 이전 인메모리 연동 장부(partner-ledger)에만
 * 있는 가입자도 목록에 병합한다 — 배포 전 가입자가 누락되지 않게.
 */
async function mergedUsers(): Promise<RegistryUser[]> {
  const [registry, links] = await Promise.all([listRegistryUsers(), Promise.resolve(listPartnerLinks())])
  const merged = new Map<string, RegistryUser>(registry.map((u) => [u.uid, u]))
  for (const link of links) {
    const existing = merged.get(link.uid)
    if (existing) {
      // 인메모리 링크가 더 최신이면 표시 필드만 보강 — 잠금 상태는 레지스트리 유지.
      if (link.updatedAt > existing.updatedAt) {
        merged.set(link.uid, { ...existing, ...pickLinkFields(link), lockedAt: existing.lockedAt, lockedBy: existing.lockedBy, lockReason: existing.lockReason })
      }
      continue
    }
    merged.set(link.uid, {
      uid: link.uid,
      username: link.username,
      wallet: link.wallet,
      role: link.role,
      name: link.name,
      phone: link.phone,
      detail: link.detail,
      vehicle: link.vehicle,
      plate: link.plate,
      region: link.region,
      serviceType: link.serviceType,
      insuranceCompany: link.insuranceCompany,
      insurancePolicyNo: link.insurancePolicyNo,
      insuranceExpiresAt: link.insuranceExpiresAt,
      insuranceDocName: link.insuranceDocName,
      insuranceDocAt: link.insuranceDocAt,
      linkedAt: link.linkedAt,
      updatedAt: link.updatedAt,
    })
  }
  return [...merged.values()].sort((a, b) => b.linkedAt.localeCompare(a.linkedAt))
}

function pickLinkFields(link: ReturnType<typeof listPartnerLinks>[number]) {
  return {
    username: link.username,
    wallet: link.wallet,
    role: link.role,
    name: link.name,
    phone: link.phone,
    detail: link.detail,
    vehicle: link.vehicle,
    plate: link.plate,
    region: link.region,
    serviceType: link.serviceType,
    insuranceCompany: link.insuranceCompany,
    insurancePolicyNo: link.insurancePolicyNo,
    insuranceExpiresAt: link.insuranceExpiresAt,
    insuranceDocName: link.insuranceDocName,
    insuranceDocAt: link.insuranceDocAt,
    linkedAt: link.linkedAt,
    updatedAt: link.updatedAt,
  }
}

export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const q = new URL(request.url).searchParams.get('q')?.trim() || ''
  const users = (await mergedUsers()).filter((user) => matchUserQuery(user, q))
  // 잔액은 서버 장부(크레딧−지출) 기준으로 첨부한다.
  const rows = await Promise.all(
    users.map(async (user) => {
      const [spendable, credits, spends] = await Promise.all([
        userSpendableBalance(user.wallet, user.uid).catch(() => 0),
        userCreditTotals(user.wallet, user.uid).catch(() => ({ count: 0, total: 0 })),
        userSpendTotals(user.wallet, user.uid).catch(() => ({ count: 0, total: 0 })),
      ])
      return {
        ...user,
        locked: Boolean(user.lockedAt),
        spendable,
        creditTotal: credits.total,
        spendTotal: spends.total,
      }
    }),
  )
  return NextResponse.json({ ok: true, users: rows, stats: registryStats(rows) })
}

export async function PATCH(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as {
    action?: unknown
    uid?: unknown
    reason?: unknown
    name?: unknown
    phone?: unknown
  } | null
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 })

  if (body?.action === 'lock' || body?.action === 'unlock') {
    const locked = body.action === 'lock'
    // 인메모리 링크만 있는 사용자도 레지스트리에 레코드를 만들어 잠긴다.
    if (!(await getRegistryUser(uid))) {
      const link = listPartnerLinks().find((row) => row.uid === uid)
      if (link) await upsertRegistryUser({ uid: link.uid, ...pickLinkFields(link) })
      else if (!locked) return NextResponse.json({ error: 'not_found' }, { status: 404 })
      else await upsertRegistryUser({ uid })
    }
    const user = await setUserLock(uid, locked, {
      by: `${actor.staffName || actor.staffId}${actor.position ? `(${actor.position})` : ''}`,
      reason,
    })
    if (!user) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await recordAudit({
      kind: 'user',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: uid,
      reason: reason || (locked ? '계정 이용 정지' : '이용 정지 해제'),
      detail: `${locked ? '계정 Lock' : 'Lock 해제'} ${user.name || user.username}(${uid})${reason ? ` · 사유: ${reason}` : ''}`,
      after: { uid, locked: Boolean(user.lockedAt), lockReason: user.lockReason },
    }).catch(() => undefined)
    return NextResponse.json({ ok: true, user })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

/** 관리자 수동 입·출금 보정 — 정산 오류·보상 처리용. 반드시 사유를 남긴다. */
export async function POST(request: Request) {
  const actor = await adminActor(request)
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as {
    action?: unknown
    uid?: unknown
    wallet?: unknown
    amount?: unknown
    reason?: unknown
  } | null
  const uid = typeof body?.uid === 'string' ? body.uid.trim() : ''
  const wallet = typeof body?.wallet === 'string' ? body.wallet.trim() : ''
  const amount = piRound(Number(body?.amount))
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (!uid) return NextResponse.json({ error: 'uid required' }, { status: 400 })
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: '금액은 0보다 큰 숫자여야 합니다.' }, { status: 400 })
  }
  if (!reason) return NextResponse.json({ error: '보정 사유를 입력해 주세요.' }, { status: 400 })
  if (body?.action !== 'credit' && body?.action !== 'debit') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }
  // 인메모리 링크만 있는 사용자도 보정 대상이 되게 레지스트리를 보강한다.
  if (!(await getRegistryUser(uid))) {
    const link = listPartnerLinks().find((row) => row.uid === uid)
    if (link) await upsertRegistryUser({ uid: link.uid, ...pickLinkFields(link) })
    else await upsertRegistryUser({ uid, wallet })
  }

  const stamp = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
  const actorLabel = `${actor.staffName || actor.staffId}${actor.position ? `(${actor.position})` : ''}`
  if (body.action === 'credit') {
    const entry = await creditUserDeposit({
      txid: `admin-credit-${stamp}`,
      wallet,
      uid,
      amount,
      source: 'manual',
    })
    if (!entry) return NextResponse.json({ error: '입금 보정에 실패했습니다.' }, { status: 500 })
    await recordAudit({
      kind: 'adjust',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: uid,
      reason,
      detail: `수동 입금 +${amount} Pi → ${uid} · 처리자 ${actorLabel}`,
      after: { txid: entry.txid, amount, kind: 'admin-credit' },
    }).catch(() => undefined)
  } else {
    const entry = await recordUserSpend({
      txid: `admin-debit-${stamp}`,
      wallet,
      uid,
      amount,
      label: `관리자 보정: ${reason}`.slice(0, 60),
    })
    if (!entry) return NextResponse.json({ error: '출금 보정에 실패했습니다.' }, { status: 500 })
    await recordAudit({
      kind: 'adjust',
      actor: actor.staffId,
      actorName: actor.staffName,
      refId: uid,
      reason,
      detail: `수동 출금 -${amount} Pi ← ${uid} · 처리자 ${actorLabel}`,
      after: { txid: entry.txid, amount, kind: 'admin-debit' },
    }).catch(() => undefined)
  }
  const spendable = await userSpendableBalance(wallet, uid).catch(() => null)
  return NextResponse.json({ ok: true, spendable })
}
