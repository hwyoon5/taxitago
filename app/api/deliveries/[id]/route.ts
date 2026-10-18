import { NextResponse } from 'next/server'
import { deleteDeliveryDispatch, getDeliveryDispatch, markDeliveryPayment, publicDelivery, setDeliveryPhotoCount, updateDeliveryDispatch } from '@/lib/delivery-dispatch'
import { sanitizeAttachments, saveAttachments } from '@/lib/attachment-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const job = await getDeliveryDispatch(id)
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // viewer=발신인이면 기사 연락처, viewer=배정 기사면 발신·수신 연락처가 노출된다.
  const viewer = new URL(request.url).searchParams.get('viewer')?.trim()
  return NextResponse.json({ ok: true, job: publicDelivery(job, viewer || undefined) })
}

const EDITABLE = ['pickupAddress', 'pickupLat', 'pickupLng', 'destAddress', 'destLat', 'destLng', 'packageLabel', 'vehicle', 'packageSize', 'fare', 'senderPhone', 'recipientPhone', 'scheduledAt', 'driverNote'] as const

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const ownerId = typeof body?.ownerId === 'string' ? body.ownerId.trim() : ''
  if (!ownerId) return NextResponse.json({ error: 'ownerId required' }, { status: 400 })
  // 소유권을 먼저 확인 — 사진/결제 기록이 타인 건에 쓰이지 않도록 한다.
  const existing = await getDeliveryDispatch(id)
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (existing.ownerId && existing.ownerId !== ownerId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  // 결제 수단·완료 표시 — txid는 서버가 검증한 결제만 인정한다.
  // 'b2b_invoice'는 이 건이 법인 과금으로 태깅된 경우만 허용한다.
  const method = body?.paymentMethod
  if (method === 'b2b_invoice') {
    if (!existing.b2bOrgId) {
      return NextResponse.json({ error: '법인 과금 대상이 아닌 배송 건입니다.' }, { status: 403 })
    }
    await markDeliveryPayment(id, ownerId, 'b2b_invoice', null)
  }
  if (method === 'prepay_pi' || method === 'onsite_qr') {
    const txid = typeof body?.paymentTxid === 'string' ? body.paymentTxid.trim() : ''
    if (method === 'prepay_pi' && !txid) {
      return NextResponse.json({ error: 'paymentTxid required' }, { status: 400 })
    }
    if (txid) {
      const { paymentKindOf } = await import('@/lib/payment-kind-store')
      const kind = await paymentKindOf(txid).catch(() => '')
      if (!kind) return NextResponse.json({ error: 'payment not verified by this server' }, { status: 409 })
    }
    await markDeliveryPayment(id, ownerId, method, txid || null)
  }
  // 사진 재첨부 — 전달된 경우 통째로 교체한다.
  const photos = sanitizeAttachments(body?.photos)
  if (photos.length) {
    const saved = await saveAttachments(id, photos)
    if (saved.length) await setDeliveryPhotoCount(id, saved.length)
  }
  // 결제/사진만 갱신하는 요청은 배정 후에도 허용 — 주소·요금 등 수정은 requested만.
  const hasEditable = EDITABLE.some((key) => key in (body ?? {}))
  if (!hasEditable) {
    const job = await getDeliveryDispatch(id)
    return NextResponse.json({ ok: true, job: job ? publicDelivery(job, ownerId) : null })
  }
  const patch: Record<string, unknown> = {}
  for (const key of EDITABLE) if (key in (body ?? {})) patch[key] = body?.[key]
  const result = await updateDeliveryDispatch(id, ownerId, patch)
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
  const result = await deleteDeliveryDispatch(id, ownerId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'not_found' ? 404 : result.error === 'forbidden' ? 403 : 409 })
  }
  return NextResponse.json({ ok: true })
}
