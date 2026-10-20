const fs = require('fs')
const load = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const save = (p, s) => fs.writeFileSync(p, s)
const need = (s, frag, label) => { if (!s.includes(frag)) throw new Error('MISSING ' + label) }

// ── 1. lib/delivery-dispatch.ts — 좌표·예약·소유자 + 수정/삭제 ───────────────
{
  const p = 'lib/delivery-dispatch.ts'
  let s = load(p)
  need(s, `export type DeliveryDispatch = {
  id: string
  pickupAddress: string
  destAddress: string`, 'A1')
  s = s.replace(`export type DeliveryDispatch = {
  id: string
  pickupAddress: string
  destAddress: string`,
`export type DeliveryDispatch = {
  id: string
  /** 발신인 식별자 — 수정·삭제 권한 검사와 '내 택배' 목록 필터에 쓴다. */
  ownerId?: string
  pickupAddress: string
  pickupLat?: number | null
  pickupLng?: number | null
  destAddress: string
  destLat?: number | null
  destLng?: number | null
  /** 예약 수거 시각(ISO) — null/없으면 즉시 배송. */
  scheduledAt?: string | null
  vehicle?: string
  packageSize?: string`)

  need(s, `export function listOpenDeliveries() {`, 'A2')
  s = s.replace(`export function listOpenDeliveries() {`,
`/** 발신인 소유 건 전체(상태 무관) — 최신순. */
export function listDeliveriesByOwner(ownerId: string) {
  return [...db().jobs.values()]
    .filter((job) => job.ownerId === ownerId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

/** 미배차 건만 발신인 본인이 고칠 수 있다. */
export function updateDeliveryDispatch(id: string, ownerId: string, patch: Partial<DeliveryDispatch>) {
  const job = getDeliveryDispatch(id)
  if (!job) return { ok: false as const, error: 'not_found' as const, job: null }
  if (job.ownerId && job.ownerId !== ownerId) return { ok: false as const, error: 'forbidden' as const, job: null }
  if (job.status !== 'requested') return { ok: false as const, error: 'already_assigned' as const, job }
  const editable = ['pickupAddress', 'pickupLat', 'pickupLng', 'destAddress', 'destLat', 'destLng', 'packageLabel', 'vehicle', 'packageSize', 'fare', 'senderPhone', 'recipientPhone', 'scheduledAt'] as const
  for (const key of editable) {
    if (key in patch) (job as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key]
  }
  job.updatedAt = new Date().toISOString()
  persist()
  return { ok: true as const, job }
}

/** 미배차 건 삭제 — 발신인 취소. */
export function deleteDeliveryDispatch(id: string, ownerId: string) {
  const job = getDeliveryDispatch(id)
  if (!job) return { ok: false as const, error: 'not_found' as const }
  if (job.ownerId && job.ownerId !== ownerId) return { ok: false as const, error: 'forbidden' as const }
  if (job.status !== 'requested') return { ok: false as const, error: 'already_assigned' as const }
  db().jobs.delete(id)
  persist()
  return { ok: true as const }
}

export function listOpenDeliveries() {`)

  need(s, `    fare: job.fare,
    status: job.status,`, 'A3')
  s = s.replace(`    fare: job.fare,
    status: job.status,`,
`    fare: job.fare,
    vehicle: job.vehicle ?? null,
    packageSize: job.packageSize ?? null,
    scheduledAt: job.scheduledAt ?? null,
    pickupLat: job.pickupLat ?? null,
    pickupLng: job.pickupLng ?? null,
    status: job.status,`)
  save(p, s)
  console.log('1 ok')
}

// ── 2. app/api/deliveries/route.ts — ownerId 필터 + 신규 필드 수신 ───────────
{
  const p = 'app/api/deliveries/route.ts'
  let s = load(p)
  need(s, `import { createDeliveryDispatch, listOpenDeliveries, publicDelivery } from '@/lib/delivery-dispatch'`, 'B1')
  s = s.replace(`import { createDeliveryDispatch, listOpenDeliveries, publicDelivery } from '@/lib/delivery-dispatch'`,
`import { createDeliveryDispatch, listDeliveriesByOwner, listOpenDeliveries, publicDelivery } from '@/lib/delivery-dispatch'`)

  need(s, `export async function GET() {
  return NextResponse.json({ ok: true, jobs: listOpenDeliveries().map((job) => publicDelivery(job)) })
}`, 'B2')
  s = s.replace(`export async function GET() {
  return NextResponse.json({ ok: true, jobs: listOpenDeliveries().map((job) => publicDelivery(job)) })
}`,
`export async function GET(request: Request) {
  const ownerId = new URL(request.url).searchParams.get('ownerId')?.trim()
  // 발신인 본인 목록(전체 상태) — 기사용 오픈 목록과 분기한다.
  if (ownerId) {
    return NextResponse.json({ ok: true, jobs: listDeliveriesByOwner(ownerId).map((job) => publicDelivery(job)) })
  }
  return NextResponse.json({ ok: true, jobs: listOpenDeliveries().map((job) => publicDelivery(job)) })
}`)

  need(s, `    senderPhone: typeof body?.senderPhone === 'string' ? body.senderPhone : '',
    recipientPhone: typeof body?.recipientPhone === 'string' ? body.recipientPhone : '',
    createdAt,`, 'B3')
  s = s.replace(`    senderPhone: typeof body?.senderPhone === 'string' ? body.senderPhone : '',
    recipientPhone: typeof body?.recipientPhone === 'string' ? body.recipientPhone : '',
    createdAt,`,
`    senderPhone: typeof body?.senderPhone === 'string' ? body.senderPhone : '',
    recipientPhone: typeof body?.recipientPhone === 'string' ? body.recipientPhone : '',
    ownerId: typeof body?.ownerId === 'string' ? body.ownerId.trim().slice(0, 80) : '',
    pickupLat: Number.isFinite(Number(body?.pickupLat)) ? Number(body.pickupLat) : null,
    pickupLng: Number.isFinite(Number(body?.pickupLng)) ? Number(body.pickupLng) : null,
    destLat: Number.isFinite(Number(body?.destLat)) ? Number(body.destLat) : null,
    destLng: Number.isFinite(Number(body?.destLng)) ? Number(body.destLng) : null,
    // 미래 시각만 예약으로 인정 — 과거/파싱 불가는 즉시 배송으로 정규화한다.
    scheduledAt: (() => {
      const raw = typeof body?.scheduledAt === 'string' ? Date.parse(body.scheduledAt) : NaN
      return Number.isFinite(raw) && raw > Date.now() ? new Date(raw).toISOString() : null
    })(),
    vehicle: typeof body?.vehicle === 'string' ? body.vehicle.trim().slice(0, 30) : '',
    packageSize: typeof body?.packageSize === 'string' ? body.packageSize.trim().slice(0, 30) : '',
    createdAt,`)
  save(p, s)
  console.log('2 ok')
}

