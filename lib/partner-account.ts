import { apiFetch } from '@/lib/app-origin'

export type PiIdentity = {
  uid: string
  username: string
  wallet: string
}

export type PartnerProfile = PiIdentity & {
  role: '기사' | '파트너'
  name: string
  phone: string
  detail: string
  region: string
  serviceType?: string
  vehicle?: string
  plate?: string
  linkedAt: string
}

export function splitVehicleDetail(detail: string) {
  const text = detail.trim()
  const parts = text.split(/\s*[·|/]\s*/).map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2) return { vehicle: parts[0], plate: parts.slice(1).join(' ') }
  return { vehicle: text, plate: '' }
}

export function partnerVehicle(profile: Pick<PartnerProfile, 'detail' | 'vehicle' | 'plate'> | null | undefined) {
  const vehicle = profile?.vehicle?.trim() || ''
  const plate = profile?.plate?.trim() || ''
  if (vehicle || plate) return { vehicle, plate }
  return splitVehicleDetail(profile?.detail || '')
}

export type SettlementEntry = {
  at: string
  amount: number
  memo: string
}

export type SettlementLedger = {
  uid: string
  wallet: string
  updatedAt: string
  entries: SettlementEntry[]
}

const SESSION_KEY = 'taxitago-pi-session'
const PROFILE_KEY = 'taxitago-partner-profile'
const LEDGER_KEY = 'taxitago-partner-settlement'

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function loadPiIdentity(): PiIdentity | null {
  const session = readJson<PiIdentity>(SESSION_KEY)
  if (session?.uid && session.wallet) return session
  const profile = loadPartnerProfile()
  if (profile?.uid && profile.wallet) {
    return { uid: profile.uid, username: profile.username, wallet: profile.wallet }
  }
  return null
}

export function savePiIdentity(identity: PiIdentity) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(identity))
}

export function loadPartnerProfile(): PartnerProfile | null {
  const profile = readJson<PartnerProfile>(PROFILE_KEY)
  return profile?.uid ? profile : null
}

export function savePartnerProfile(profile: PartnerProfile) {
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  savePiIdentity({ uid: profile.uid, username: profile.username, wallet: profile.wallet })
  upsertSettlementLedger(profile.uid, profile.wallet)
}

export function loadSettlementLedger(): SettlementLedger | null {
  const ledger = readJson<SettlementLedger>(LEDGER_KEY)
  return ledger?.uid ? ledger : null
}

export function upsertSettlementLedger(uid: string, wallet: string) {
  const current = loadSettlementLedger()
  const next: SettlementLedger = {
    uid,
    wallet,
    updatedAt: new Date().toISOString(),
    entries: current?.uid === uid ? current.entries : [],
  }
  window.localStorage.setItem(LEDGER_KEY, JSON.stringify(next))
  return next
}

export function appendSettlementEntry(amount: number, memo: string) {
  const current = loadSettlementLedger()
  if (!current) return null
  const next: SettlementLedger = {
    ...current,
    updatedAt: new Date().toISOString(),
    entries: [{ at: new Date().toISOString(), amount, memo }, ...current.entries].slice(0, 80),
  }
  window.localStorage.setItem(LEDGER_KEY, JSON.stringify(next))
  return next
}

export function clearPartnerAccount() {
  window.localStorage.removeItem(SESSION_KEY)
  window.localStorage.removeItem(PROFILE_KEY)
  window.localStorage.removeItem(LEDGER_KEY)
}

export async function requestAccountWithdrawal(uid?: string) {
  const id = uid?.trim() || loadPiIdentity()?.uid || loadPartnerProfile()?.uid || ''
  if (id) {
    const res = await apiFetch('/api/partner/link/', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: id }),
    })
    const data = (await res.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null
    if (!res.ok || data?.ok !== true) {
      throw new Error(typeof data?.error === 'string' ? data.error : '회원 탈퇴에 실패했어요.')
    }
  }
  clearPartnerAccount()
}

export async function syncPartnerLink(profile: PartnerProfile) {
  try {
    await apiFetch('/api/partner/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: profile.uid,
        username: profile.username,
        wallet: profile.wallet,
        role: profile.role,
        name: profile.name,
        linkedAt: profile.linkedAt,
      }),
    })
  } catch {
    /* local profile remains the source of truth when the API is unreachable */
  }
}
