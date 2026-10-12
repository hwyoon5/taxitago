import { NextResponse } from 'next/server'
import { kvCommand, kvConfigured } from '@/lib/kv'
import { isPiSandboxRequest } from '@/lib/pi-sandbox'
import { digitsOnly, isValidKoreanPhone } from '@/lib/phone'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CODE_TTL_SEC = 300 // 인증번호 유효 시간 5분
const KEY_PREFIX = 'taxitago:phone-verify:'

type VerifyBucket = Map<string, { code: string; exp: number }>
const globalStore = globalThis as typeof globalThis & { __taxitagoPhoneVerify?: VerifyBucket }

function memStore(): VerifyBucket {
  if (!globalStore.__taxitagoPhoneVerify) globalStore.__taxitagoPhoneVerify = new Map()
  return globalStore.__taxitagoPhoneVerify
}

async function storeCode(phone: string, code: string) {
  if (kvConfigured) {
    try {
      await kvCommand(['SET', `${KEY_PREFIX}${phone}`, code, 'EX', CODE_TTL_SEC])
      return
    } catch {
      // KV 장애 시 메모리로 폴백 — 인증 흐름을 죽이지 않는다.
    }
  }
  memStore().set(phone, { code, exp: Date.now() + CODE_TTL_SEC * 1000 })
}

async function readCode(phone: string): Promise<string | null> {
  if (kvConfigured) {
    try {
      const value = await kvCommand<string>(['GET', `${KEY_PREFIX}${phone}`])
      if (typeof value === 'string' && value) return value
    } catch {
      // 폴백 경로도 함께 확인한다.
    }
  }
  const row = memStore().get(phone)
  if (!row) return null
  if (Date.now() > row.exp) {
    memStore().delete(phone)
    return null
  }
  return row.code
}

async function clearCode(phone: string) {
  if (kvConfigured) {
    try {
      await kvCommand(['DEL', `${KEY_PREFIX}${phone}`])
    } catch {
      undefined
    }
  }
  memStore().delete(phone)
}

/**
 * 휴대전화 SMS 인증 시뮬레이션 — send는 6자리 코드를 발급·보관하고,
 * 테스트넷/샌드박스에서는 개발 편의를 위해 devCode를 함께 돌려준다
 * (메인넷 응답에는 코드가 포함되지 않는다). confirm은 코드 일치를 확인하고
 * 성공 시 즉시 폐기해 재사용을 막는다.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const action = typeof body?.action === 'string' ? body.action : ''
  const phone = digitsOnly(typeof body?.phone === 'string' ? body.phone : '')

  if (action === 'send') {
    if (!isValidKoreanPhone(phone)) {
      return NextResponse.json({ error: 'invalid_phone' }, { status: 400 })
    }
    const code = String(Math.floor(100000 + Math.random() * 900000))
    await storeCode(phone, code)
    const sandbox = isPiSandboxRequest(request)
    return NextResponse.json({ ok: true, expiresIn: CODE_TTL_SEC, ...(sandbox ? { devCode: code } : {}) })
  }

  if (action === 'confirm') {
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!phone || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }
    const stored = await readCode(phone)
    if (!stored || stored !== code) {
      return NextResponse.json({ error: 'code_mismatch' }, { status: 400 })
    }
    await clearCode(phone)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}
