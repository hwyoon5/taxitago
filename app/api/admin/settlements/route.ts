import { NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'
import {
  getCommissionRates,
  listSettlements,
  markAllSettlementsSettled,
  markSettlementSettled,
  saveCommissionRates,
  settlementStorageBackend,
} from '@/lib/settlement-store'
import type { CommissionRates, SettlementEntry, SettlementService } from '@/lib/settlement-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SERVICES: SettlementService[] = ['taxi', 'daeri', 'delivery', 'bicycle', 'kickboard', 'ev', 'parking']
const SERVICE_LABEL: Record<SettlementService, string> = {
  taxi: '택시',
  daeri: '대리운전',
  delivery: '택배',
  bicycle: '자전거',
  kickboard: '킥보드',
  ev: 'EV충전',
  parking: '주차',
}

function summarize(entries: SettlementEntry[]) {
  const byService = Object.fromEntries(
    SERVICES.map((service) => [service, { label: SERVICE_LABEL[service], count: 0, gross: 0, commission: 0, net: 0 }]),
  ) as Record<SettlementService, { label: string; count: number; gross: number; commission: number; net: number }>
  let gross = 0
  let commission = 0
  let net = 0
  let pendingCount = 0
  let pendingNet = 0
  for (const entry of entries) {
    const bucket = byService[entry.service]
    if (bucket) {
      bucket.count += 1
      bucket.gross += entry.gross
      bucket.commission += entry.commission
      bucket.net += entry.net
    }
    gross += entry.gross
    commission += entry.commission
    net += entry.net
    if (entry.status === 'pending') {
      pendingCount += 1
      pendingNet += entry.net
    }
  }
  const round = (value: number) => Math.round(value * 100) / 100
  for (const service of SERVICES) {
    byService[service].gross = round(byService[service].gross)
    byService[service].commission = round(byService[service].commission)
    byService[service].net = round(byService[service].net)
  }
  return {
    count: entries.length,
    gross: round(gross),
    commission: round(commission),
    net: round(net),
    pendingCount,
    pendingNet: round(pendingNet),
    byService,
  }
}

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const [rates, entries] = await Promise.all([getCommissionRates(), listSettlements()])
  return NextResponse.json({ ok: true, rates, entries, summary: summarize(entries), storage: settlementStorageBackend() })
}

export async function PATCH(request: Request) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as {
    action?: unknown
    id?: unknown
    rates?: Record<string, unknown>
  } | null
  const action = body?.action

  if (action === 'rates') {
    const next = {} as CommissionRates
    for (const service of SERVICES) {
      const raw = Number(body?.rates?.[service])
      next[service] = Number.isFinite(raw) ? Math.min(50, Math.max(0, Math.round(raw * 10) / 10)) : 0
    }
    const rates = await saveCommissionRates(next)
    return NextResponse.json({ ok: true, rates })
  }

  if (action === 'settle') {
    const id = typeof body?.id === 'string' ? body.id : ''
    const entry = await markSettlementSettled(id)
    if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ ok: true, entry })
  }

  if (action === 'settle-all') {
    const count = await markAllSettlementsSettled()
    return NextResponse.json({ ok: true, count })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
