import { NextResponse } from 'next/server'
import { adminActor } from '@/lib/admin-auth'
import { listDevices } from '@/lib/device-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const actor = await adminActor(request)
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const devices = await listDevices()
  return NextResponse.json({ ok: true, devices, count: devices.length })
}