// ── 3. app/api/deliveries/[id]/route.ts — PATCH/DELETE ───────────────────────
{
  const p = 'app/api/deliveries/[id]/route.ts'
  let s = load(p)
  need(s, `import { getDeliveryDispatch, publicDelivery } from '@/lib/delivery-dispatch'`, 'C1')
  s = s.replace(`import { getDeliveryDispatch, publicDelivery } from '@/lib/delivery-dispatch'`,
`import { deleteDeliveryDispatch, getDeliveryDispatch, publicDelivery, updateDeliveryDispatch } from '@/lib/delivery-dispatch'`)

  s += `
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
`
  save(p, s)
  console.log('3 ok')
}

// ── 4. lib/delivery-job.ts — 클라이언트 타입·API 래퍼 ────────────────────────
{
  const p = 'lib/delivery-job.ts'
  let s = load(p)
  need(s, `export type DeliveryJob = {
  id: string
  vehicle: DeliveryVehicle
  packageSize: PackageSizeId`, 'J1')
  s = s.replace(`export type DeliveryJob = {
  id: string
  vehicle: DeliveryVehicle
  packageSize: PackageSizeId`,
`export type DeliveryJob = {
  id: string
  /** 발신인 식별자 — 서버 수정·삭제·내 목록 조회의 소유자 키. */
  ownerId?: string
  vehicle: DeliveryVehicle
  packageSize: PackageSizeId`)

  need(s, `  senderPhone: string
  recipientPhone: string
  status: DeliveryJobStatus`, 'J2')
  s = s.replace(`  senderPhone: string
  recipientPhone: string
  status: DeliveryJobStatus`,
`  senderPhone: string
  recipientPhone: string
  pickupLat?: number | null
  pickupLng?: number | null
  destLat?: number | null
  destLng?: number | null
  /** 예약 수거 시각(ISO) — 없으면 즉시 배송. */
  scheduledAt?: string | null
  status: DeliveryJobStatus`)

  need(s, `export type PublicDelivery = {
  id: string
  pickupAddress: string
  destAddress: string`, 'J3')
  s = s.replace(`export type PublicDelivery = {
  id: string
  pickupAddress: string
  destAddress: string`,
`export type PublicDelivery = {
  id: string
  pickupAddress: string
  destAddress: string
  pickupLat?: number | null
  pickupLng?: number | null
  vehicle?: string | null
  packageSize?: string | null
  /** 예약 수거 시각(ISO) — null이면 즉시 배송. */
  scheduledAt?: string | null
  createdAt?: string`)

  s += `
export async function fetchMyDeliveries(ownerId: string) {
  const res = await apiFetch(\`/api/deliveries/?ownerId=\${encodeURIComponent(ownerId)}\`)
  const data = (await res.json().catch(() => null)) as { jobs?: PublicDelivery[] } | null
  return res.ok ? (data?.jobs ?? []) : []
}

export async function updateDelivery(id: string, ownerId: string, patch: Record<string, unknown>) {
  const res = await apiFetch(\`/api/deliveries/\${encodeURIComponent(id)}/\`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...patch, ownerId }),
  })
  const data = (await res.json().catch(() => null)) as { job?: PublicDelivery; error?: string } | null
  if (!res.ok || !data?.job) throw new Error(data?.error || '택배 정보를 수정하지 못했어요.')
  return data.job
}

export async function deleteDelivery(id: string, ownerId: string) {
  const res = await apiFetch(\`/api/deliveries/\${encodeURIComponent(id)}/\`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerId }),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(data?.error || '택배를 삭제하지 못했어요.')
  }
}
`
  save(p, s)
  console.log('4 ok')
}
