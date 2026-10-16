const fs = require('fs')
const load = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const save = (p, s) => fs.writeFileSync(p, s)
const need = (s, frag, label) => { if (!s.includes(frag)) throw new Error('MISSING ' + label) }

// ── 1. lib/delivery-dispatch.ts — driverPhone + 배정 목록 + viewer별 연락처 ──
{
  const p = 'lib/delivery-dispatch.ts'
  let s = load(p)
  need(s, `  driverId: string | null
  driverName: string | null`, 'D1')
  s = s.replace(`  driverId: string | null
  driverName: string | null`,
`  driverId: string | null
  driverName: string | null
  /** 배정 기사 연락처 — 수락 시 전달, 발신인이 기사와 직통 연결할 때 노출. */
  driverPhone?: string | null`)

  need(s, `export function acceptDeliveryDispatch(id: string, driver: { driverId: string; name: string; vehicle: string; plate: string }) {`, 'D2')
  s = s.replace(`export function acceptDeliveryDispatch(id: string, driver: { driverId: string; name: string; vehicle: string; plate: string }) {`,
`export function acceptDeliveryDispatch(id: string, driver: { driverId: string; name: string; vehicle: string; plate: string; phone?: string }) {`)
  need(s, `  job.driverVehicle = driver.vehicle.trim()
  job.driverPlate = driver.plate.trim()`, 'D3')
  s = s.replace(`  job.driverVehicle = driver.vehicle.trim()
  job.driverPlate = driver.plate.trim()`,
`  job.driverVehicle = driver.vehicle.trim()
  job.driverPlate = driver.plate.trim()
  job.driverPhone = driver.phone?.trim() || null`)

  need(s, `export function listOpenDeliveries() {`, 'D4')
  s = s.replace(`export function listOpenDeliveries() {`,
`/** 기사에게 배정된 건 — 기사 화면의 수락 건 복원 폴링용. */
export function listAssignedByDriver(driverId: string) {
  return [...db().jobs.values()]
    .filter((job) => job.status === 'assigned' && job.driverId === driverId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function listOpenDeliveries() {`)

  need(s, `    senderPhone: job.status === 'assigned' && mine ? job.senderPhone : '',
    recipientPhone: job.status === 'assigned' && mine ? job.recipientPhone : '',`, 'D5')
  s = s.replace(`    senderPhone: job.status === 'assigned' && mine ? job.senderPhone : '',
    recipientPhone: job.status === 'assigned' && mine ? job.recipientPhone : '',`,
`    senderPhone: job.status === 'assigned' && mine ? job.senderPhone : '',
    recipientPhone: job.status === 'assigned' && mine ? job.recipientPhone : '',
    // 발신인·수신인 ↔ 기사 연락처 — 배정된 당사자(기사 또는 발신인)에게만 노출.
    driverPhone: job.status === 'assigned' && (mine || (viewerId && job.ownerId === viewerId)) ? (job.driverPhone ?? '') : '',`)
  save(p, s)
  console.log('1 ok')
}

// ── 2. /api/deliveries — ?driverId= 배정 목록 분기 ────────────────────────────
{
  const p = 'app/api/deliveries/route.ts'
  let s = load(p)
  need(s, `import { createDeliveryDispatch, listDeliveriesByOwner, listOpenDeliveries, publicDelivery } from '@/lib/delivery-dispatch'`, 'R1')
  s = s.replace(`import { createDeliveryDispatch, listDeliveriesByOwner, listOpenDeliveries, publicDelivery } from '@/lib/delivery-dispatch'`,
`import { createDeliveryDispatch, listAssignedByDriver, listDeliveriesByOwner, listOpenDeliveries, publicDelivery } from '@/lib/delivery-dispatch'`)
  need(s, `  const ownerId = new URL(request.url).searchParams.get('ownerId')?.trim()`, 'R2')
  s = s.replace(`  const ownerId = new URL(request.url).searchParams.get('ownerId')?.trim()`,
`  const params = new URL(request.url).searchParams
  const ownerId = params.get('ownerId')?.trim()
  // 기사에게 배정된 건 — 발신·수신 연락처가 함께 내려간다(publicDelivery viewer=기사).
  const driverId = params.get('driverId')?.trim()
  if (driverId) {
    return NextResponse.json({ ok: true, jobs: listAssignedByDriver(driverId).map((job) => publicDelivery(job, driverId)) })
  }`)
  save(p, s)
  console.log('2 ok')
}

