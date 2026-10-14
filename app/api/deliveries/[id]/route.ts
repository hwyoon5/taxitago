import { NextResponse } from 'next/server'
import { deleteDeliveryDispatch, getDeliveryDispatch, publicDelivery, updateDeliveryDispatch } from '@/lib/delivery-dispatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const job = getDeliveryDispatch(id)
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // viewer=발신인이면 기사 연락처, viewer=배정 기사면 발신·수신 연락처가 노출된다.
  const viewer = new URL(request.url).searchParams.get('viewer')?.trim()
  return NextResponse.json({ ok: true, job: publicDelivery(job, viewer || undefined) })
}

const EDITABLE = ['pickupAddress', 'pickupLat', 'pickupLng', 'destAddress', 'destLat', 'destLng', 'packageLabel', 'vehicle', 'packageSize', 'fare', 'senderPhone', 'recipientPhone', 'scheduledAt'] as const

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const ownerId = typeof body?.ownerId === 'string' ? body.ownerId.trim() : ''
  if (!ownerId) return NextResponse.json({ error: 'ownerId required' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  for (const key of EDITABLE) if (key in (body ?? {})) patch[key] = body?.[key]
  const result = updateDeliveryDispatch(id, ownerId, patch)
  if (!result.ok || !result.job) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'not_found' ? 404 : result.error === 'forbidden' ? 403 : 409 })
  }
  return NextResponse.json({ ok: true, job: publicDelivery(result.job, ownerId) })
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const ownerId =
    (typeof body?.ownerId === 'string' ? body.ownerId.trim() : '') ||
    new URL(request.url).searchParams.get('ownerId')?.trim() || ''
  if (!ownerId) return NextResponse.json({ error: 'ownerId required' }, { status: 400 })
  const result = deleteDeliveryDispatch(id, ownerId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'not_found' ? 404 : result.error === 'forbidden' ? 403 : 409 })
  }
  return NextResponse.json({ ok: true })
}