// ── 3. /api/deliveries/[id] — ?viewer= 지원 ─────────────────────────────────
{
  const p = 'app/api/deliveries/[id]/route.ts'
  let s = load(p)
  need(s, `export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const job = getDeliveryDispatch(id)
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, job: publicDelivery(job) })
}`, 'R3')
  s = s.replace(`export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const job = getDeliveryDispatch(id)
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true, job: publicDelivery(job) })
}`,
`export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const job = getDeliveryDispatch(id)
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // viewer=발신인이면 기사 연락처, viewer=배정 기사면 발신·수신 연락처가 노출된다.
  const viewer = new URL(request.url).searchParams.get('viewer')?.trim()
  return NextResponse.json({ ok: true, job: publicDelivery(job, viewer || undefined) })
}`)
  save(p, s)
  console.log('3 ok')
}

// ── 4. accept route — 기사 연락처 저장 ──────────────────────────────────────
{
  const p = 'app/api/deliveries/[id]/accept/route.ts'
  let s = load(p)
  need(s, `    name: typeof body?.name === 'string' ? body.name : '기사',
    vehicle,
    plate,`, 'R4')
  s = s.replace(`    name: typeof body?.name === 'string' ? body.name : '기사',
    vehicle,
    plate,`,
`    name: typeof body?.name === 'string' ? body.name : '기사',
    vehicle,
    plate,
    phone: typeof body?.phone === 'string' ? body.phone : '',`)
  save(p, s)
  console.log('4 ok')
}

// ── 5. lib/delivery-job.ts — 타입·래퍼 ──────────────────────────────────────
{
  const p = 'lib/delivery-job.ts'
  let s = load(p)
  need(s, `  driverName: string | null
  driverVehicle: string | null
  driverPlate: string | null
}`, 'J1')
  s = s.replace(`  driverName: string | null
  driverVehicle: string | null
  driverPlate: string | null
}`,
`  driverName: string | null
  driverVehicle: string | null
  driverPlate: string | null
  /** 배정 후에만 당사자에게 노출되는 연락처. */
  driverPhone?: string
  senderPhone?: string
  recipientPhone?: string
}`)

  need(s, `export async function fetchDelivery(id: string) {
  const res = await apiFetch(\`/api/deliveries/\${encodeURIComponent(id)}/\`)`, 'J2')
  s = s.replace(`export async function fetchDelivery(id: string) {
  const res = await apiFetch(\`/api/deliveries/\${encodeURIComponent(id)}/\`)`,
`export async function fetchDelivery(id: string, viewer?: string) {
  const res = await apiFetch(\`/api/deliveries/\${encodeURIComponent(id)}/\${viewer ? \`?viewer=\${encodeURIComponent(viewer)}\` : ''}\`)`)

  need(s, `export async function acceptDelivery(id: string, driver: { driverId: string; name?: string; vehicle: string; plate: string }) {`, 'J3')
  s = s.replace(`export async function acceptDelivery(id: string, driver: { driverId: string; name?: string; vehicle: string; plate: string }) {`,
`export async function acceptDelivery(id: string, driver: { driverId: string; name?: string; vehicle: string; plate: string; phone?: string }) {`)

  need(s, `export async function fetchMyDeliveries(ownerId: string) {`, 'J4')
  s = s.replace(`export async function fetchMyDeliveries(ownerId: string) {`,
`export async function fetchAcceptedDeliveries(driverId: string) {
  const res = await apiFetch(\`/api/deliveries/?driverId=\${encodeURIComponent(driverId)}\`)
  const data = (await res.json().catch(() => null)) as { jobs?: PublicDelivery[] } | null
  return res.ok ? (data?.jobs ?? []) : []
}

export async function fetchMyDeliveries(ownerId: string) {`)
  save(p, s)
  console.log('5 ok')
}
